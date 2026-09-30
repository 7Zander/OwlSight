// SPDX-License-Identifier: GPL-3.0-or-later
#include "viewer.hpp"
#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QStandardPaths>
#include <QSaveFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QMutexLocker>
#include <QUrl>
#include <QDesktopServices>
#include <QDateTime>
#include <QClipboard>
#include <QGuiApplication>
#include <algorithm>
#include <array>
#include <cmath>
#include <condition_variable>
#include <cstring>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>
#include <windows.h>
using namespace owl;
using namespace owl::desktop;
namespace {
QString qs(const std::string&s){return QString::fromUtf8(s.data(),qsizetype(s.size()));}
std::string utf(const QString&s){auto b=s.toUtf8();return {b.constData(),size_t(b.size())};}
QVariant jsonVariant(const Json& j){return QJsonDocument::fromJson(QByteArray::fromStdString(j.dump())).toVariant();}
// sRGB 传递函数按 1/4096 步长预计算查表：每个通道一次采样加一次线性插值，
// 取代逐像素 std::pow，量化到 8 位后与直接求值的差值小于 0.02 个色阶。
const std::array<float,4097>& srgbTable(){
    static const std::array<float,4097> table=[]{
        std::array<float,4097> values{};
        for(size_t i=0;i<=4096;++i){const float v=float(i)/4096.f;values[i]=v<=.0031308f?12.92f*v:1.055f*std::pow(v,1.f/2.4f)-.055f;}
        return values;
    }();
    return table;
}
inline float srgb(float v){
    if(!std::isfinite(v))return v;   // NaN / ±inf 继续传播，仍由非有限检查标为洋红
    if(v<=0.f)return 0.f;            // 有限负值结果同为负，后续一律截断到 0
    if(v>=1.f)return 1.f;            // 大于 1 的结果同样被截断到 1
    // 上界收在 4095：最接近 1 的 float 乘 4096 会舍入到 4096.0，直接取整会越界。
    const int index=std::min(int(v*4096.f),4095);const float fraction=v*4096.f-float(index);
    const auto& table=srgbTable();
    return table[size_t(index)]+(table[size_t(index)+1]-table[size_t(index)])*fraction;
}
// 常驻线程池：把逐行像素处理按行带拆分到多个核心。OCIO CPU 处理器是不可变对象，
// 支持同一处理器跨线程并发 apply；QImage 各行互不重叠，可安全并行写入。
class RenderPool {
public:
    RenderPool() {
        // 渲染线程池与解码线程并发运行，上限收到 8，避免在渲染的短暂窗口内过度抢占解码核心。
        const size_t n = std::clamp<size_t>(size_t(std::thread::hardware_concurrency()), size_t(1), size_t(8));
        for (size_t i = 0; i < n; ++i) threads_.emplace_back([this]{ run(); });
    }
    ~RenderPool() {
        { std::lock_guard<std::mutex> lock(mutex_); stop_ = true; }
        wake_.notify_all();
        for (auto& t : threads_) t.join();
    }
    RenderPool(const RenderPool&) = delete;
    RenderPool& operator=(const RenderPool&) = delete;
    // 把 [0, count) 拆成行带，fn(begin, end) 处理 [begin, end)。阻塞至全部完成。
    void map(size_t count, const std::function<void(size_t, size_t)>& fn) {
        if (count == 0) return;
        {
            std::lock_guard<std::mutex> lock(mutex_);
            fn_ = fn;
            total_ = count;
            next_ = 0;
            active_ = 0;
            chunk_ = std::max<size_t>(1, (count + threads_.size() * 4 - 1) / (threads_.size() * 4));
        }
        wake_.notify_all();
        runChunks();  // 调用线程也参与，降低首带延迟
        std::unique_lock<std::mutex> lock(mutex_);
        done_.wait(lock, [this]{ return next_ >= total_ && active_ == 0; });
    }
private:
    void run() {
        for (;;) {
            std::unique_lock<std::mutex> lock(mutex_);
            wake_.wait(lock, [this]{ return stop_ || next_ < total_; });
            if (stop_) return;
            if (next_ >= total_) continue;
            ++active_;
            lock.unlock();
            runChunks();
            lock.lock();
            --active_;
            if (next_ >= total_ && active_ == 0) done_.notify_all();
        }
    }
    void runChunks() {
        for (;;) {
            size_t begin,end;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                if (next_ >= total_) return;
                begin = next_;
                next_ = std::min(total_, begin + chunk_);end=next_;
            }
            fn_(begin, end);
        }
    }
    std::vector<std::thread> threads_;
    std::mutex mutex_;
    std::condition_variable wake_, done_;
    bool stop_ = false;
    std::function<void(size_t, size_t)> fn_;
    size_t total_ = 0, next_ = 0, chunk_ = 0, active_ = 0;
};
RenderPool& renderPool() { static RenderPool pool; return pool; }
std::shared_ptr<ColorBundle> processors(const Json& selection) {
    std::string source=selection.at("source");
    auto cfg=source=="builtin"?ocio::Config::CreateFromBuiltinConfig("cg-config-v2.2.0_aces-v1.3_ocio-v2.4"):ocio::Config::CreateFromFile(source.c_str());
    std::string input=selection.at("input"),display=selection.at("display"),view=selection.at("view");
    auto space=cfg->getColorSpace(input.c_str());
    if(!space)throw std::runtime_error("输入颜色空间不存在。");
    auto result=std::make_shared<ColorBundle>();result->data=space->isData();
    if(result->data)return result;
    if(!cfg->getColorSpace("scene_linear"))throw std::runtime_error("配置缺少 scene_linear，请选择 Raw。");
    auto group=ocio::GroupTransform::Create();
    const std::string mode=selection.at("lookMode"),look=selection.at("look");
    if(mode=="override"){
        if(!cfg->getLook(look.c_str()))throw std::runtime_error("Look 不存在。");
        auto transform=ocio::LookTransform::Create();transform->setSrc("scene_linear");transform->setDst("scene_linear");transform->setLooks(look.c_str());group->appendTransform(transform);
    }
    auto displayTransform=ocio::DisplayViewTransform::Create();displayTransform->setSrc("scene_linear");displayTransform->setDisplay(display.c_str());displayTransform->setView(view.c_str());displayTransform->setLooksBypass(mode!="config");group->appendTransform(displayTransform);
    result->input=cfg->getProcessor(input.c_str(),"scene_linear")->getDefaultCPUProcessor();
    result->display=cfg->getProcessor(group)->getDefaultCPUProcessor();return result;
}
QImage imageFor(const Frame& frame,const Layer& layer,const QString& component,int mode,float exposure,const std::shared_ptr<ColorBundle>& color){
    size_t count=size_t(frame.width)*frame.height;
    if(!count)return {};
    // 不使用会先清零的容器：缓冲区随即被整体写入，清零只是白费带宽。
    std::unique_ptr<float[]> storage(new float[count*4]);
    float* pixels=storage.get();
    const int w=frame.width,h=frame.height;
    const bool colorLayer=layer.color&&(component=="RGBA"||!layer.components.count(utf(component)));
    const bool alpha=colorLayer&&layer.channels.size()==4;
    const bool ocio=(mode==1&&colorLayer&&color&&!color->data);
    const float gain=std::exp2(exposure);
    auto& pool=renderPool();
    const auto mapping=frame.displayMap(utf(component),layer.color&&layer.components.count(utf(component)));
    // Map raw channels directly into the CPU color working buffer.
    pool.map(size_t(h),[&](size_t yb,size_t ye){
        const size_t first=size_t(yb)*size_t(w)*4,last=size_t(ye)*size_t(w)*4;
        for(size_t i=first;i<last;i+=4){const size_t base=(i/4)*size_t(frame.channels);
            for(int c=0;c<4;++c)pixels[i+c]=mapping[c]<0?1.f:frame.pixels->value(base+size_t(mapping[c]));
        }
        if(alpha)for(size_t i=first;i<last;i+=4)if(pixels[i+3]>0)for(int c=0;c<3;++c)pixels[i+c]/=pixels[i+3];
    });
    // 阶段二：OCIO 输入→曝光→显示。OCIO CPU 处理器是不可变对象，可并发 apply；
    // 每带以独立 PackedImageDesc 指向该带行首，行步长仍按整行宽计算。
    if(ocio){
        pool.map(size_t(h),[&](size_t yb,size_t ye){
            const size_t first=size_t(yb)*size_t(w)*4;
            float* base=pixels+first;
            const int bandH=int(ye-yb);
            ocio::PackedImageDesc img(base,w,bandH,4);
            color->input->apply(img);
            const size_t n=size_t(bandH)*size_t(w)*4;
            for(size_t i=0;i<n;i+=4)for(int c=0;c<3;++c)base[i+c]*=gain;
            color->display->apply(img);
        });
    }
    // 阶段三：mode 3 范围归约（仅统计 RGB，与原行为一致），按行带并行后合并。
    float minimum=0,maximum=1;
    if(mode==3){
        std::mutex m;float mn=std::numeric_limits<float>::infinity(),mx=-mn;
        pool.map(size_t(h),[&](size_t yb,size_t ye){
            float lmin=std::numeric_limits<float>::infinity(),lmax=-lmin;
            const size_t first=size_t(yb)*size_t(w)*4,last=size_t(ye)*size_t(w)*4;
            for(size_t i=first;i<last;i+=4)for(int c=0;c<3;++c){const float v=pixels[i+c];if(std::isfinite(v)){lmin=std::min(lmin,v);lmax=std::max(lmax,v);}}
            std::lock_guard<std::mutex> lock(m);mn=std::min(mn,lmin);mx=std::max(mx,lmax);
        });
        if(!std::isfinite(mn)){minimum=0;maximum=1;}else{minimum=mn;maximum=mx;}
    }
    QImage image(w,h,QImage::Format_RGBA8888);
    if(image.isNull())throw std::runtime_error("预览图像内存不足。");
    // 循环不变量提前算好，避免每像素重复求值。
    const bool encode=(mode==0||(mode==1&&!color))&&colorLayer;
    const float denominator=mode==3?std::max(maximum-minimum,1e-6f):1.f;
    // 阶段四：sRGB 编码、Alpha 棋盘格合成与 8 位打包，按行带并行写入互不重叠的行。
    uchar* bits=image.bits();
    const qsizetype stride=image.bytesPerLine();
    pool.map(size_t(h),[&](size_t yb,size_t ye){
        for(int y=int(yb);y<int(ye);++y){
            uchar* out=bits+qsizetype(y)*stride;size_t at=size_t(y)*size_t(w)*4;
            for(int x=0;x<w;++x,out+=4,at+=4){float rgb[3];
                for(int c=0;c<3;++c){
                    float v=pixels[at+c];
                    if(mode==3)v=(v-minimum)/denominator;
                    else if(encode)v=srgb(v*gain);
                    rgb[c]=v;
                }
                if(!std::isfinite(rgb[0])||!std::isfinite(rgb[1])||!std::isfinite(rgb[2])){rgb[0]=rgb[2]=1;rgb[1]=0;}
                for(int c=0;c<3;++c){float v=std::clamp(rgb[c],0.f,1.f);if(alpha){float a=std::isfinite(pixels[at+3])?std::clamp(pixels[at+3],0.f,1.f):0;float bg=((x/12+y/12)%2)?.28f:.18f;v=v*a+bg*(1-a);}out[c]=static_cast<uchar>(std::clamp(v,0.f,1.f)*255+.5f);}
                out[3]=255;
            }
        }
    });
    return image;
}
}
QImage FrameStore::requestImage(const QString& id,QSize* size,const QSize&){QMutexLocker lock(&mutex);auto image=images.value(id.section('?',0,0));if(size)*size=image.size();return image;}
void FrameStore::put(const QString&id,const QImage&image){
    QMutexLocker lock(&mutex);
    bytes-=images.value(id).sizeInBytes();images.remove(id);
    if(bytes+image.sizeInBytes()>256*qsizetype(MiB)){images.clear();bytes=0;}
    images.insert(id,image);bytes+=image.sizeInBytes();
}
void FrameStore::clear(){QMutexLocker lock(&mutex);images.clear();bytes=0;}
Viewer::Viewer(FrameStore*s,QObject*p):QObject(p),store(s){
    settingsPath=QCoreApplication::applicationDirPath()+"/settings/qtquick-settings-v020.json";
    bool createSettings=!QFileInfo::exists(settingsPath);
    const QString legacyPath=QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation)+"/OwlSight/qtquick-settings-v020.json";
    QFile settings(createSettings?legacyPath:settingsPath);
    if(settings.open(QIODevice::ReadOnly)){
        QJsonParseError parseError;
        const auto document=QJsonDocument::fromJson(settings.readAll(),&parseError);
        if(parseError.error!=QJsonParseError::NoError||!document.isObject()){
            error="配置文件格式无效："+settings.fileName();createSettings=false;
        }else{
        const auto v=document.object();
        manualCacheGiB_=std::clamp(v.value("cacheGiB").toDouble(4.0),.125,64.);
        autoCache_=v.value("cacheMode").toString("auto")!="manual";
        defaultDivisor=v.value("defaultResolution").toInt(2);
        if(defaultDivisor!=1&&defaultDivisor!=2&&defaultDivisor!=3&&defaultDivisor!=4&&defaultDivisor!=8)defaultDivisor=2;
        divisor=defaultDivisor;showHints=v.value("showHints").toBool(true);showInfo=v.value("showInfo").toBool(true);
        }
    }else if(settings.exists()){
        error="无法读取配置文件："+settings.fileName();createSettings=false;
    }
    settings.close();
    if(createSettings)saveSettings();
    if(qEnvironmentVariableIntValue("OWLSIGHT_DISABLE_GPU")!=0)gpuEnabled_=false;
    updateCacheBudget(true);
    connect(&timer,&QTimer::timeout,this,&Viewer::tick);timer.setTimerType(Qt::PreciseTimer);timer.start(2);
}
void Viewer::updateCacheBudget(bool initial){
    const auto now=Clock::now();
    if(!initial&&now<nextMemoryCheck_)return;
    nextMemoryCheck_=now+std::chrono::seconds(5);
    const size_t minimum=128*MiB;
    size_t target=size_t(manualCacheGiB_*1024*MiB);
    const size_t previous=engine.budget();
    QString reason="manual";
    if(autoCache_){
        MEMORYSTATUSEX memory{};memory.dwLength=sizeof(memory);
        if(!GlobalMemoryStatusEx(&memory)){
            if(!initial)return;
            target=512*MiB;reason="memory-query-unavailable";
        }else{
            const size_t total=size_t(memory.ullTotalPhys);
            const size_t available=size_t(std::min(memory.ullAvailPhys,memory.ullAvailPageFile));
            const size_t ceiling=std::max(minimum,std::min(total/4,size_t(8ULL*1024*MiB)));
            const size_t reserve=std::max(size_t(1024*MiB),total/8);
            const size_t headroom=available>reserve?available-reserve:0;
            target=previous;reason="auto-stable";
            if(initial){
                target=std::clamp(std::min(available/2,headroom),minimum,ceiling);reason="auto-initial";
            }else if(available<reserve){
                target=std::max(minimum,std::min(ceiling,previous-previous/4));reason="auto-pressure";
            }else if(!playing&&!opening&&!rendering&&elapsed(lastInput_)>=30000&&
                     elapsed(lastBudgetChange_)>=30000&&available>reserve*2){
                // Only grow slowly while idle; never chase free-memory fluctuations per frame.
                target=std::min(ceiling,previous+std::min(size_t(256*MiB),headroom/4));reason="auto-idle-recovery";
            }
        }
    }
    if(initial||target!=previous){
        engine.setBudget(target);cacheGiB=double(engine.budget())/(1024*MiB);
        lastBudgetChange_=now;nextSchedule_=now;scheduleDirty_=true;stateDirty_=true;
        event("cache.budget",{{"automatic",autoCache_},{"reason",reason},{"cacheGiB",cacheGiB},
            {"previousBytes",QVariant::fromValue(quint64(previous))},{"budgetBytes",QVariant::fromValue(quint64(engine.budget()))}});
        if(!initial)emit changed();
    }
}
void Viewer::startRecording(){
    if(logging)return;
    const auto folder=QCoreApplication::applicationDirPath()+"/logs";
    if(!QDir().mkpath(folder)){error="无法创建日志目录，请将程序放在可写目录后重试。";return;}
    log.setFileName(folder+"/qtquick-"+QString::number(QDateTime::currentMSecsSinceEpoch())+"-"+QString::number(QCoreApplication::applicationPid())+"-"+QString::number(++recordingSequence_)+".jsonl");
    if(!log.open(QIODevice::WriteOnly|QIODevice::Text|QIODevice::NewOnly)){
        error="无法开始记录日志："+log.errorString();return;
    }
    logging=true;nextLogFlush_=Clock::now();
    event("session.start",{{"gpuEnabled",gpuEnabled_},{"gpuModes","0,2"},{"readyMeaning","CPU image ready or GPU commands recorded, not monitor presentation"},{"decodeLimit",2},{"gpuTextureBudgetMiB",1024},
        {"texturePoolEnabled",qEnvironmentVariableIntValue("OWLSIGHT_DISABLE_TEXTURE_POOL")==0},
        {"asyncUploadEnabled",qEnvironmentVariableIntValue("OWLSIGHT_DISABLE_UPLOAD_PREPARE")==0},
        {"uploadTicketBudgetMiB",256},{"uploadTicketLimit",3},{"performanceStage","R1"},
        {"recordingTrigger","user-button"},{"timeOrigin","application start"},{"counterOrigin","application start; recording may start later"},
        {"targetIndex",index},{"targetLayer",selected},{"frameCount",int(sequence.files.size())},
        {"operationId",QVariant::fromValue(operationId_)},{"operationKind",operationKind_},
        {"cacheGiB",cacheGiB},{"cacheAutomatic",autoCache_},{"fps",fps},{"exposure",exposure},{"gpuActive",gpuActive_},{"gpuFallback",gpuFailed_}});
    if(!sequence.files.empty()&&!layers.empty())event("recording.context",{
        {"path",qs(sequence.files[index])},{"frame",QVariant::fromValue(sequence.numbers[index])},
        {"layer",selected},{"layerLabel",qs(layers[selected].label)},{"layerCount",int(layers.size())},
        {"displayedIndex",shownIndex_},{"displayedLayer",shownLayer_},{"pipeline",jsonVariant(engine.statistics())}});
    status="正在记录，可点击停止记录。";
}
void Viewer::stopRecording(const QString& reason){
    if(!logging)return;
    event("session.end",{{"reason",reason}});
    const bool saved=log.flush();log.close();logging=false;
    status=saved?"日志已保存。":"日志写入失败，请检查磁盘空间及目录权限。";
    if(!saved)error=status;
}
Viewer::~Viewer(){timer.stop();finishOperation("cancelled");stopRecording("application-exit");}
void Viewer::event(const QString& name,const QVariantMap& data){
    if(!logging||!log.isOpen())return;
    auto item=data;item["event"]=name;item["backend"]="cpp-qtquick";item["schema"]=4;item["monotonicMs"]=elapsed(sessionStart_);
    item["version"]="0.2.0";item["build"]=OWLSIGHT_BUILD_NUMBER;item["timeUnixMs"]=QDateTime::currentMSecsSinceEpoch();
    item["playing"]=playing;item["mode"]=mode;item["divisor"]=divisor;item["component"]=component;
    log.write(QJsonDocument::fromVariant(item).toJson(QJsonDocument::Compact)+"\n");
}
QVariantMap Viewer::state() const{
    if(!stateDirty_)return stateCache_;
    QVariantList rows;
    for(size_t i=0;i<layers.size();++i)rows.push_back(QVariantMap{{"label",qs(layers[i].label)},{"color",layers[i].color},{"image",i<size_t(thumbs.size())?thumbs[int(i)]:QString()}});
    QVariantList components;for(const char*c:{"RGBA","R","G","B","A"})components.push_back(QVariantMap{{"name",c},{"available",std::string(c)=="RGBA"||(!layers.empty()&&layers[selected].color&&layers[selected].components.count(c))}});
    stateCache_={{ "layers",rows},{"components",components},{"selected",selected},{"component",component},{"frameIndex",index},{"frameCount",int(sequence.files.size())},{"frame",sequence.files.empty()?0:sequence.numbers[index]},{"lastFrame",sequence.files.empty()?0:sequence.numbers.back()},
    {"switching",handoff_},{"displayedLayer",shownLayer_},{"displayedIndex",shownIndex_},{"gpuEnabled",gpuEnabled_},{"gpuActive",gpuActive_},{"gpuFallback",gpuFailed_},{"playing",playing},{"loop",loop},{"grid",grid},{"opening",opening},{"busy",opening||(!sequence.files.empty()&&shownKey!=displayKey(index,selected))},
    {"showHints",showHints},{"showInfo",showInfo},{"logging",logging},{"title",title},{"image",source},{"info",shownInfo},{"error",error},{"status",status},{"divisor",divisor},{"defaultDivisor",defaultDivisor},{"fps",fps},{"exposure",exposure},{"mode",mode},{"cacheGiB",cacheGiB},{"colorBusy",colorBusy||colorPending}};
    if(selectionVariantDirty_){colorSelectionVariant_=jsonVariant(colorSelection);selectionVariantDirty_=false;}
    stateCache_["colorSelection"]=colorSelectionVariant_;
    stateCache_["cacheAutomatic"]=autoCache_;stateCache_["manualCacheGiB"]=manualCacheGiB_;
    stateCache_["colorCatalog"]=colorCatalog.is_null()?QVariantMap():colorCatalogVariant_;
    stateDirty_=false;return stateCache_;
}
std::string Viewer::key(int frame,int layer,bool thumb)const{
    if(sequence.files.empty()||layers.empty())return {};
    return std::to_string(document)+"|"+sequence.files[frame]+"|"+layers[layer].id+"|"+std::to_string(divisor)+(thumb?"|tile":"");
}

