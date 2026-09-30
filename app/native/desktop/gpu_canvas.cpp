// SPDX-License-Identifier: GPL-3.0-or-later
#include "gpu_canvas.hpp"
#include "upload_payload.hpp"
#include <QFile>
#include <QMatrix4x4>
#include <rhi/qrhi.h>
#include <rhi/qshader.h>
#include <algorithm>
#include <cstring>
#include <map>
#include <set>

namespace {
QShader shader(const char* path){
    QFile file(QString::fromUtf8(path));
    return file.open(QIODevice::ReadOnly)?QShader::fromSerialized(file.readAll()):QShader();
}
// QRhi retires resources after the frame that can still reference them.
template<class T> struct RhiDelete { void operator()(T* resource) const { if(resource)resource->deleteLater(); } };
template<class T> using RhiPtr=std::unique_ptr<T,RhiDelete<T>>;
class CanvasRenderer final:public QQuickRhiItemRenderer {
    struct SlotLayout {
        QSize size;
        QRhiTexture::Format format=QRhiTexture::RGBA16F;
        uint64_t deviceGeneration=0;
        // All slots use sampleCount=1 and default usage flags.
        bool operator==(const SlotLayout& other) const {
            return size==other.size&&format==other.format&&deviceGeneration==other.deviceGeneration;
        }
    };
    struct TextureSlot {
        RhiPtr<QRhiTexture> texture;
        RhiPtr<QRhiShaderResourceBindings> bindings;
        SlotLayout layout;
        quint64 identity=0,contentVersion=0;
        size_t bytes=0;
        quint64 used=0;
    };
    using Entry=TextureSlot;
    struct Upload {
        quint64 bytes=0,layoutBytes=0;
        double cpuMs=0,layoutMs=0,prepareMs=0,resourceMs=0,commandMs=0;
        bool slotReused=false;
    };
    QRhi* device_=nullptr;
    QPointer<GpuCanvas> owner_;
    std::shared_ptr<const GpuFrame> frame_;
    std::shared_ptr<const GpuFrame> displayed_;
    std::unique_ptr<UploadPreparer> preparer_;
    std::vector<GpuPrepared> prepared_;
    std::map<QString,Entry> cache_;
    RhiPtr<QRhiSampler> sampler_;
    RhiPtr<QRhiBuffer> uniforms_;
    RhiPtr<QRhiGraphicsPipeline> pipeline_;
    QSizeF itemSize_;
    float zoom_=1,panX_=0,panY_=0;
    size_t bytes_=0,budget_=1024*owl::MiB;
    quint64 use_=0,submitted_=0,uploads_=0,hits_=0,preuploads_=0,evictions_=0,reductions_=0;
    quint64 deviceGeneration_=0,targetGeneration_=0,created_=0,reused_=0,retired_=0,retiredBytes_=0;
    quint64 currentUploadBytes_=0,preuploadBytes_=0,waits_=0;
    bool reuseSlots_=qEnvironmentVariableIntValue("OWLSIGHT_DISABLE_TEXTURE_POOL")==0;
    bool asyncUpload_=qEnvironmentVariableIntValue("OWLSIGHT_DISABLE_UPLOAD_PREPARE")==0;
    bool failed_=false;
    owl::Clock::time_point nextStats_=owl::Clock::now();

