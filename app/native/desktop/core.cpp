// SPDX-License-Identifier: GPL-3.0-or-later
#include "core.hpp"
#include <windows.h>
#include <psapi.h>
#include <shlwapi.h>
#include <algorithm>
#include <array>
#include <cstdlib>
#include <cstring>
#include <map>
#include <regex>
#include <system_error>
#include <set>
#include <limits>
namespace owl {
double elapsed(Clock::time_point start){return std::chrono::duration<double,std::milli>(Clock::now()-start).count();}
Json processSample(){
    PROCESS_MEMORY_COUNTERS_EX memory{};memory.cb=sizeof(memory);
    Json value={{"pid",GetCurrentProcessId()}};
    if(GetProcessMemoryInfo(GetCurrentProcess(),reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory),sizeof(memory))){
        value["workingSetMiB"]=double(memory.WorkingSetSize)/MiB;value["privateMiB"]=double(memory.PrivateUsage)/MiB;
    }
    return value;
}
// The helper supplies a byte-stream adapter; desktop consumes shared results.
void writeFrame(const Json&,const void*,size_t){throw std::logic_error("Desktop preview requires shared pixels.");}
namespace desktop {
std::shared_ptr<Frame> decode(Preview& decoder,const Json& request){
    auto output=decoder.result(request);
    auto frame=std::make_shared<Frame>();frame->metadata=std::move(output.metadata);frame->pixels=std::move(output.pixels);
    if(frame->pixels){
        frame->width=frame->pixels->width;frame->height=frame->pixels->height;
        frame->channels=int(frame->pixels->channels.size());frame->half=frame->pixels->half;
        frame->mapping=frame->metadata.at("channelMap").get<std::array<int,4>>();
        const auto& diagnostics=frame->metadata.at("diagnostics");
        frame->decodeWorkingBytes=diagnostics.value("sourcePlaneBytes",frame->bytes())+
            diagnostics.value("previewCopyBytes",size_t(0))+32*MiB;
        frame->metadata["diagnostics"]["rgbaPackMs"]=0;
        frame->metadata["diagnostics"]["rgbaReorderCopyBytes"]=0;
        frame->metadata["diagnostics"]["liveUniquePixelBytes"]=Plane::liveBytes();
    }
    return frame;
}
Json Layer::request(const std::string& component) const {
    auto names=channels;
    // Display components reuse this layer\'s original pixels.
    return {{"partIndex",part},{"partName",partName},{"channels",names},{"range",false}};
}
std::vector<Layer> layers(const Json& parts){
    std::vector<Layer> groups,singles;std::set<std::string> covered;
    auto upper=[](std::string s){for(auto& c:s)c=char(std::toupper(static_cast<unsigned char>(c)));return s;};
    for(size_t p=0;p<parts.size();++p){
        const auto& part=parts[p];const auto partName=part.value("name",std::string());
        auto label=[&](const std::string& name){
            if(!partName.empty()&&(name==partName||name.rfind(partName+".",0)==0))return name;
            return (parts.size()>1?(partName.empty()?"Part "+std::to_string(p+1):partName)+" / ":"")+name;
        };
        std::map<std::string,std::unordered_map<std::string,std::string>> prefixes;
        for(const auto& value:part.at("channels")){
            const auto name=value.get<std::string>();const auto dot=name.find_last_of('.');
            const auto prefix=dot==std::string::npos?"":name.substr(0,dot);
            const auto suffix=upper(dot==std::string::npos?name:name.substr(dot+1));prefixes[prefix][suffix]=name;
            Layer v;v.part=int(p);v.partName=partName;v.id=std::to_string(p)+":c"+name;v.label=label(name);v.channels={name,name,name};singles.push_back(v);
        }
        for(const auto& [prefix,channels]:prefixes){
            bool rgb=channels.count("R")&&channels.count("G")&&channels.count("B");
            bool xyz=channels.count("X")&&channels.count("Y")&&channels.count("Z");
            if(!rgb&&!xyz)continue;
            Layer v;v.part=int(p);v.partName=partName;v.id=std::to_string(p)+":g"+prefix;v.color=rgb;v.components=channels;
            v.label=label(prefix.empty()?(rgb?"RGB":"XYZ"):prefix);
            for(const char* c:rgb?std::array<const char*,3>{"R","G","B"}:std::array<const char*,3>{"X","Y","Z"})v.channels.push_back(channels.at(c));
            if(rgb&&channels.count("A"))v.channels.push_back(channels.at("A"));
            for(const auto& name:v.channels)covered.insert(std::to_string(p)+":c"+name);
            groups.push_back(v);
        }
    }
    const std::regex beauty("(^|[. /])(combined|beauty|rgba?|rgb)$",std::regex::icase);
    std::sort(groups.begin(),groups.end(),[&](const auto&a,const auto&b){bool x=std::regex_search(a.label,beauty),y=std::regex_search(b.label,beauty);return x!=y?x:a.label<b.label;});
    std::sort(singles.begin(),singles.end(),[](const auto&a,const auto&b){return a.label<b.label;});
    for(auto& v:singles)if(!covered.count(v.id))groups.push_back(std::move(v));
    return groups;
}
namespace {
struct Pattern{std::string prefix;long long number;size_t width,fieldWidth;};
bool pattern(const std::string& name,Pattern& out){
    static const std::regex re("^(.*?)([0-9]+)(\\.exr)$",std::regex::icase),version("(^|[._-])v$",std::regex::icase),negative("(^|[._-])-$");
    std::smatch m;if(!std::regex_match(name,m,re)||std::regex_search(m[1].str(),version))return false;
    auto prefix=m[1].str(),digits=m[2].str(),field=digits;
    if(std::regex_search(prefix,negative)){prefix.pop_back();field="-"+field;}
    try{auto n=std::stoll(field);if(n>9007199254740991LL||n< -9007199254740991LL)return false;out={prefix,n,digits.size()>1&&digits[0]=='0'?field.size():0,field.size()};return true;}catch(...){return false;}
}
bool exr(const std::filesystem::path& p){auto e=p.extension().u8string();for(auto&c:e)c=char(std::tolower(static_cast<unsigned char>(c)));return e==".exr";}
}
Sequence discover(const std::string& input,const std::function<bool()>& current){
    namespace fs=std::filesystem;auto target=fs::u8path(input);
    auto scan=[&](const fs::path& folder){
        std::vector<fs::path> files;size_t count=0;auto start=Clock::now();
        for(const auto& entry:fs::directory_iterator(folder)){
            if(!current())throw std::runtime_error("旧文件读取已取消。");
            if(++count>100000||elapsed(start)>5000)throw std::runtime_error("目录过大或读取过慢，请直接打开单帧。");
            if(entry.is_regular_file()&&exr(entry.path()))files.push_back(entry.path());
            if(files.size()>20000)throw std::runtime_error("目录中的 EXR 超过 20000 个。");
        }return files;
    };
    std::vector<fs::path> candidates;
    if(fs::is_directory(target)){
        candidates=scan(target);if(candidates.empty())throw std::runtime_error("此文件夹内没有 EXR 文件。");
        std::sort(candidates.begin(),candidates.end(),[](const auto&a,const auto&b){int c=StrCmpLogicalW(a.filename().c_str(),b.filename().c_str());return c?c<0:a.filename()<b.filename();});
        auto it=std::find_if(candidates.begin(),candidates.end(),[](const auto&p){Pattern n;return pattern(p.filename().u8string(),n);});
        target=it==candidates.end()?candidates[0]:*it;
    }
    if(!fs::is_regular_file(target)||!exr(target))throw std::runtime_error("请选择 EXR 文件或序列文件夹。");
    Sequence result;result.files={target.u8string()};result.numbers={0};
    Pattern own;if(!pattern(target.filename().u8string(),own))return result;
    result.numbers={own.number};
    try {
        if(candidates.empty())candidates=scan(target.parent_path());
        struct Item{Pattern p;fs::path file;};std::vector<Item> matches;size_t shortest=std::numeric_limits<size_t>::max();
        for(const auto& file:candidates){Pattern p;if(pattern(file.filename().u8string(),p)&&p.prefix==own.prefix){matches.push_back({p,file});if(!p.width)shortest=std::min(shortest,p.fieldWidth);}}
        size_t width=own.width;
        if(!width&&shortest>=own.fieldWidth&&std::any_of(matches.begin(),matches.end(),[&](const auto&x){return x.p.width==own.fieldWidth;}))width=own.fieldWidth;
        matches.erase(std::remove_if(matches.begin(),matches.end(),[&](const auto&x){return width?!(x.p.width==width||(!x.p.width&&x.p.fieldWidth==width&&shortest>=width)):x.p.width!=0;}),matches.end());
        std::sort(matches.begin(),matches.end(),[](const auto&a,const auto&b){return a.p.number<b.p.number;});
        if(matches.size()<2)return result;
        Sequence seq;
        for(const auto& item:matches){
            if(!seq.numbers.empty()&&seq.numbers.back()==item.p.number)throw std::runtime_error("发现重复帧号，保留单帧查看。");
            if(item.file==target)seq.index=seq.files.size();
            seq.files.push_back(item.file.u8string());seq.numbers.push_back(item.p.number);
        }
        auto span=seq.numbers.back()-seq.numbers.front()+1;
        if(span>9007199254740991LL)throw std::runtime_error("帧号范围过大，保留单帧查看。");
        seq.gaps=span-static_cast<long long>(seq.files.size());return seq;
    }catch(const std::exception& error){if(!current())throw;result.warning=error.what();return result;}
}
Engine::Engine(){
    const char* disabled=std::getenv("OWLSIGHT_DISABLE_FOREGROUND_WORKER");
    foregroundWorkerEnabled_=!disabled||std::strcmp(disabled,"1")!=0;
    workers_.reserve(3);
    std::unique_lock lock(mutex_);
    try{
        for(int i=0;i<2;++i)workers_.emplace_back([this,i]{work(false,i);});
        if(foregroundWorkerEnabled_){
            try{workers_.emplace_back([this]{work(true,2);});}
            catch(const std::system_error& error){foregroundWorkerEnabled_=false;foregroundWorkerFallback_=error.what();}
        }
    }catch(...){
        stopping_=true;lock.unlock();wake_.notify_all();for(auto& t:workers_)t.join();throw;
    }
}
Engine::~Engine(){{std::lock_guard lock(mutex_);stopping_=true;jobs_.clear();++epoch_;}wake_.notify_all();for(auto& t:workers_)t.join();}
void Engine::cancelQueued(std::deque<Job>::iterator it){
    auto p=pending_.find(std::to_string(it->epoch)+"|"+it->key);
    if(p!=pending_.end()&&p->second==it->id)pending_.erase(p);
    jobs_.erase(it);++cancelled_;
}
uint64_t Engine::reset(){
    std::lock_guard lock(mutex_);++epoch_;while(!jobs_.empty())cancelQueued(jobs_.begin());
    done_.clear();transient_.reset();transientKey_.clear();footprints_.clear();prefetchWaitReason_.clear();return epoch_;
}
void Engine::open(const std::string& file,uint64_t epoch){
    std::lock_guard lock(mutex_);Job job{"@open",{{"file",file}},epoch,true,0,""};
    job.id=++nextJob_;job.foreground=true;pending_[std::to_string(epoch)+"|@open"]=job.id;
    jobs_.push_front(std::move(job));wake_.notify_all();
}
void Engine::request(const std::string& key,const Json& payload,uint64_t epoch,bool foreground,int position,const std::string& context){
    std::lock_guard lock(mutex_);if(epoch!=epoch_||cache_.count(key)||key==transientKey_)return;
    const auto token=std::to_string(epoch)+"|"+key;
    if(pending_.count(token)){
        ++deduplicated_;
        if(foreground){
            auto it=std::find_if(jobs_.begin(),jobs_.end(),[&](const auto& j){return j.key==key&&j.epoch==epoch;});
            if(it!=jobs_.end()){auto job=std::move(*it);jobs_.erase(it);job.foreground=true;jobs_.push_front(std::move(job));wake_.notify_all();}
        }
        return;
    }
    if(jobs_.size()>=4){
        if(!foreground)return;
        auto it=std::find_if(jobs_.rbegin(),jobs_.rend(),[](const auto& j){return !j.open&&!j.foreground;});
        if(it!=jobs_.rend())cancelQueued(std::prev(it.base()));
    }
    Job job{key,payload,epoch,false,position,context};job.id=++nextJob_;job.foreground=foreground;
    pending_[token]=job.id;
    if(foreground)jobs_.push_front(std::move(job));else jobs_.push_back(std::move(job));
    wake_.notify_all();
}
std::shared_ptr<Frame> Engine::cached(const std::string& key){
    std::lock_guard lock(mutex_);if(transientKey_==key)return transient_;
    auto it=cache_.find(key);if(it==cache_.end())return {};it->second.use=++use_;return it->second.frame;
}
bool Engine::has(const std::string& key){std::lock_guard lock(mutex_);return cache_.count(key)>0||transientKey_==key;}
bool Engine::pending(const std::string& key){std::lock_guard lock(mutex_);return pending_.count(std::to_string(epoch_.load())+"|"+key)>0;}
void Engine::purge(){
    std::lock_guard lock(mutex_);
    for(auto it=jobs_.begin();it!=jobs_.end();){if(it->open){++it;continue;}cancelQueued(it);it=jobs_.begin();}
}
void Engine::retainQueued(const std::unordered_set<std::string>& keys){
    std::lock_guard lock(mutex_);
    for(auto it=jobs_.begin();it!=jobs_.end();){if(it->open||keys.count(it->key)){++it;continue;}cancelQueued(it);it=jobs_.begin();}
}
void Engine::setBackgroundLimit(int limit){std::lock_guard lock(mutex_);backgroundLimit_=std::clamp(limit,1,2);wake_.notify_all();}
void Engine::updatePrefetchBudget(size_t displayReserveBytes){
    std::lock_guard lock(mutex_);prefetchBudget_.update(displayReserveBytes);wake_.notify_all();
}
size_t Engine::prefetchCapacity(size_t frameBytes){
    std::lock_guard lock(mutex_);
    if(prefetchBudget_.enabled()){
        auto known=footprints_.find(activeCtx_);
        if(known!=footprints_.end())frameBytes=std::max(frameBytes,known->second.outputBytes);
    }
    size_t capacity=std::max(size_t(1),budget_/std::max(size_t(1),frameBytes));
    // A retained displayed frame outside the forward window needs its own slot.
    if(prefetchBudget_.enabled()&&activeShown_>=0&&activeShown_!=activeHead_&&size_t(distance(activeShown_))>=capacity)
        capacity=std::max(size_t(1),capacity-1);
    prefetchCapacity_=capacity;return capacity;
}
void Engine::setPlayHead(const std::string& context,int head,int length,bool loop,int shown,int protectAhead){
    std::lock_guard lock(mutex_);
    if(context!=activeCtx_||head!=activeHead_){transient_.reset();transientKey_.clear();}
    activeCtx_=context;activeHead_=head;activeShown_=shown;activeLength_=std::max(1,length);activeLoop_=loop;protectAhead_=std::max(0,protectAhead);
    if(foregroundWorkerEnabled_){
        for(auto it=jobs_.begin();it!=jobs_.end();){
            if(it->foreground&&!it->open&&!currentTarget(*it)){cancelQueued(it);it=jobs_.begin();}else ++it;
        }
        wake_.notify_all();
    }
}
std::vector<Completion> Engine::take(){std::lock_guard lock(mutex_);std::vector<Completion> out;while(!done_.empty()){out.push_back(std::move(done_.front()));done_.pop_front();}return out;}
void Engine::setBudget(size_t bytes){std::lock_guard lock(mutex_);budget_=std::clamp(bytes,size_t(128*MiB),size_t(64ULL*1024*MiB));trim();}
size_t Engine::budget(){std::lock_guard lock(mutex_);return budget_;}
size_t Engine::cacheBytes(){std::lock_guard lock(mutex_);return bytes_;}
int Engine::distance(int position) const {
    const int d=position-activeHead_;
    return activeLoop_?(d+activeLength_)%activeLength_:(d<0?activeLength_-d:d);
}
Json Engine::statistics(){
    std::lock_guard lock(mutex_);size_t active=0,otherRunning=0,dedicatedRunning=0;
    for(const auto& [key,e]:cache_)if(e.ctx==activeCtx_)active+=e.frame->bytes();
    for(const auto& [id,j]:running_){if(!j.open&&j.ctx!=activeCtx_)++otherRunning;if(j.foregroundWorker)++dedicatedRunning;}
    const auto background=runningBackground();
    return {{"queued",jobs_.size()},{"running",running_.size()},{"otherLayerRunning",otherRunning},{"completed",completed_},
        {"cancelledQueued",cancelled_},{"deduplicatedRequests",deduplicated_},{"evictions",evicted_},{"activeCacheBytes",active},
        {"otherCacheBytes",bytes_-active},{"cacheLogicalBytes",bytes_},{"liveUniquePixelBytes",Plane::liveBytes()},
        {"backgroundLimit",backgroundLimit_},{"decodeLimit",decodeLimit()},{"foregroundWorkerEnabled",foregroundWorkerEnabled_},
        {"foregroundWorkerFallback",foregroundWorkerFallback_},{"foregroundRunning",running_.size()-background},{"backgroundRunning",background},
        {"dedicatedForegroundRunning",dedicatedRunning},{"peakRunning",peakRunning_},{"cancelledBeforeDecode",cancelledBeforeDecode_},
        {"cacheBudgetBytes",budget_},{"transientBytes",transient_?transient_->bytes():0},
        {"prefetchMemory",prefetchBudget_.statistics()},{"prefetchWaitReason",prefetchWaitReason_},
        {"prefetchCapacity",prefetchCapacity_},{"reservedOutputBytes",reservedOutputBytes()},
        {"runningDecodeEstimateBytes",runningDecodeBytes()},{"prefetchReclaims",prefetchReclaims_},
        {"prefetchDiscarded",prefetchDiscarded_}};
}
void Engine::trim(){
    while(bytes_>budget_&&!cache_.empty()){
        auto victim=cache_.end();
        for(auto it=cache_.begin();it!=cache_.end();++it)
            if(it->second.ctx!=activeCtx_&&(victim==cache_.end()||it->second.use<victim->second.use))victim=it;
        if(victim==cache_.end()){
            int farthest=-1;
            for(auto it=cache_.begin();it!=cache_.end();++it){
                const int d=distance(it->second.pos);
                if(it->second.pos==activeHead_||it->second.pos==activeShown_||d<=protectAhead_)continue;
                if(d>farthest){farthest=d;victim=it;}
            }
        }
        if(victim==cache_.end()){
            int farthest=-1;
            for(auto it=cache_.begin();it!=cache_.end();++it){
                if(it->second.pos==activeHead_||it->second.pos==activeShown_)continue;
                const int d=distance(it->second.pos);if(d>farthest){farthest=d;victim=it;}
            }
        }
        if(victim==cache_.end())for(auto it=cache_.begin();it!=cache_.end();++it)
            if(it->second.pos!=activeHead_){victim=it;break;}
        if(victim==cache_.end())victim=cache_.begin();
        bytes_-=victim->second.frame->bytes();cache_.erase(victim);++evicted_;
    }
}
// Called with mutex_ held. The dedicated worker shares the queue and pending_
// with the general workers, so promoting a request never duplicates a decode.
bool Engine::currentTarget(const Job& job) const {
    return job.epoch==epoch_&&(job.open||(job.ctx==activeCtx_&&job.pos==activeHead_));
}
size_t Engine::runningBackground() const {
    return size_t(std::count_if(running_.begin(),running_.end(),[](const auto& item){return !item.second.foreground;}));
}
DecodeFootprint Engine::footprintFor(const Job& job) const {
    auto known=footprints_.find(job.ctx);
    return known==footprints_.end()?DecodeFootprint{}:known->second;
}
bool Engine::guardPrefetch(const Job& job) const {
    // Static grid loading retains build-0030's scheduling behavior.
    return prefetchBudget_.enabled()&&!job.foreground&&!job.open&&job.payload.value("maxEdge",0)==0;
}
bool Engine::prefetchEvictable(const Entry& entry,const Job& job) const {
    // Idle cross-layer work may consume free capacity, never displace playback.
    if(job.ctx!=activeCtx_)return false;
    if(entry.ctx!=activeCtx_)return true;
    if(entry.pos==activeHead_||entry.pos==activeShown_)return false;
    return distance(entry.pos)>std::max(protectAhead_,distance(job.pos));
}
size_t Engine::reservedOutputBytes() const {
    size_t bytes=0;
    for(const auto& [id,job]:running_)if(job.epoch==epoch_&&!job.open&&!cache_.count(job.key))bytes+=job.footprint.outputBytes;
    return bytes;
}
size_t Engine::runningDecodeBytes() const {
    size_t bytes=0;
    for(const auto& [id,job]:running_)bytes+=job.footprint.workingBytes;
    return bytes;
}
bool Engine::prefetchCacheFits(const Job& job,size_t outputBytes) const {
    const size_t required=outputBytes+reservedOutputBytes();
    if(required>budget_)return false;
    size_t evictable=0;
    for(const auto& [key,entry]:cache_)if(prefetchEvictable(entry,job))evictable+=entry.frame->bytes();
    return bytes_-evictable<=budget_-required;
}
void Engine::reservePrefetchCache(const Job& job,size_t outputBytes){
    const size_t required=outputBytes+reservedOutputBytes();
    while(required<=budget_&&bytes_>budget_-required){
        auto victim=cache_.end();
        for(auto it=cache_.begin();it!=cache_.end();++it){
            if(!prefetchEvictable(it->second,job))continue;
            if(victim==cache_.end()||
               (it->second.ctx!=activeCtx_&&victim->second.ctx==activeCtx_)||
               (it->second.ctx==victim->second.ctx&&it->second.use<victim->second.use))victim=it;
        }
        if(victim==cache_.end())break;
        bytes_-=victim->second.frame->bytes();cache_.erase(victim);++evicted_;++prefetchReclaims_;
    }
}
void Engine::work(bool foregroundOnly,int workerId){
    Preview decoder;
    for(;;){
        Job job;
        Json dispatch;
        {
            std::unique_lock lock(mutex_);
            const auto available=[&]{
                const auto background=foregroundWorkerEnabled_?runningBackground():running_.size();
                return std::find_if(jobs_.begin(),jobs_.end(),[&](const auto& j){
                    if(foregroundWorkerEnabled_&&j.foreground&&!currentTarget(j))return false;
                    if(j.foreground)return true;
                    if(foregroundOnly||background>=size_t(backgroundLimit_))return false;
                    if(!guardPrefetch(j))return true;
                    if(j.ctx==activeCtx_&&!footprints_.count(j.ctx)){prefetchWaitReason_="await-frame-cost";return false;}
                    const auto footprint=footprintFor(j);
                    if(!prefetchCacheFits(j,footprint.outputBytes)){prefetchWaitReason_="cache-protected";return false;}
                    if(!prefetchBudget_.allows(footprint.workingBytes,runningDecodeBytes())){prefetchWaitReason_="system-headroom";return false;}
                    prefetchWaitReason_.clear();return true;
                });
            };
            auto it=jobs_.end();
            // Keep the selected iterator: pixel allocations can change the
            // memory forecast between two independent availability checks.
            wake_.wait(lock,[&]{if(stopping_)return true;it=available();return it!=jobs_.end();});if(stopping_)return;
            job=std::move(*it);jobs_.erase(it);job.foregroundWorker=foregroundOnly;
            job.footprint=footprintFor(job);
            if(guardPrefetch(job))reservePrefetchCache(job,job.footprint.outputBytes);
            running_.emplace(job.id,job);
            peakRunning_=std::max(peakRunning_,running_.size());
            const auto background=runningBackground();size_t otherContext=0;
            for(const auto& [id,running]:running_)if(id!=job.id&&(running.epoch!=job.epoch||running.ctx!=job.ctx))++otherContext;
            dispatch={{"workerId",workerId},{"workerRole",foregroundOnly?"foreground":"general"},{"context",job.ctx},
                {"foregroundWorkerEnabled",foregroundWorkerEnabled_},{"runningAtStart",running_.size()},
                {"foregroundRunningAtStart",running_.size()-background},{"backgroundRunningAtStart",background},
                {"otherContextRunningAtStart",otherContext},{"decodeEstimateBytes",job.footprint.workingBytes},
                {"outputEstimateBytes",job.footprint.outputBytes},{"prefetchMemory",prefetchBudget_.statistics()}};
        }
        Completion value;value.epoch=job.epoch;value.key=job.key;value.opened=job.open;value.jobId=job.id;
        value.dispatchSnapshot=std::move(dispatch);
        value.taskSnapshot=job.payload.value("taskSnapshot",Json::object());
        value.foreground=job.foreground;value.queueMs=elapsed(job.queued);value.started=Clock::now();
        const auto current=[&]{std::lock_guard lock(mutex_);return job.epoch==epoch_&&(!foregroundWorkerEnabled_||!job.foreground||currentTarget(job));};
        try{
            if(current()){
                if(job.open){
                    value.sequence=discover(job.payload.at("file"),current);
                    if(current())value.frame=decode(decoder,{{"file",value.sequence.files.at(value.sequence.index)}});
                    else value.cancelledBeforeDecode=true;
                }
                else value.frame=decode(decoder,job.payload);
            }else value.cancelledBeforeDecode=true;
        }catch(const std::exception& error){value.error=error.what();}
        value.finished=Clock::now();value.decodeMs=elapsed(value.started);
        {
            std::lock_guard lock(mutex_);running_.erase(job.id);
            auto it=pending_.find(std::to_string(job.epoch)+"|"+job.key);
            if(it!=pending_.end()&&it->second==job.id)pending_.erase(it);
            ++completed_;
            if(value.cancelledBeforeDecode)++cancelledBeforeDecode_;
            if(job.epoch==epoch_){
                if(value.frame&&!job.open){
                    const auto cost=value.frame->bytes();
                    auto [known,inserted]=footprints_.try_emplace(job.ctx,DecodeFootprint{cost,value.frame->decodeWorkingBytes});
                    known->second.outputBytes=std::max(known->second.outputBytes,cost);
                    known->second.workingBytes=std::max(known->second.workingBytes,value.frame->decodeWorkingBytes);
                    const bool speculative=guardPrefetch(job)&&!currentTarget(job);
                    const bool retain=!speculative||prefetchCacheFits(job,cost);
                    if(speculative&&retain)reservePrefetchCache(job,cost);
                    if(!retain)++prefetchDiscarded_;
                    if(retain&&cost<=budget_&&(job.ctx==activeCtx_||bytes_+cost<=budget_)){
                        auto old=cache_.find(job.key);if(old!=cache_.end())bytes_-=old->second.frame->bytes();
                        bytes_+=cost;cache_[job.key]={value.frame,++use_,job.pos,job.ctx};trim();
                    }else if(job.ctx==activeCtx_&&job.pos==activeHead_){
                        transient_=value.frame;transientKey_=job.key;
                    }
                }
                done_.push_back(std::move(value));
            }
        }
        wake_.notify_all();
    }
}
}
}