QString Viewer::displayKey(int frame,int layer,bool thumb) const {
    return qs(key(frame,layer,thumb))+"#"+QString::number(generation);
}
void Viewer::beginOperation(const QString& kind){
    finishOperation("superseded");operationId_=++operationSequence_;operationKind_=kind;operationStarted_=Clock::now();
    event("operation.start",{{"kind",kind},{"operationId",QVariant::fromValue(operationId_)},{"targetIndex",index},{"targetLayer",selected}});
}
void Viewer::finishOperation(const QString& outcome){
    if(!operationId_)return;
    event("operation.end",{{"kind",operationKind_},{"operationId",QVariant::fromValue(operationId_)},{"outcome",outcome},
        {"totalMs",elapsed(operationStarted_)},{"targetIndex",index},{"targetLayer",selected},{"displayedIndex",shownIndex_},{"displayedLayer",shownLayer_}});
    operationId_=0;
}
void Viewer::accepted(const std::shared_ptr<const Frame>& pixels){
    visiblePixels_=pixels;shownIndex_=index;shownLayer_=selected;
    const auto interval=std::chrono::microseconds(1000000/fps);
    if(handoff_||Clock::now()>nextFrame+interval)nextFrame=Clock::now()+interval;
    handoff_=false;finishOperation("submitted");nextSchedule_=Clock::now();
}
void Viewer::schedule(){
    const auto now=Clock::now();
    if(scheduleDirty_){engine.purge();scheduleDirty_=false;nextSchedule_=now;}
    if(now<nextSchedule_)return;
    nextSchedule_=now+std::chrono::milliseconds(25);
    if(grid){
        engine.setBackgroundLimit(2);std::unordered_set<std::string> needed;
        for(int l=0;l<int(layers.size());++l)if(thumbs.value(l).isEmpty()){
            engine.setPlayHead(std::to_string(document)+"|"+layers[l].id+"|"+std::to_string(divisor)+"|tile",index,int(sequence.files.size()),loop);break;
        }
        int sent=0;
        for(int l=0;l<int(layers.size());++l)if(thumbs.value(l).isEmpty()){
            const auto id=key(index,l,true);needed.insert(id);
            if(!engine.has(id)&&sent++<4)request(index,l,true,false);
        }
        engine.retainQueued(needed);return;
    }
    const int count=int(sequence.files.size());
    const auto advance=[&](int start,int steps){int n=start+steps;return n<count?n:loop?n%count:-1;};
    const int capacity=int(std::min<size_t>(count,std::max<size_t>(1,engine.budget()/std::max<size_t>(frameCost_,1))));
    const int runway=std::min(std::max(0,capacity-1),std::max(1,(fps+3)/4));
    int ahead=0;
    for(int d=1;d<capacity;++d){const int n=advance(index,d);if(n<0||!engine.has(key(n,selected)))break;++ahead;}
    continuousAhead_=ahead;
    engine.setBackgroundLimit(playing&&ahead>=runway?1:2);
    std::unordered_set<std::string> needed{key(index,selected)};
    std::vector<int> missing;
    bool full=engine.has(key(index,selected));
    for(int d=1;d<capacity;++d){
        const int n=advance(index,d);if(n<0)break;
        auto id=key(n,selected);needed.insert(id);
        if(!engine.has(id)){full=false;if(missing.size()<4)missing.push_back(n);}
    }
    std::vector<int> idle;
    if(!playing&&full&&elapsed(lastInput_)>=600&&layers.size()>1&&engine.cacheBytes()+frameCost_<=engine.budget()){
        for(int d=1;d<=std::min(2,int(layers.size())-1);++d){int l=(selected+d)%int(layers.size());idle.push_back(l);needed.insert(key(index,l));}
        engine.setBackgroundLimit(1);
    }
    engine.retainQueued(needed);
    // The foreground always enters before speculative work.
    if(!engine.has(key(index,selected)))request(index,selected);
    for(int n:missing)request(n,selected,false,false);
    for(int l:idle)request(index,l,false,false);
    std::vector<GpuPrepared> prepared;
    if(playing&&gpuEligible())for(int d=1;d<=2;++d){
        const int n=advance(index,d);if(n<0)break;
        auto pixels=engine.cached(key(n,selected));if(!pixels)break;
        prepared.push_back({qs(key(n,selected)),std::move(pixels)});
    }
    bool changed=prepared.size()!=gpuPrepared_.size();
    if(!changed)for(size_t i=0;i<prepared.size();++i)if(prepared[i].key!=gpuPrepared_[i].key){changed=true;break;}
    if(changed){gpuPrepared_=std::move(prepared);emit gpuFrameChanged();}
}

