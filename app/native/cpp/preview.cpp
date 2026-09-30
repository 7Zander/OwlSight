// SPDX-License-Identifier: GPL-3.0-or-later
#include "preview.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace owl {
namespace {
std::size_t channelIndex(const std::vector<std::string>& names, const std::string& name) {
    const auto it = std::find(names.begin(), names.end(), name);
    if (it == names.end()) throw std::runtime_error("此帧缺少所选通道。");
    return static_cast<std::size_t>(it-names.begin());
}
Json displayRange(float low, float high) {
    if (!std::isfinite(low)) return Json::array({0.,1.});
    return Json::array({static_cast<double>(low), high > low ? static_cast<double>(high) : static_cast<double>(low)+1.});
}
}
PreviewResult Preview::result(const Json& request) {
    const auto started = Clock::now();
    if (!request.is_object()) throw std::runtime_error("预览请求无效。");
    if (request.value("warmup",false)) {
        return {{{"parts",Json::array()}, {"diagnostics",{
            {"timing",{{"initializationMs",initializationMs_}}}, {"resources",processSample()},
            {"decoder","cpp-openexr"},{"decoderVersion","0.2.0"}}}}, {}};
    }
    const auto filename = request.at("file").get<std::string>();
    bool headerHit = false;
    const auto& info = header(filename,headerHit);
    Json timing = {{"headerMs",elapsed(started)}};
    if (!request.contains("view") || request.at("view").is_null()) {
        return {{{"parts",Json::array()},{"sourceParts",info.metadata()},
            {"diagnostics",{{"timing",timing},{"headerCacheHit",headerHit},{"resources",processSample()},
                {"decoder","cpp-openexr"},{"decoderVersion","0.2.0"}}}}, {}};
    }
    const auto& view = request.at("view");
    const auto partName = view.at("partName").get<std::string>();
    int partIndex = -1;
    if (!partName.empty()) {
        for (std::size_t i=0; i<info.parts.size(); ++i) {
            if (info.parts[i].metadata.at("name").get<std::string>() != partName) continue;
            if (partIndex >= 0) throw std::runtime_error("此帧包含重复 Part 名称。");
            partIndex = static_cast<int>(i);
        }
    } else {
        if (!view.at("partIndex").is_number_integer()) throw std::runtime_error("Part 索引无效。");
        partIndex = view.at("partIndex").get<int>();
    }
    if (partIndex < 0 || partIndex >= static_cast<int>(info.parts.size()))
        throw std::runtime_error("此帧缺少所选 Part。");
    const auto& part = info.parts[partIndex];
    if (partName.empty() && !part.metadata.at("name").get<std::string>().empty())
        throw std::runtime_error("此帧缺少所选 Part。");
    const auto names = view.at("channels").get<std::vector<std::string>>();
    if (names.size() != 3 && names.size() != 4) throw std::runtime_error("所选通道无效。");
    for (const auto& name : names) channelIndex(part.channels,name);
    const int divisor = request.value("divisor",1), edge = request.value("maxEdge",0);
    if ((divisor!=1 && divisor!=2 && divisor!=3 && divisor!=4 && divisor!=8) || (edge!=0 && edge!=300))
        throw std::runtime_error("预览分辨率无效。");
    bool planeHit = false;
    const auto source = read(filename,info,partIndex,names,planeHit,timing);
    const auto prepareStart = Clock::now();
    const double scale = edge ? std::min(1.0/divisor,static_cast<double>(edge)/std::max(part.width,part.height)) : 1.0/divisor;
    // nearbyint uses the default round-to-even mode, matching the previous preview's dimensions.
    const int width = edge ? std::max(1,static_cast<int>(std::nearbyint(part.width*scale))) : (part.width+divisor-1)/divisor;
    const int height = edge ? std::max(1,static_cast<int>(std::nearbyint(part.height*scale))) : (part.height+divisor-1)/divisor;
    std::vector<std::string> channels;
    std::vector<std::size_t> indices;
    for (std::size_t c=0; c<source->channels.size(); ++c) {
        if (std::find(names.begin(),names.end(),source->channels[c]) == names.end()) continue;
        channels.push_back(source->channels[c]); indices.push_back(c);
    }
    const std::size_t samples = static_cast<std::size_t>(width)*height*channels.size();
    if (samples*(source->half?2:4) > 512*MiB) throw std::runtime_error("预览超过 512 MiB 上限。");
    auto output = source;
    if (width != source->width || height != source->height || channels != source->channels) {
        output = std::make_shared<Plane>();
        output->width = width; output->height = height; output->channels = channels; output->half = source->half;
        output->allocate(samples);
        for (int y=0; y<height; ++y) {
            const int sy = std::min(part.height-1,edge ? static_cast<int>(y/scale) : y*divisor);
            for (int x=0; x<width; ++x) {
                const int sx = std::min(part.width-1,edge ? static_cast<int>(x/scale) : x*divisor);
                const std::size_t from = (static_cast<std::size_t>(sy)*part.width+sx)*source->channels.size();
                const std::size_t to = (static_cast<std::size_t>(y)*width+x)*channels.size();
                for (std::size_t c=0; c<channels.size(); ++c) output->copySample(to+c,*source,from+indices[c]);
            }
        }
    }
    std::vector<int> mapping;
    for (const auto& name : names) mapping.push_back(static_cast<int>(channelIndex(channels,name)));
    if (mapping.size() == 3) mapping.push_back(-1);
    Json metadata = {{"parts",Json::array({{{"width",width},{"height",height},
        {"channels",channels},{"pixelType",output->half ? "half":"float"}}})},
        {"sourceParts",info.metadata()},{"channelMap",mapping},{"divisor",divisor}};
    timing["selectResizePackMs"] = elapsed(prepareStart);
    const auto rangeStart = Clock::now();
    if (view.value("range",false)) {
        const float infinity = std::numeric_limits<float>::infinity();
        std::vector<float> low(channels.size(),infinity), high(channels.size(),-infinity);
        for (std::size_t index=0; index<samples; ++index) {
            const float value = output->value(index);
            if (!std::isfinite(value)) continue;
            const auto channel = index%channels.size();
            low[channel] = std::min(low[channel],value); high[channel] = std::max(high[channel],value);
        }
        metadata["ranges"] = Json::array();
        for (const int index : mapping) metadata["ranges"].push_back(index < 0 ? Json::array({1.,2.}) : displayRange(low[index],high[index]));
        float rgbLow = infinity, rgbHigh = -infinity;
        for (int component=0; component<3; ++component) {
            rgbLow = std::min(rgbLow,low[mapping[component]]);
            rgbHigh = std::max(rgbHigh,high[mapping[component]]);
        }
        metadata["range"] = displayRange(rgbLow,rgbHigh);
    }
    timing["rangeMs"] = elapsed(rangeStart);
    timing["nativeBeforeWriteMs"] = elapsed(started);
    metadata["diagnostics"] = {{"timing",timing},{"headerCacheHit",headerHit},{"planeCacheHit",planeHit},
        {"sourceWidth",part.width},{"sourceHeight",part.height},{"compression",part.metadata.at("compression")},
        {"decodedPixelType",source->half?"float16":"float32"},{"outputPixelType",output->half?"float16":"float32"},
        {"outputBytes",output->byteSize()},{"planeCacheBytes",planeBytes_},{"fileBytes",Json::parse(info.key).at(1)},
        {"resources",processSample()},{"decoder","cpp-openexr"},{"decoderVersion","0.2.0"}};
    metadata["diagnostics"]["pixelHandoffCopyBytes"]=0;
    return {std::move(metadata),std::move(output)};
}
void Preview::respond(const Json& request) {
    auto output=result(request);
    writeFrame(output.metadata,output.pixels?output.pixels->data():nullptr,output.pixels?output.pixels->byteSize():0);
}
} // namespace owl