    void fail(const QString& reason){
        if(failed_)return;failed_=true;auto owner=owner_;
        if(owner)QMetaObject::invokeMethod(owner,[owner,reason]{if(owner)emit owner->unavailable(reason);},Qt::QueuedConnection);
    }
    void release(){
        preparer_.reset();displayed_.reset();pipeline_.reset();
        for(const auto& item:cache_){++retired_;retiredBytes_+=item.second.bytes;}
        cache_.clear();uniforms_.reset();sampler_.reset();bytes_=0;
    }
    bool makeRoom(size_t incoming,const std::set<QString>& protectedKeys){
        while(bytes_+incoming>budget_){
            auto victim=cache_.end();
            for(auto it=cache_.begin();it!=cache_.end();++it)
                if(!protectedKeys.count(it->first)&&(victim==cache_.end()||it->second.used<victim->second.used))victim=it;
            if(victim==cache_.end())return false;
            bytes_-=victim->second.bytes;retiredBytes_+=victim->second.bytes;++retired_;cache_.erase(victim);++evictions_;
        }
        return true;
    }
    bool common(){
        if(!sampler_){
            sampler_.reset(device_->newSampler(QRhiSampler::Nearest,QRhiSampler::Nearest,QRhiSampler::None,
                QRhiSampler::ClampToEdge,QRhiSampler::ClampToEdge));
            if(!sampler_->create()){fail(QStringLiteral("GPU 采样器创建失败。"));return false;}
        }
        if(!uniforms_){
            uniforms_.reset(device_->newBuffer(QRhiBuffer::Dynamic,QRhiBuffer::UniformBuffer,144));
            if(!uniforms_->create()){fail(QStringLiteral("GPU 参数缓冲创建失败。"));return false;}
        }
        return true;
    }
    UploadRequest uploadRequest(const QString& key,const std::shared_ptr<const owl::desktop::Frame>& pixels){
        int channels=pixels->channels==1?1:4;
        const auto scalar=pixels->half?QRhiTexture::R16F:QRhiTexture::R32F;
        if(channels==1&&!device_->isTextureFormatSupported(scalar))channels=4;
        return {key,pixels,targetGeneration_,channels};
    }
    Entry* texture(const UploadRequest& request,QRhiResourceUpdateBatch* updates,
                   bool speculative,const std::set<QString>& protectedKeys,Upload& upload){
        auto cached=cache_.find(request.key);
        if(cached!=cache_.end()){cached->second.used=++use_;return &cached->second;}
        const auto started=owl::Clock::now();
        const auto ticket=asyncUpload_?preparer_->ready(request.key,request.generation):UploadPreparer::prepare(request);
        if(!ticket){if(!speculative)++waits_;return nullptr;}
        if(!ticket->error.isEmpty()){if(!speculative)fail(ticket->error);return nullptr;}
        const auto format=ticket->storageChannels==1?(ticket->half?QRhiTexture::R16F:QRhiTexture::R32F):
            (ticket->half?QRhiTexture::RGBA16F:QRhiTexture::RGBA32F);
        const QSize size(ticket->width,ticket->height);
        const int limit=device_->resourceLimit(QRhi::TextureSizeMax);
        if(size.width()>limit||size.height()>limit||!device_->isTextureFormatSupported(format)){
            if(!speculative)fail(QStringLiteral("显卡不支持当前浮点图像布局，已返回 CPU 显示。"));return nullptr;
        }
        const size_t cost=size_t(ticket->data.size());
        if(cost>budget_){if(!speculative)fail(QStringLiteral("当前帧超过显存缓存预算，已返回 CPU 显示。"));return nullptr;}
        const auto resourceStart=owl::Clock::now();
        const SlotLayout layout{size,format,deviceGeneration_};
        Entry entry;
        // Content is evicted independently from the texture and its compatible bindings.
        // QRhi orders repeated uploads on this render thread. Never overwrite any slot
        // used by this pass, including the retained image while a target is preparing.
        if(reuseSlots_&&bytes_+cost>budget_){
            auto victim=cache_.end();
            for(auto it=cache_.begin();it!=cache_.end();++it)
                if(!protectedKeys.count(it->first)&&it->second.layout==layout&&
                   (victim==cache_.end()||it->second.used<victim->second.used))victim=it;
            if(victim!=cache_.end()){
                entry=std::move(victim->second);bytes_-=entry.bytes;cache_.erase(victim);
                ++evictions_;++reused_;++entry.contentVersion;upload.slotReused=true;
            }
        }
        if(!entry.texture){
            if(!makeRoom(cost,protectedKeys)){
                if(!speculative)fail(QStringLiteral("显存预算不足以同时保留当前图像和新目标，已返回 CPU 显示。"));return nullptr;
            }
            entry.layout=layout;
            entry.texture.reset(device_->newTexture(format,size,1));
            if(!entry.texture->create()){
                entry.texture.reset();
                budget_=std::max(cost,budget_/2);++reductions_;makeRoom(0,protectedKeys);
                if(speculative)return nullptr;
                if(!makeRoom(cost,protectedKeys)){fail(QStringLiteral("GPU 纹理预算不足，已返回 CPU 显示。"));return nullptr;}
                entry.texture.reset(device_->newTexture(format,size,1));
                if(!entry.texture->create()){fail(QStringLiteral("GPU 纹理分配失败，已返回 CPU 显示。"));return nullptr;}
            }
            entry.identity=++created_;entry.contentVersion=1;
            entry.bindings.reset(device_->newShaderResourceBindings());
            entry.bindings->setBindings({
                QRhiShaderResourceBinding::uniformBuffer(0,QRhiShaderResourceBinding::VertexStage|QRhiShaderResourceBinding::FragmentStage,uniforms_.get()),
                QRhiShaderResourceBinding::sampledTexture(1,QRhiShaderResourceBinding::FragmentStage,entry.texture.get(),sampler_.get())
            });
            if(!entry.bindings->create()){
                ++retired_;retiredBytes_+=cost;
                if(!speculative)fail(QStringLiteral("GPU 纹理绑定失败。"));return nullptr;
            }
        }
        upload.resourceMs=owl::elapsed(resourceStart);
        const auto commandStart=owl::Clock::now();
        // QByteArray is owning and implicitly shared; QRhi keeps its own reference.
        // Neither the worker nor the renderer writes this buffer after publication.
        QRhiTextureSubresourceUploadDescription description(ticket->data);
        description.setSourceSize(size);description.setDataStride(ticket->stride);
        updates->uploadTexture(entry.texture.get(),QRhiTextureUploadDescription({QRhiTextureUploadEntry(0,0,description)}));
        upload.commandMs=owl::elapsed(commandStart);
        entry.bytes=cost;entry.used=++use_;bytes_+=cost;
        upload.bytes=cost;upload.cpuMs=owl::elapsed(started);upload.prepareMs=ticket->prepareMs;
        upload.layoutBytes=ticket->layoutBytes;upload.layoutMs=ticket->layoutMs;
        ++uploads_;if(speculative){++preuploads_;preuploadBytes_+=cost;}else currentUploadBytes_+=cost;
        return &cache_.emplace(request.key,std::move(entry)).first->second;
    }
    bool pipeline(Entry* entry){
        if(pipeline_)return true;
        auto vert=shader(":/gpu/preview.vert.qsb"),frag=shader(":/gpu/preview.frag.qsb");
        if(!vert.isValid()||!frag.isValid()){fail(QStringLiteral("GPU 着色器不可用。"));return false;}
        pipeline_.reset(device_->newGraphicsPipeline());
        pipeline_->setShaderStages({{QRhiShaderStage::Vertex,vert},{QRhiShaderStage::Fragment,frag}});
        pipeline_->setVertexInputLayout(QRhiVertexInputLayout());
        pipeline_->setShaderResourceBindings(entry->bindings.get());
        pipeline_->setRenderPassDescriptor(renderTarget()->renderPassDescriptor());
        pipeline_->setSampleCount(renderTarget()->sampleCount());
        if(!pipeline_->create()){fail(QStringLiteral("GPU 显示管线创建失败。"));return false;}
        return true;
    }
    QVariantMap statistics() const {
        return {{"textureBytes",QVariant::fromValue(quint64(bytes_))},{"textureBudgetBytes",QVariant::fromValue(quint64(budget_))},
            {"textureFrames",int(cache_.size())},{"uploads",QVariant::fromValue(uploads_)},{"hits",QVariant::fromValue(hits_)},
            {"preuploads",QVariant::fromValue(preuploads_)},{"evictions",QVariant::fromValue(evictions_)},
            {"textureCreates",QVariant::fromValue(created_)},{"slotReuses",QVariant::fromValue(reused_)},
            {"textureRetireRequests",QVariant::fromValue(retired_)},{"retiredBytesCumulative",QVariant::fromValue(retiredBytes_)},
            {"deviceGeneration",QVariant::fromValue(deviceGeneration_)},{"ticketWaits",QVariant::fromValue(waits_)},
            {"currentUploadBytesTotal",QVariant::fromValue(currentUploadBytes_)},{"preuploadBytesTotal",QVariant::fromValue(preuploadBytes_)},
            {"texturePoolEnabled",reuseSlots_},{"asyncUploadEnabled",asyncUpload_},
            {"ticketPreparation",preparer_?preparer_->statistics():QVariantMap()},
            {"budgetReductions",QVariant::fromValue(reductions_)},{"graphicsApi",int(device_->backend())},
            {"memoryBoundary","resident source slots only (no idle pool); retired bytes are cumulative requests, not pending GPU memory; ticket budget excludes QRhi staging, retained raw pixels, Qt targets and driver storage"}};
    }
    void clear(QRhiCommandBuffer* cb){cb->beginPass(renderTarget(),Qt::transparent,{1.f,0});cb->endPass();}
public:
    ~CanvasRenderer() override {release();}
    void initialize(QRhiCommandBuffer*) override {
        if(device_!=rhi()){release();device_=rhi();++deviceGeneration_;submitted_=0;failed_=false;}
        pipeline_.reset();
    }
    void synchronize(QQuickRhiItem* item) override {
        auto* canvas=static_cast<GpuCanvas*>(item);owner_=canvas;
        frame_=canvas->viewer()?canvas->viewer()->gpuFrame():nullptr;
        targetGeneration_=canvas->viewer()?canvas->viewer()->gpuGeneration():0;
        prepared_=canvas->viewer()?canvas->viewer()->gpuPrepared():std::vector<GpuPrepared>{};
        itemSize_=QSizeF(canvas->width(),canvas->height());
        zoom_=float(canvas->zoom());panX_=float(canvas->panX());panY_=float(canvas->panY());
    }
    void render(QRhiCommandBuffer* cb) override {
        if(failed_||!frame_||!frame_->pixels||itemSize_.isEmpty()){
            if(preparer_)preparer_->request({});displayed_.reset();clear(cb);return;
        }
        const auto started=owl::Clock::now();
        if(!common()){clear(cb);return;}
        if(asyncUpload_&&!preparer_){
            auto owner=owner_;
            preparer_=std::make_unique<UploadPreparer>([owner]{
                if(owner)QMetaObject::invokeMethod(owner,[owner]{if(owner)owner->update();},Qt::QueuedConnection);
            });
        }
        const bool desiredCurrent=frame_->generation==targetGeneration_;
        std::vector<UploadRequest> desired;
        if(desiredCurrent){
            if(!cache_.count(frame_->pixelKey))desired.push_back(uploadRequest(frame_->pixelKey,frame_->pixels));
            for(const auto& item:prepared_)if(!cache_.count(item.key))desired.push_back(uploadRequest(item.key,item.pixels));
        }
        if(preparer_)preparer_->request(std::move(desired));
        auto* updates=device_->nextResourceUpdateBatch();
        Upload upload,extra;
        std::set<QString> protectedKeys{frame_->pixelKey};
        if(displayed_)protectedKeys.insert(displayed_->pixelKey);
        Entry* current=desiredCurrent?texture(uploadRequest(frame_->pixelKey,frame_->pixels),updates,false,protectedKeys,upload):nullptr;
        const bool targetReady=current!=nullptr;
        auto drawing=frame_;
        if(!current&&displayed_){
            const auto it=cache_.find(displayed_->pixelKey);
            if(it!=cache_.end()){current=&it->second;drawing=displayed_;}
        }
        if(!current||!pipeline(current)){updates->release();clear(cb);return;}
        if(targetReady&&!upload.bytes&&submitted_!=frame_->serial)++hits_;
        const auto& pixels=*drawing->pixels;
        const QSize target=renderTarget()->pixelSize();
        const auto drawStart=owl::Clock::now();
        float values[36]={};const auto correction=device_->clipSpaceCorrMatrix();std::memcpy(values,correction.constData(),64);
        values[16]=float(target.width());values[17]=float(target.height());
        values[18]=float(target.width()/itemSize_.width());values[19]=float(target.height()/itemSize_.height());
        values[20]=float(pixels.width);values[21]=float(pixels.height);values[22]=drawing->gain;
        values[24]=std::max(zoom_,.0001f);values[25]=panX_;values[26]=panY_;
        values[28]=drawing->encodeSrgb?1.f:0.f;values[29]=drawing->compositeAlpha?1.f:0.f;
        for(int c=0;c<4;++c)values[32+c]=float(drawing->mapping[c]);
        updates->updateDynamicBuffer(uniforms_.get(),0,sizeof(values),values);
        cb->beginPass(renderTarget(),Qt::transparent,{1.f,0},updates);
        cb->setGraphicsPipeline(pipeline_.get());cb->setViewport(QRhiViewport(0,0,float(target.width()),float(target.height())));
        cb->setShaderResources(current->bindings.get());cb->setVertexInput(0,0,nullptr);cb->draw(3);cb->endPass();
        const double drawMs=owl::elapsed(drawStart),currentRecordMs=owl::elapsed(started);
        if(targetReady)displayed_=frame_;
        // Current drawing is recorded first; at most one prepared successor is uploaded.
        bool uploadedAhead=false;
        if(targetReady&&!upload.bytes){
            protectedKeys.insert(drawing->pixelKey);
            for(const auto& item:prepared_)protectedKeys.insert(item.key);
            for(const auto& item:prepared_){
                if(cache_.count(item.key))continue;
                auto* background=device_->nextResourceUpdateBatch();
                uploadedAhead=texture(uploadRequest(item.key,item.pixels),background,true,protectedKeys,extra)!=nullptr;
                if(uploadedAhead)cb->resourceUpdate(background);else background->release();
                break;
            }
        }
        auto timing=statistics();
        timing["uploadBytes"]=QVariant::fromValue(upload.bytes);timing["uploadCpuMs"]=upload.cpuMs;
        timing["layoutCopyBytes"]=QVariant::fromValue(upload.layoutBytes);timing["layoutCpuMs"]=upload.layoutMs;
        timing["prepareCpuMs"]=upload.prepareMs;timing["resourceCpuMs"]=upload.resourceMs;timing["uploadCommandCpuMs"]=upload.commandMs;
        timing["slotReused"]=upload.slotReused;timing["slotIdentity"]=QVariant::fromValue(current->identity);
        timing["slotContentVersion"]=QVariant::fromValue(current->contentVersion);
        timing["preuploadBytes"]=QVariant::fromValue(extra.bytes);timing["preuploadCpuMs"]=extra.cpuMs;
        timing["preuploadPrepareCpuMs"]=extra.prepareMs;timing["preuploadResourceCpuMs"]=extra.resourceMs;
        timing["preuploadCommandCpuMs"]=extra.commandMs;timing["preuploadSlotReused"]=extra.slotReused;
        timing["drawRecordCpuMs"]=drawMs;timing["currentRecordCpuMs"]=currentRecordMs;
        timing["recordCpuMs"]=owl::elapsed(started);timing["queueToRecordMs"]=owl::elapsed(frame_->queued);
        timing["textureReused"]=upload.bytes==0;timing["targetReady"]=targetReady;
        timing["frame"]=QVariant::fromValue(drawing->frameNumber);timing["layer"]=drawing->layer;
        timing["width"]=pixels.width;timing["height"]=pixels.height;timing["half"]=pixels.half;timing["pixelKey"]=drawing->pixelKey;
        bool submitted=false;
        if(targetReady&&submitted_!=frame_->serial){
            submitted=true;submitted_=frame_->serial;auto owner=owner_;const auto serial=frame_->serial,gen=frame_->generation;const auto key=frame_->key;
            if(owner)QMetaObject::invokeMethod(owner,[owner,serial,gen,key,timing]{if(owner)emit owner->submitted(serial,gen,key,timing);},Qt::QueuedConnection);
        }
        if((uploadedAhead&&!submitted)||owl::Clock::now()>=nextStats_){
            auto owner=owner_;nextStats_=owl::Clock::now()+std::chrono::milliseconds(500);
            if(owner)QMetaObject::invokeMethod(owner,[owner,timing]{if(owner)emit owner->cacheStatistics(timing);},Qt::QueuedConnection);
        }
        // Drop consumed owners before the worker admits another payload. QRhi retains
        // immutable byte ownership for submitted updates independently of this queue.
        if(preparer_){
            std::vector<UploadRequest> remaining;
            if(desiredCurrent){
                if(!cache_.count(frame_->pixelKey))remaining.push_back(uploadRequest(frame_->pixelKey,frame_->pixels));
                for(const auto& item:prepared_)if(!cache_.count(item.key))remaining.push_back(uploadRequest(item.key,item.pixels));
            }
            preparer_->request(std::move(remaining));
        }
        if(upload.bytes||uploadedAhead)for(const auto& item:prepared_)if(!cache_.count(item.key)){update();break;}
    }
};
}

