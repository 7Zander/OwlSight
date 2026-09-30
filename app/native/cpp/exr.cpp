// SPDX-License-Identifier: GPL-3.0-or-later
#include "preview.hpp"
#include <ImfChannelList.h>
#include <ImfFrameBuffer.h>
#include <ImfHeader.h>
#include <ImfInputPart.h>
#include <ImfMultiPartInputFile.h>
#include <ImfPartType.h>
#include <ImfThreading.h>
#include <ImfTiledInputPart.h>
#include <algorithm>
#include <atomic>
#include <mutex>
#include <thread>
#include <filesystem>
#include <stdexcept>

namespace owl {
namespace exr = OPENEXR_IMF_NAMESPACE;
namespace fs = std::filesystem;
namespace {
std::atomic<std::size_t> livePixelBytes{0};
std::string fileKey(const std::string& filename) {
    if (filename.empty() || filename.find('\0') != std::string::npos)
        throw std::runtime_error("文件路径无效。");
    const auto path = fs::u8path(filename);
    if (!fs::is_regular_file(path)) throw std::runtime_error("请选择普通 EXR 文件。");
    const auto bytes = fs::file_size(path);
    if (bytes > 256 * MiB) throw std::runtime_error("EXR 文件超过 256 MiB 上限。");
    return Json::array({filename, bytes, fs::last_write_time(path).time_since_epoch().count()}).dump();
}
Json window(const IMATH_NAMESPACE::Box2i& box) {
    return {{"xMin",box.min.x},{"yMin",box.min.y},{"xMax",box.max.x},{"yMax",box.max.y}};
}
}
Json Header::metadata() const {
    auto result = Json::array();
    for (const auto& part : parts) result.push_back(part.metadata);
    return result;
}
Plane::~Plane() { livePixelBytes.fetch_sub(byteSize(),std::memory_order_relaxed); }
std::size_t Plane::liveBytes() { return livePixelBytes.load(std::memory_order_relaxed); }
void Plane::allocate(std::size_t samples, Json* timing) {
    const auto previous=byteSize();
    const auto allocateStart=Clock::now();
    if (half) halves.reserve(samples); else floats.reserve(samples);
    if(timing)(*timing)["allocationReserveMs"]=elapsed(allocateStart);
    const auto initializeStart=Clock::now();
    if (half) halves.resize(samples); else floats.resize(samples);
    if(timing)(*timing)["initializationResizeMs"]=elapsed(initializeStart);
    livePixelBytes.fetch_add(byteSize(),std::memory_order_relaxed);
    livePixelBytes.fetch_sub(previous,std::memory_order_relaxed);
}
std::size_t Plane::byteSize() const { return half ? halves.size()*sizeof(IMATH_NAMESPACE::half) : floats.size()*sizeof(float); }
const void* Plane::data() const { return half ? static_cast<const void*>(halves.data()) : static_cast<const void*>(floats.data()); }
void* Plane::data() { return half ? static_cast<void*>(halves.data()) : static_cast<void*>(floats.data()); }
float Plane::value(std::size_t index) const { return half ? static_cast<float>(halves[index]) : floats[index]; }
void Plane::copySample(std::size_t target, const Plane& source, std::size_t index) {
    if (half) halves[target] = source.halves[index]; else floats[target] = source.floats[index];
}
Preview::Preview() {
    const auto start = Clock::now();
    static_assert(sizeof(float) == 4 && sizeof(IMATH_NAMESPACE::half) == 2);
    static std::once_flag threads;
    std::call_once(threads, [] { exr::setGlobalThreadCount(std::clamp<unsigned>(std::thread::hardware_concurrency(),4u,16u)); });
    exr::Header::setMaxImageSize(16384,16384);
    exr::Header::setMaxTileSize(16384,16384);
    initializationMs_ = elapsed(start);
}
Header& Preview::header(const std::string& filename, bool& hit) {
    const auto key = fileKey(filename);
    for (auto it = headers_.begin(); it != headers_.end(); ++it) {
        if (it->key != key) continue;
        hit = true; headers_.splice(headers_.end(), headers_, it);
        return headers_.back();
    }
    hit = false;
    exr::MultiPartInputFile file(filename.c_str(), 4);
    if (file.parts() < 1 || file.parts() > 32) throw std::runtime_error("EXR Part 数量超过上限。");
    Header result; result.key = key;
    std::uint64_t budget = 0;
    for (int index = 0; index < file.parts(); ++index) {
        const auto& h = file.header(index);
        if (h.hasType() && exr::isDeepData(h.type())) throw std::runtime_error("当前版本不支持 Deep EXR。");
        const auto dw = h.dataWindow();
        const std::int64_t width = static_cast<std::int64_t>(dw.max.x) - dw.min.x + 1;
        const std::int64_t height = static_cast<std::int64_t>(dw.max.y) - dw.min.y + 1;
        if (width < 1 || height < 1 || width > 16384 || height > 16384 || width*height > 32*MiB)
            throw std::runtime_error("EXR 尺寸超过读取上限。");
        Part part; part.width = static_cast<int>(width); part.height = static_cast<int>(height);
        for (auto channel = h.channels().begin(); channel != h.channels().end(); ++channel) {
            if (channel.channel().xSampling != 1 || channel.channel().ySampling != 1)
                throw std::runtime_error("当前版本不支持子采样通道。");
            part.channels.emplace_back(channel.name());
            part.types.push_back(static_cast<int>(channel.channel().type));
            if (part.channels.size() > 256) throw std::runtime_error("EXR 通道数超过上限。");
        }
        if (part.channels.empty()) throw std::runtime_error("EXR 没有可读取通道。");
        budget += static_cast<std::uint64_t>(width*height) * part.channels.size() * 4;
        if (budget > 1024*MiB) throw std::runtime_error("EXR 全通道展开超过 1024 MiB 上限。请减少导出通道或降低分辨率。");
        part.metadata = {{"name", h.hasName() ? h.name() : ""}, {"width",width}, {"height",height},
            {"channels",part.channels}, {"dataWindow",window(dw)}, {"displayWindow",window(h.displayWindow())},
            {"compression",static_cast<int>(h.compression())}};
        result.parts.push_back(std::move(part));
    }
    if (fileKey(filename) != key) throw std::runtime_error("读取时文件发生变化，请重新打开。");
    // Metadata shares the same bounded protocol as the previous helper.
    if (result.metadata().dump().size() > MiB/2) throw std::runtime_error("EXR 头信息超过上限。");
    headers_.push_back(std::move(result));
    while (headers_.size() > 256) headers_.pop_front();
    return headers_.back();
}
std::shared_ptr<Plane> Preview::read(const std::string& filename, const Header& info, int partIndex,
    const std::vector<std::string>& names, bool& hit, Json& timing) {
    const auto start = Clock::now();
    for (auto it = planes_.end(); it != planes_.begin();) {
        --it;
        const auto& plane = *it;
        if (plane->fileKey != info.key || plane->partIndex != partIndex) continue;
        if (!std::all_of(names.begin(), names.end(), [&](const auto& name) {
                return std::find(plane->channels.begin(), plane->channels.end(), name) != plane->channels.end();
            })) continue;
        auto result = plane; planes_.splice(planes_.end(), planes_, it);
        hit = true; timing["sourceReadDecodeMs"] = elapsed(start);
        return result;
    }
    hit = false;
    const auto& part = info.parts.at(partIndex);
    auto plane = std::make_shared<Plane>();
    plane->fileKey = info.key; plane->partIndex = partIndex;
    plane->width = part.width; plane->height = part.height;
    std::size_t begin = 0, end = part.channels.size();
    const std::size_t fullBytes = static_cast<std::size_t>(part.width)*part.height*part.channels.size()*4;
    if (fullBytes > PlaneLimit) {
        begin = part.channels.size(); end = 0;
        for (const auto& name : names) {
            const auto index = static_cast<std::size_t>(std::find(part.channels.begin(), part.channels.end(), name)-part.channels.begin());
            begin = std::min(begin,index); end = std::max(end,index+1);
        }
    }
    plane->channels.assign(part.channels.begin()+begin,part.channels.begin()+end);
    plane->half = std::all_of(part.types.begin()+begin,part.types.begin()+end,[](int type){ return type == exr::HALF; });
    const auto openStart = Clock::now();
    Clock::time_point closeStart;
    {
        exr::MultiPartInputFile source(filename.c_str(), std::clamp<int>(std::thread::hardware_concurrency(),4,16));
        timing["sourceOpenMs"] = elapsed(openStart);
        const auto selectStart = Clock::now();
        if (source.parts() != static_cast<int>(info.parts.size())) throw std::runtime_error("EXR Part 在读取时发生变化。");
        const auto& h = source.header(partIndex);
        if (window(h.dataWindow()) != part.metadata.at("dataWindow") ||
            (h.hasName() ? h.name() : "") != part.metadata.at("name").get<std::string>())
            throw std::runtime_error("EXR 头信息在读取时发生变化。");
        for (std::size_t i=0; i<plane->channels.size(); ++i) {
            const auto* channel = h.channels().findChannel(plane->channels[i].c_str());
            if (!channel || channel->xSampling != 1 || channel->ySampling != 1 || channel->type != part.types[begin+i])
                throw std::runtime_error("EXR 通道在读取时发生变化。");
        }
        timing["partValidationMs"] = elapsed(selectStart);
        plane->allocate(static_cast<std::size_t>(part.width)*part.height*plane->channels.size(), &timing);
        timing["outputAllocationBytes"] = plane->byteSize();
        const auto frameBufferStart = Clock::now();
        const std::size_t sampleBytes = plane->half ? 2 : 4;
        const std::size_t stride = plane->channels.size()*sampleBytes;
        exr::FrameBuffer frame;
        for (std::size_t i=0; i<plane->channels.size(); ++i) {
            auto* base = static_cast<char*>(plane->data()) + i*sampleBytes;
            frame.insert(plane->channels[i], exr::Slice::Make(plane->half ? exr::HALF : exr::FLOAT,
                base, h.dataWindow(), stride, stride*part.width));
        }
        timing["frameBufferSetupMs"] = elapsed(frameBufferStart);
        timing["partSelectMs"] = elapsed(selectStart);
        const auto pixelsStart = Clock::now();
        if (h.hasTileDescription()) {
            exr::TiledInputPart input(source,partIndex);
            input.setFrameBuffer(frame);
            timing["partAttachMs"] = elapsed(pixelsStart);
            const auto readStart=Clock::now();
            input.readTiles(0,input.numXTiles(0)-1,0,input.numYTiles(0)-1,0,0);
            timing["pixelReadCallMs"] = elapsed(readStart);
        } else {
            exr::InputPart input(source,partIndex);
            input.setFrameBuffer(frame);
            timing["partAttachMs"] = elapsed(pixelsStart);
            const auto readStart=Clock::now();
            input.readPixels(h.dataWindow().min.y,h.dataWindow().max.y);
            timing["pixelReadCallMs"] = elapsed(readStart);
        }
        timing["pixelReadDecodeMs"] = elapsed(pixelsStart);
        closeStart = Clock::now();
    }
    timing["sourceCloseMs"] = elapsed(closeStart);
    if (fileKey(filename) != info.key) throw std::runtime_error("读取时文件发生变化，请重新打开。");
    if (plane->byteSize() <= PlaneLimit) {
        while (!planes_.empty() && planeBytes_+plane->byteSize() > PlaneLimit) {
            planeBytes_ -= planes_.front()->byteSize(); planes_.pop_front();
        }
        planeBytes_ += plane->byteSize(); planes_.push_back(plane);
    }
    timing["sourceReadDecodeMs"] = elapsed(start);
    return plane;
}
} // namespace owl
