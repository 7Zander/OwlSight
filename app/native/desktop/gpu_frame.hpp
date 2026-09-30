// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include "core.hpp"
#include <QString>

struct GpuPrepared { QString key; std::shared_ptr<const owl::desktop::Frame> pixels; };

// Immutable handoff across the GUI/render thread boundary.
struct GpuFrame {
    std::shared_ptr<const owl::desktop::Frame> pixels;
    QString key, pixelKey, info;
    std::array<int,4> mapping{0,1,2,3};
    uint64_t serial=0, generation=0;
    int layer=0;
    long long frameNumber=0;
    float gain=1.f;
    bool encodeSrgb=false, compositeAlpha=false;
    owl::Clock::time_point queued=owl::Clock::now();
};