void Viewer::refresh(){softRefresh();thumbs.fill(QString(),int(layers.size()));}
void Viewer::softRefresh(){if(scheduleDirty_)++coalescedInputs_;scheduleDirty_=true;++generation;failed.clear();shownKey.clear();nextFrame=Clock::now();lastInput_=Clock::now();handoff_=playing;gpuPrepared_.clear();fastDirty_=true;stateDirty_=true;emit gpuFrameChanged();}
bool Viewer::gpuEligible() const {return gpuEnabled_&&!gpuFailed_&&!grid&&(mode==0||mode==2);}
void Viewer::displayRefresh(){
    ++generation;failed.clear();shownKey.clear();thumbs.fill(QString(),int(layers.size()));gpuPrepared_.clear();nextSchedule_=Clock::now();
    emit gpuFrameChanged();
    stateDirty_=true;emit changed();
}
void Viewer::gpuUnavailable(const QString& reason){
    if(gpuFailed_)return;
    gpuFailed_=true;gpuActive_=false;gpuFrame_.reset();source.clear();
    status="GPU 显示不可用，已回退 CPU："+reason;
    event("gpu.fallback",{{"reason",reason}});
    displayRefresh();emit gpuFrameChanged();emit imageSourceChanged();
}
void Viewer::gpuSubmitted(quint64 serial,quint64 gen,const QString& id,const QVariantMap& timing){
    const bool current=gpuEligible()&&gpuFrame_&&serial==gpuFrame_->serial&&gen==generation&&id==displayKey(index,selected);
    auto record=timing;record["serial"]=QVariant::fromValue(serial);record["accepted"]=current;
    event("gpu.submit",record);
    if(!current)return;
    accepted(gpuFrame_->pixels);
    shownKey=id;shownInfo=gpuFrame_->info;source="gpu://frame/"+QString::number(serial);
    title=QFileInfo(qs(sequence.files[index])).fileName();
    stateDirty_=true;emit imageSourceChanged();emit changed();
    event("frame.ready",{{"frame",sequence.numbers[index]},{"layer",selected},{"path","gpu"},
        {"stage","commands-recorded"},{"serial",QVariant::fromValue(serial)}});
}
void Viewer::open(const QUrl&url){
    auto path=url.isLocalFile()?url.toLocalFile():url.toString();
    if(path.isEmpty())return;
    beginOperation("open");shownIndex_=shownLayer_=-1;visiblePixels_.reset();gpuPrepared_.clear();scheduleDirty_=true;lastInput_=Clock::now();
    epoch=engine.reset();++generation;++document;failed.clear();opening=true;playing=false;grid=false;error.clear();stateDirty_=true;
    gpuFrame_.reset();gpuActive_=false;source.clear();emit gpuFrameChanged();emit imageSourceChanged();
    engine.open(utf(path),epoch);event("open.request",{{"path",path}});emit changed();
}
void Viewer::request(int frame,int layer,bool thumb,bool priority){
    auto id=key(frame,layer,thumb);if(id.empty()||failed.count(id))return;
    // ctx 是「层身份」：不含帧号，供引擎按「当前层 vs 其他层」做距离感知淘汰。
    const std::string ctx=std::to_string(document)+"|"+layers[layer].id+"|"+std::to_string(divisor)+(thumb?"|tile":"");
    const Json snapshot={{"generation",generation},{"document",document},{"frame",sequence.numbers[frame]},{"layer",layer},
        {"divisor",divisor},{"mode",mode},{"component",utf(component)},{"thumbnail",thumb},{"fps",fps},{"playing",playing}};
    engine.request(id,{{"file",sequence.files[frame]},{"view",layers[layer].request(utf(component))},{"divisor",divisor},{"maxEdge",thumb?300:0},{"taskSnapshot",snapshot}},epoch,priority,frame,ctx);
}
void Viewer::render(const std::shared_ptr<Frame>&frame,int layer,bool thumb,const std::string&id){
    const auto& originalPart=frame->metadata.at("sourceParts").at(layers[layer].part);
    const QString originalSize=QString::number(originalPart.at("width").get<int>())+" × "+QString::number(originalPart.at("height").get<int>());
    if(!thumb&&gpuEligible()){
        if(gpuFrame_&&gpuFrame_->generation==generation&&gpuFrame_->key==displayKey(index,layer))return;
        auto packet=std::make_shared<GpuFrame>();packet->pixels=frame;packet->key=displayKey(index,layer);packet->pixelKey=qs(id);
        packet->mapping=frame->displayMap(utf(component),layers[layer].color&&layers[layer].components.count(utf(component)));
        packet->serial=++gpuSerial_;packet->generation=generation;packet->layer=layer;packet->frameNumber=sequence.numbers[index];
        const auto& l=layers[layer];
        const bool colorLayer=l.color&&(component=="RGBA"||!l.components.count(utf(component)));
        packet->encodeSrgb=mode==0&&colorLayer;packet->compositeAlpha=colorLayer&&l.channels.size()==4;
        packet->gain=std::exp2(float(exposure));
        packet->info=qs(l.label)+" · "+component+"   "+originalSize;
        if(sequence.files.size()>1)packet->info+="   帧 "+QString::number(sequence.numbers[index]);
        gpuFrame_=std::move(packet);gpuActive_=true;stateDirty_=true;
        event("gpu.request",{{"frame",sequence.numbers[index]},{"layer",layer},{"serial",QVariant::fromValue(gpuSerial_)}});
        emit gpuFrameChanged();emit changed();return;
    }
    if(rendering)return;
    rendering=true;auto l=layers[layer];auto componentCopy=component;int modeCopy=mode;float exposureCopy=float(exposure);auto colorCopy=color;auto gen=generation;
    QString info=qs(l.label)+" · "+component+"   "+originalSize;
    if(sequence.files.size()>1)info+="   帧 "+QString::number(sequence.numbers[index]);
    renderFuture=std::async(std::launch::async,[=]{
        const auto started=Clock::now();Rendered result;result.pixels=frame;result.image=imageFor(*frame,l,componentCopy,modeCopy,exposureCopy,colorCopy);result.renderMs=elapsed(started);result.info=info;result.layer=layer;result.thumb=thumb;result.key=qs(id)+"#"+QString::number(gen);result.generation=gen;return result;
    });
}
void Viewer::requestColor(bool catalog){colorPending=true;catalogPending=catalogPending||catalog;stateDirty_=true;emit changed();}
void Viewer::tick(){
    bool dirty=false;
    if(autoCache_)updateCacheBudget();
    if(log.isOpen()&&Clock::now()>=nextLogFlush_){log.flush();nextLogFlush_=Clock::now()+std::chrono::milliseconds(500);}
    for(auto& done:engine.take()){
        if(done.epoch!=epoch)continue;
        nextSchedule_=Clock::now();
        if(done.frame){
            QVariantMap timing{{"key",qs(done.key)},{"jobId",QVariant::fromValue(done.jobId)},{"foregroundAtStart",done.foreground},{"guiWaitMs",elapsed(done.finished)},{"workerStartMs",std::chrono::duration<double,std::milli>(done.started-sessionStart_).count()},{"workerEndMs",std::chrono::duration<double,std::milli>(done.finished-sessionStart_).count()},{"queueWaitMs",done.queueMs},{"decodeAndPackMs",done.decodeMs},
                {"width",done.frame->width},{"height",done.frame->height},{"half",done.frame->half},
                {"cacheBytes",QVariant::fromValue(qulonglong(engine.cacheBytes()))}};
            if(done.frame->metadata.contains("diagnostics"))timing["diagnostics"]=jsonVariant(done.frame->metadata["diagnostics"]);
            timing["taskSnapshot"]=jsonVariant(done.taskSnapshot);
            event("decode.ready",timing);
        }
        if(!done.error.empty()){
            failed.insert(done.key);if(done.opened){opening=false;error=qs(done.error);}else if(done.key==key(index,selected)){error=qs(done.error);playing=false;}
            if(done.opened||done.key==key(index,selected))finishOperation("failed");
            event("read.error",{{"message",qs(done.error)}});dirty=true;continue;
        }
        if(done.opened){
            opening=false;sequence=std::move(done.sequence);index=int(sequence.index);layers=owl::desktop::layers(done.frame->metadata.at("sourceParts"));selected=0;divisor=defaultDivisor;component="RGBA";
            source.clear();emit imageSourceChanged();emit changedFast();shownKey.clear();store->clear();thumbs.fill(QString(),int(layers.size()));title=QFileInfo(qs(sequence.files[index])).fileName();status=qs(sequence.warning);
            if(layers.empty())error="EXR 中没有可显示的通道。";
            event("open.header",{{"layers",int(layers.size())},{"frames",int(sequence.files.size())}});dirty=true;
            // schedule() submits the first visible frame before any prefetch.
            nextSchedule_=Clock::now();
        }
    }
    if(colorBusy&&colorFuture.wait_for(std::chrono::seconds(0))==std::future_status::ready){
        colorBusy=false;
        try{auto result=colorFuture.get();if(!colorPending){color=std::move(result.bundle);colorCatalog=result.catalog;colorCatalogVariant_=jsonVariant(colorCatalog);colorSelection=result.selection;colorSelectionVariant_=jsonVariant(colorSelection);selectionVariantDirty_=false;status="OCIO 已加载。";displayRefresh();}}
        catch(const std::exception&e){error=QString("OCIO：")+qs(e.what());if(!color)mode=0;}
        dirty=true;
    }
    if(!colorBusy&&colorPending){
        auto selection=colorSelection;bool catalog=catalogPending||colorCatalog.is_null();auto previousCatalog=colorCatalog;
        colorPending=catalogPending=false;colorBusy=true;
        colorFuture=std::async(std::launch::async,[selection,catalog,previousCatalog]()mutable{
            ColorResult result;result.catalog=catalog?colorRequest({{"action","catalog"},{"source",selection["source"]}}):previousCatalog;
            auto& c=result.catalog;
            if(catalog){
                selection["input"]=c["input"];selection["display"]=c["display"];selection["view"]=c["defaults"][selection["display"].get<std::string>()];selection["lookMode"]="config";selection["look"]="";
            }
            result.bundle=processors(selection);result.selection=selection;return result;
        });dirty=true;
    }
    if(rendering&&renderFuture.wait_for(std::chrono::seconds(0))==std::future_status::ready){
        rendering=false;
        try{
            auto result=renderFuture.get();
            event("cpu.render",{{"renderMs",result.renderMs},{"thumbnail",result.thumb},{"accepted",result.generation==generation},{"key",result.key}});
            if(result.generation==generation){
                if(result.thumb){
                    QString id="tile"+QString::number(result.layer);store->put(id,result.image);thumbs[result.layer]="image://frames/"+id+"?"+QString::number(++revision);
                }else if(result.key==displayKey(index,selected)){
                    accepted(result.pixels);
                    gpuActive_=false;gpuFrame_.reset();emit gpuFrameChanged();
                    store->put("main",result.image);source="image://frames/main?"+QString::number(++revision);emit imageSourceChanged();shownKey=result.key;shownInfo=result.info;title=QFileInfo(qs(sequence.files[index])).fileName();
                    event("frame.ready",{{"frame",sequence.numbers[index]},{"layer",selected},{"path","cpu"},{"stage","image-ready"},{"renderMs",result.renderMs}});
                }dirty=true;
            }
        }catch(const std::exception&e){error=qs(e.what());failed.insert(key(index,selected));playing=false;dirty=true;}
    }
    if(!opening&&!sequence.files.empty()&&!layers.empty()){
        const auto now=Clock::now();
        const auto interval=std::chrono::microseconds(1000000/fps);
        if(playing&&!grid&&!handoff_&&shownKey==displayKey(index,selected)&&now>=nextFrame){
            if(index+1<int(sequence.files.size()))++index;
            else if(loop)index=0;
            else playing=false;
            nextFrame+=interval;fastDirty_=true;nextSchedule_=now;
        }
        if(grid){
            schedule();
            for(int l=0;l<int(layers.size());++l)if(thumbs.value(l).isEmpty()){
                auto id=key(index,l,true);auto frame=engine.cached(id);
                if(frame&&!rendering){render(frame,l,true,id);break;}
            }
        }else{
            const auto context=std::to_string(document)+"|"+layers[selected].id+"|"+std::to_string(divisor);
            engine.setPlayHead(context,index,int(sequence.files.size()),loop,shownLayer_==selected?shownIndex_:-1,std::max(1,fps/2));
            auto id=key(index,selected);auto frame=engine.cached(id);
            if(!frame&&playing&&!handoff_&&shownLayer_==selected&&now>=nextFrame){
                // Only inspect successors whose clock deadline has already arrived.
                const int due=std::min<int>(int(sequence.files.size())-1,1+int(std::chrono::duration_cast<std::chrono::microseconds>(now-nextFrame).count()/interval.count()));
                for(int d=1;d<=due;++d){
                    int n=index+d;if(n>=int(sequence.files.size())){if(!loop)break;n%=int(sequence.files.size());}
                    auto ready=engine.cached(key(n,selected));if(!ready)continue;
                    index=n;id=key(index,selected);frame=std::move(ready);nextFrame=now+interval;fastDirty_=true;nextSchedule_=now;
                    engine.setPlayHead(context,index,int(sequence.files.size()),loop,shownIndex_,std::max(1,fps/2));
                    event("playback.fallback",{{"targetIndex",index},{"displayedIndex",shownIndex_}});break;
                }
            }
            if(frame)frameCost_=frame->bytes();
            if(shownKey!=displayKey(index,selected)&&!failed.count(id)){
                if(frame&&(!rendering||gpuEligible()))render(frame,selected,false,id);
            }
            schedule();
        }
        if(now>=nextStats_){
            auto stats=jsonVariant(engine.statistics()).toMap();
            stats["continuousAhead"]=continuousAhead_;stats["targetIndex"]=index;stats["displayedIndex"]=shownIndex_;
            stats["targetLayer"]=selected;stats["displayedLayer"]=shownLayer_;stats["noOpInputs"]=QVariant::fromValue(noOpInputs_);
            stats["coalescedInputs"]=QVariant::fromValue(coalescedInputs_);stats["fps"]=fps;
            event("pipeline.stats",stats);nextStats_=now+std::chrono::seconds(1);
        }
    }
    if(fastDirty_){fastDirty_=false;stateDirty_=true;stateCache_["frameIndex"]=index;stateCache_["frame"]=frameNumber();emit changedFast();}
    if(dirty){stateDirty_=true;emit changed();}
}
void Viewer::saveSettings(){
    if(!QDir().mkpath(QFileInfo(settingsPath).absolutePath())){
        error="无法创建配置目录，请将软件放在可写目录："+QFileInfo(settingsPath).absolutePath();return;
    }
    QSaveFile file(settingsPath);
    QVariantMap values{{"cacheMode",autoCache_?"auto":"manual"},{"cacheGiB",manualCacheGiB_},{"defaultResolution",defaultDivisor},{"showHints",showHints},{"showInfo",showInfo}};
    const auto bytes=QJsonDocument::fromVariant(values).toJson();
    if(!file.open(QIODevice::WriteOnly)||file.write(bytes)!=bytes.size()||!file.commit())
        error="配置自动保存失败："+settingsPath+" · "+file.errorString();
}
void Viewer::command(const QString&name,const QVariant&value){
    event("command",{{"name",name},{"value",value}});
    if(name=="clearError")error.clear();
    else if(name=="copyError")QGuiApplication::clipboard()->setText(error);
    else if(name=="play"){
        if(sequence.files.size()>1){
            playing=!playing;grid=false;handoff_=shownKey!=displayKey(index,selected);
            nextFrame=Clock::now()+std::chrono::microseconds(1000000/fps);scheduleDirty_=true;lastInput_=Clock::now();
        }
    }
    else if(name=="restart"){
        if(!sequence.files.empty()){index=0;playing=sequence.files.size()>1;grid=false;beginOperation("restart");softRefresh();}
    }
    else if(name=="seek"||name=="step"){
        if(!sequence.files.empty()){
            const int target=std::clamp(name=="step"?index+value.toInt():value.toInt(),0,int(sequence.files.size())-1);
            if(target==index&&!playing&&!grid){++noOpInputs_;return;}
            index=target;playing=false;grid=false;beginOperation("seek");softRefresh();
        }
    }
    else if(name=="layer"||name=="nextLayer"){
        if(!layers.empty()){
            const int target=name=="nextLayer"?(selected+1)%int(layers.size()):std::clamp(value.toInt(),0,int(layers.size())-1);
            if(target==selected&&!grid){++noOpInputs_;return;}
            selected=target;grid=false;
            if(playing&&shownIndex_>=0){
                index=shownIndex_;
                if(!engine.has(key(index,selected))){
                    if(index+1<int(sequence.files.size()))++index;else if(loop)index=0;
                }
            }
            frameCost_=64*MiB;beginOperation("layer");softRefresh();
            event("selection.request",{{"layer",selected},{"targetIndex",index}});
        }
    }
    else if(name=="component"){
        const auto target=value.toString();
        if(target==component){++noOpInputs_;return;}
        if(target!="RGBA"&&target!="R"&&target!="G"&&target!="B"&&target!="A")return;
        component=target;beginOperation("component");displayRefresh();
    }
    else if(name=="grid"){grid=!grid;playing=false;finishOperation("cancelled");refresh();}
    else if(name=="resolution"){
        const int target=value.toInt();
        if(target==divisor){++noOpInputs_;return;}
        if(target==1||target==2||target==3||target==4||target==8){divisor=target;frameCost_=64*MiB;beginOperation("resolution");refresh();}
    }
    else if(name=="defaultResolution"){int v=value.toInt();if(v==1||v==2||v==3||v==4||v==8)defaultDivisor=v;}
    else if(name=="fps"){fps=std::clamp(value.toInt(),1,120);nextFrame=Clock::now()+std::chrono::microseconds(1000000/fps);nextSchedule_=Clock::now();}
    else if(name=="loop"){loop=value.toBool();scheduleDirty_=true;}
    else if(name=="showHints")showHints=value.toBool();
    else if(name=="showInfo")showInfo=value.toBool();
    else if(name=="recordPerformance"){if(logging)stopRecording("user-stop");else startRecording();}
    else if(name=="cache"){double v=value.toDouble();if(std::isfinite(v)){manualCacheGiB_=std::clamp(v,.125,64.);if(!autoCache_)updateCacheBudget(true);}}
    else if(name=="cacheAutomatic"){if(autoCache_!=value.toBool()){autoCache_=value.toBool();updateCacheBudget(true);}}
    else if(name=="logs"){
        const auto folder=QCoreApplication::applicationDirPath()+"/logs";
        if(!QDir().mkpath(folder))error="无法创建日志目录。";
        else QDesktopServices::openUrl(QUrl::fromLocalFile(folder));
    }
    else if(name=="exposure"){const double target=std::clamp(value.toDouble(),-8.,8.);if(!std::isfinite(target)||target==exposure){++noOpInputs_;return;}exposure=target;beginOperation("exposure");displayRefresh();}
    else if(name=="mode"){const int target=std::clamp(value.toInt(),0,3);if(target==mode){++noOpInputs_;return;}mode=target;beginOperation("display");if(mode==1&&!color)requestColor(true);displayRefresh();}
    else if(name=="colorSource"){auto url=QUrl(value.toString());colorSelection["source"]=utf(url.isLocalFile()?url.toLocalFile():value.toString());selectionVariantDirty_=true;requestColor(true);}
    else if(name=="colorInput"){colorSelection["input"]=utf(value.toString());selectionVariantDirty_=true;requestColor();}
    else if(name=="colorDisplay"){auto display=utf(value.toString());colorSelection["display"]=display;if(colorCatalog.contains("defaults")&&colorCatalog["defaults"].contains(display))colorSelection["view"]=colorCatalog["defaults"][display];selectionVariantDirty_=true;requestColor();}
    else if(name=="colorView"){colorSelection["view"]=utf(value.toString());selectionVariantDirty_=true;requestColor();}
    else if(name=="colorLook"){auto look=value.toString();colorSelection["lookMode"]=look=="跟随配置"?"config":look=="无 Look"?"none":"override";colorSelection["look"]=utf(look);selectionVariantDirty_=true;requestColor();}
    if(name=="cache"||name=="cacheAutomatic"||name=="defaultResolution"||name=="showHints"||name=="showInfo")saveSettings();
    stateDirty_=true;emit changed();
}
