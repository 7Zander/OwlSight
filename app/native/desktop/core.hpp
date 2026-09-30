// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "../cpp/preview.hpp"
#include <atomic>
#include <array>
#include <condition_variable>
#include <deque>
#include <filesystem>
#include <functional>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unordered_set>
namespace owl::desktop {
struct Layer {
    std::string id,label,partName;
    int part=0;
    bool color=false;
    std::vector<std::string> channels;
    std::unordered_map<std::string,std::string> components;
    Json request(const std::string& component) const;
};
std::vector<Layer> layers(const Json& parts);
struct Frame {
    Json metadata;
    std::shared_ptr<const Plane> pixels;
    std::array<int,4> mapping{0,1,2,3};
    int width=0,height=0,channels=0;
    bool half=false;
    size_t bytes() const { return pixels?pixels->byteSize():0; }
    const void* data() const { return pixels?pixels->data():nullptr; }
    std::array<int,4> displayMap(const std::string& component,bool available) const {
        if(!available||component=="RGBA")return mapping;
        const auto at=std::string("RGBA").find(component);
        if(component.size()!=1||at==std::string::npos)return mapping;
        return {mapping[at],mapping[at],mapping[at],-1};
    }
};
struct Sequence {
    std::vector<std::string> files;
    std::vector<long long> numbers;
    size_t index=0;
    long long gaps=0;
    std::string warning;
};
Sequence discover(const std::string& path,const std::function<bool()>& current);
std::shared_ptr<Frame> decode(Preview& decoder,const Json& request);
Json colorRequest(const Json& request);
struct Completion {
    Json taskSnapshot=Json::object();
    uint64_t epoch=0;
    std::string key,error;
    std::shared_ptr<Frame> frame;
    Sequence sequence;
    bool opened=false;
    uint64_t jobId=0;
    bool foreground=false;
    double queueMs=0,decodeMs=0;
    Clock::time_point started=Clock::now(),finished=Clock::now();
};
class Engine {
public:
    Engine();
    ~Engine();
    uint64_t reset();
    void open(const std::string& file,uint64_t epoch);
    void request(const std::string& key,const Json& request,uint64_t epoch,bool foreground,int position,const std::string& context);
    std::shared_ptr<Frame> cached(const std::string& key);
    bool has(const std::string& key);
    void purge();
    void setPlayHead(const std::string& context,int head,int length,bool loop,int shown=-1,int protectAhead=12);
    void setBackgroundLimit(int limit);
    void retainQueued(const std::unordered_set<std::string>& keys);
    bool pending(const std::string& key);
    size_t budget();
    Json statistics();
    std::vector<Completion> take();
    void setBudget(size_t bytes);
    size_t cacheBytes();
private:
    struct Job {std::string key;Json payload;uint64_t epoch;bool open=false;int pos=0;std::string ctx;Clock::time_point queued=Clock::now();uint64_t id=0;bool foreground=false;};
    struct Entry {std::shared_ptr<Frame> frame;uint64_t use;int pos=0;std::string ctx;};
    std::mutex mutex_;
    std::condition_variable wake_;
    std::deque<Job> jobs_;
    std::deque<Completion> done_;
    std::unordered_map<std::string,Entry> cache_;
    std::unordered_map<std::string,uint64_t> pending_;
    std::unordered_map<uint64_t,Job> running_;
    uint64_t nextJob_=0,cancelled_=0,deduplicated_=0,completed_=0,evicted_=0;
    int backgroundLimit_=2;
    std::shared_ptr<Frame> transient_;
    std::string transientKey_;
    void cancelQueued(std::deque<Job>::iterator job);
    int distance(int position) const;
    std::vector<std::thread> workers_;
    std::atomic<uint64_t> epoch_{1};
    bool stopping_=false;
    size_t budget_=512*MiB,bytes_=0;
    uint64_t use_=0;
    std::string activeCtx_;
    int activeHead_=0,activeShown_=-1,activeLength_=1,protectAhead_=12;
    bool activeLoop_=false;
    void work();
    void trim();
};
}