GpuCanvas::GpuCanvas(QQuickItem* parent):QQuickRhiItem(parent){setAlphaBlending(true);}
void GpuCanvas::setViewer(Viewer* value){
    if(viewer_==value)return;
    if(viewer_)disconnect(viewer_,nullptr,this,nullptr);
    disconnect(this,&GpuCanvas::submitted,nullptr,nullptr);disconnect(this,&GpuCanvas::unavailable,nullptr,nullptr);
    disconnect(this,&GpuCanvas::cacheStatistics,nullptr,nullptr);
    viewer_=value;
    if(value){
        connect(value,&Viewer::gpuFrameChanged,this,[this]{update();});
        connect(this,&GpuCanvas::submitted,value,&Viewer::gpuSubmitted);
        connect(this,&GpuCanvas::unavailable,value,&Viewer::gpuUnavailable);
        connect(this,&GpuCanvas::cacheStatistics,value,&Viewer::gpuStatistics);
    }
    emit viewerChanged();update();
}
void GpuCanvas::setZoom(qreal v){if(zoom_==v)return;zoom_=v;emit viewChanged();update();}
void GpuCanvas::setPanX(qreal v){if(panX_==v)return;panX_=v;emit viewChanged();update();}
void GpuCanvas::setPanY(qreal v){if(panY_==v)return;panY_=v;emit viewChanged();update();}
QQuickRhiItemRenderer* GpuCanvas::createRenderer(){return new CanvasRenderer;}
