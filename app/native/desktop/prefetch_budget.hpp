// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "../cpp/preview.hpp"

namespace owl::desktop {
struct DecodeFootprint {
    size_t outputBytes=64*MiB;
    size_t workingBytes=512*MiB;
};
// Used under Engine's mutex. Estimates gate speculative work only; the UI's
// foreground request is never denied by this policy.
class PrefetchBudget {
public:
    PrefetchBudget();
    bool enabled() const { return enabled_; }
    void update(size_t displayReserveBytes);
    bool allows(size_t decodeBytes,size_t runningDecodeBytes) const;
    Json statistics() const;
private:
    bool enabled_=true,valid_=false;
    size_t available_=0,reserve_=0,displayReserve_=0,sampledPixels_=0;
    Clock::time_point nextSample_=Clock::now();
};
}
