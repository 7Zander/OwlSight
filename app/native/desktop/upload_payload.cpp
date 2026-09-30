// SPDX-License-Identifier: GPL-3.0-or-later
#include "upload_payload.hpp"
#include <algorithm>
#include <cstring>
#include <limits>
#include <stdexcept>

UploadPreparer::UploadPreparer(std::function<void()> notify):notify_(std::move(notify)),worker_([this]{work();}){}
UploadPreparer::~UploadPreparer(){
    {std::lock_guard lock(mutex_);stopping_=true;desired_.clear();}
    wake_.notify_one();worker_.join();
}
size_t UploadPreparer::cost(const UploadRequest& request){
    if(!request.pixels)throw std::runtime_error("上传缺少原始像素。");
    const auto& p=*request.pixels;
    if(p.width<=0||p.height<=0||p.width>16384||p.height>16384||p.channels<1||p.channels>4||
       (request.storageChannels!=1&&request.storageChannels!=4)||request.storageChannels<p.channels)
        throw std::runtime_error("上传图像布局无效。");
    const size_t sample=p.half?2:4,count=size_t(p.width)*size_t(p.height);
    const size_t bytes=count*size_t(request.storageChannels)*sample;
    if(!p.data()||p.bytes()!=count*size_t(p.channels)*sample||bytes>Budget||bytes>size_t(std::numeric_limits<qsizetype>::max()))
        throw std::runtime_error("上传载荷超过 256 MiB 上限或像素大小无效，已返回 CPU 显示。");
    return bytes;
}
std::shared_ptr<UploadTicket> UploadPreparer::prepare(const UploadRequest& request){
    const auto start=owl::Clock::now();
    auto ticket=std::make_shared<UploadTicket>();ticket->key=request.key;ticket->generation=request.generation;ticket->storageChannels=request.storageChannels;
    try{
        const size_t bytes=cost(request);
        const auto& p=*request.pixels;const size_t sample=p.half?2:4;
        ticket->width=p.width;ticket->height=p.height;ticket->half=p.half;ticket->storageChannels=request.storageChannels;
        ticket->stride=quint32(size_t(p.width)*request.storageChannels*sample);
        if(p.channels==request.storageChannels){
            ticket->data=QByteArray(static_cast<const char*>(p.data()),qsizetype(bytes));
        }else{
            const auto layoutStart=owl::Clock::now();
            ticket->data=QByteArray(qsizetype(bytes),Qt::Uninitialized);
            const auto* source=static_cast<const char*>(p.data());auto* target=ticket->data.data();
            const float one=1.f;const IMATH_NAMESPACE::half halfOne(1.f);
            const void* fill=p.half?static_cast<const void*>(&halfOne):static_cast<const void*>(&one);
            for(size_t i=0,count=size_t(p.width)*p.height;i<count;++i){
                auto* pixel=target+i*request.storageChannels*sample;
                std::memcpy(pixel,source+i*p.channels*sample,p.channels*sample);
                for(int c=p.channels;c<request.storageChannels;++c)std::memcpy(pixel+c*sample,fill,sample);
            }
            ticket->layoutBytes=bytes;ticket->layoutMs=owl::elapsed(layoutStart);
        }
    }catch(const std::exception& e){ticket->error=QString::fromUtf8(e.what());}
    ticket->prepareMs=owl::elapsed(start);return ticket;
}
size_t UploadPreparer::readyBytes() const {
    size_t result=0;for(const auto& entry:ready_)result+=size_t(entry.second->data.size());return result;
}
void UploadPreparer::request(std::vector<UploadRequest> desired){
    if(desired.size()>Limit)desired.resize(Limit);
    // The front is the current target. Never let ready successors occupy the
    // bytes it needs and leave the queue waiting for consumption of that target.
    size_t reserved=0;
    for(auto it=desired.begin();it!=desired.end();){
        size_t bytes=0;try{bytes=cost(*it);}catch(const std::exception&){}
        if(reserved+bytes>Budget)it=desired.erase(it);
        else {reserved+=bytes;++it;}
    }
    {std::lock_guard lock(mutex_);
        desired_=std::move(desired);
        for(auto it=ready_.begin();it!=ready_.end();){
            const bool wanted=std::any_of(desired_.begin(),desired_.end(),[&](const auto& r){
                return r.key==it->first&&r.generation==it->second->generation&&r.storageChannels==it->second->storageChannels;
            });
            if(!wanted)it=ready_.erase(it);else ++it;
        }
    }
    wake_.notify_one();
}
std::shared_ptr<const UploadTicket> UploadPreparer::ready(const QString& key,uint64_t generation){
    std::lock_guard lock(mutex_);auto it=ready_.find(key);
    return it!=ready_.end()&&it->second->generation==generation?it->second:nullptr;
}
QVariantMap UploadPreparer::statistics(){
    std::lock_guard lock(mutex_);
    return {{"ticketReadyBytes",QVariant::fromValue(quint64(readyBytes()))},{"ticketActiveBytes",QVariant::fromValue(quint64(activeBytes_))},
        {"ticketPeakBytes",QVariant::fromValue(quint64(peakBytes_))},{"ticketBudgetBytes",QVariant::fromValue(quint64(Budget))},
        {"ticketReadyCount",int(ready_.size())},{"ticketDesiredCount",int(desired_.size())},
        {"ticketsPrepared",QVariant::fromValue(prepared_)},{"ticketsCancelled",QVariant::fromValue(cancelled_)}};
}
void UploadPreparer::work(){
    for(;;){
        UploadRequest next;
        {
            std::unique_lock lock(mutex_);
            const auto candidate=[&]{return std::find_if(desired_.begin(),desired_.end(),[&](const auto& r){
                if(ready_.count(r.key))return false;
                size_t bytes=0;try{bytes=cost(r);}catch(const std::exception&){return true;}
                return ready_.size()<Limit&&readyBytes()+bytes<=Budget;
            });};
            wake_.wait(lock,[&]{return stopping_||candidate()!=desired_.end();});if(stopping_)return;
            next=*candidate();try{activeBytes_=cost(next);}catch(const std::exception&){activeBytes_=0;}
            peakBytes_=std::max(peakBytes_,readyBytes()+activeBytes_);
        }
        auto ticket=prepare(next);
        bool publish=false;
        {
            std::lock_guard lock(mutex_);activeBytes_=0;
            if(stopping_)return;
            publish=std::any_of(desired_.begin(),desired_.end(),[&](const auto& r){
                return r.key==next.key&&r.generation==next.generation&&r.storageChannels==next.storageChannels;
            });
            if(publish){ready_[next.key]=std::move(ticket);++prepared_;}else ++cancelled_;
        }
        if(publish)notify_();
    }
}
