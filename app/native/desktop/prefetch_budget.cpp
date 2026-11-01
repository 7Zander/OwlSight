// SPDX-License-Identifier: GPL-3.0-or-later
#include "prefetch_budget.hpp"
#include <windows.h>
#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace owl::desktop {
PrefetchBudget::PrefetchBudget(){
    const char* disabled=std::getenv("OWLSIGHT_DISABLE_PREFETCH_GUARD");
    enabled_=!disabled||std::strcmp(disabled,"1")!=0;
}
void PrefetchBudget::update(size_t displayReserveBytes){
    displayReserve_=displayReserveBytes;
    const auto now=Clock::now();
    if(!enabled_||now<nextSample_)return;
    nextSample_=now+std::chrono::milliseconds(250);
    MEMORYSTATUSEX memory{};memory.dwLength=sizeof(memory);
    valid_=GlobalMemoryStatusEx(&memory)!=0;
    if(!valid_)return; // Keep the cache guard, but do not invent a system limit.
    available_=size_t(std::min(memory.ullAvailPhys,memory.ullAvailPageFile));
    reserve_=std::max(size_t(1024*MiB),size_t(memory.ullTotalPhys/8));
    sampledPixels_=Plane::liveBytes();
}
bool PrefetchBudget::allows(size_t decodeBytes,size_t runningDecodeBytes) const {
    if(!enabled_||!valid_)return true;
    const size_t live=Plane::liveBytes();
    const size_t pixelGrowth=live>sampledPixels_?live-sampledPixels_:0;
    // Free memory already excludes allocated pixels. Reserve complete in-flight
    // estimates conservatively because their unallocated portion is unknown.
    const size_t forecast=decodeBytes+runningDecodeBytes+displayReserve_+pixelGrowth;
    return available_>reserve_&&forecast<=available_-reserve_;
}
Json PrefetchBudget::statistics() const {
    return {{"enabled",enabled_},{"systemSampleValid",valid_},{"availableBytes",available_},
        {"systemReserveBytes",reserve_},{"displayReserveBytes",displayReserve_},
        {"sampleIntervalMs",250},{"estimateMeaning","forecast, not a process or GPU memory cap"}};
}
}
