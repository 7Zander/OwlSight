// SPDX-License-Identifier: GPL-3.0-or-later
#include <OpenColorIO/OpenColorIO.h>
#include <nlohmann/json.hpp>
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <list>
#include <stdexcept>
#include <string>
#include <vector>

namespace OCIO = OCIO_NAMESPACE;
using Json = nlohmann::json;
namespace {
constexpr size_t maxValues = 2 * 1024 * 1024;
constexpr size_t maxRequest = 1024 * 1024;
constexpr const char* builtin = "cg-config-v2.2.0_aces-v1.3_ocio-v2.4";
struct ConfigEntry { std::string source; OCIO::ConstConfigRcPtr config; };
std::list<ConfigEntry> configs;

OCIO::ConstConfigRcPtr configFor(const std::string& source, bool reload = false) {
    if (reload) {
        OCIO::ClearAllCaches();
        configs.remove_if([&](const auto& entry) { return entry.source == source; });
    }
    auto it = std::find_if(configs.begin(), configs.end(),
        [&](const auto& entry) { return entry.source == source; });
    if (it != configs.end()) {
        configs.splice(configs.end(), configs, it);
        return configs.back().config;
    }
    auto config = source == "builtin" ? OCIO::Config::CreateFromBuiltinConfig(builtin)
                                      : OCIO::Config::CreateFromFile(source.c_str());
    configs.push_back({source, config});
    if (configs.size() > 4) configs.pop_front();
    return config;
}

Json catalog(const std::string& source) {
    auto cfg = configFor(source, true);
    Json spaces = Json::array(), data = Json::array(), displays = Json::object();
    Json defaults = Json::object(), looks = Json::array();
    for (int i = 0; i < cfg->getNumColorSpaces(); ++i) {
        const char* name = cfg->getColorSpaceNameByIndex(i);
        spaces.push_back(name);
        if (cfg->getColorSpace(name)->isData()) data.push_back(name);
    }
    for (int i = 0; i < cfg->getNumDisplays(); ++i) {
        const char* display = cfg->getDisplay(i);
        displays[display] = Json::array();
        for (int j = 0; j < cfg->getNumViews(display); ++j)
            displays[display].push_back(cfg->getView(display, j));
        defaults[display] = cfg->getDefaultView(display);
    }
    if (spaces.empty() || displays.empty())
        throw std::runtime_error("配置没有可用的颜色空间或 Display / View。");
    for (int i = 0; i < cfg->getNumLooks(); ++i) looks.push_back(cfg->getLookNameByIndex(i));
    auto scene = cfg->getColorSpace("scene_linear");
    std::string selected;
    for (const char* name : {"Linear Rec.709 (sRGB)", "Linear Rec.709", "Linear sRGB"}) {
        auto space = cfg->getColorSpace(name);
        if (space) { selected = space->getName(); break; }
    }
    if (selected.empty()) selected = scene ? scene->getName() :
        (data.empty() ? spaces.front().get<std::string>() : data.front().get<std::string>());
    return {{"source", source},
        {"name", source == "builtin" ? "内置 ACES 1.3" : std::filesystem::u8path(source).filename().u8string()},
        {"spaces", spaces}, {"dataSpaces", data}, {"displays", displays}, {"defaults", defaults},
        {"input", selected}, {"display", cfg->getDefaultDisplay()}, {"looks", looks},
        {"scene", scene ? Json(scene->getName()) : Json(nullptr)}, {"version", OCIO::GetVersion()}};
}

using Processors = std::pair<OCIO::ConstProcessorRcPtr, OCIO::ConstProcessorRcPtr>;
Processors processors(const OCIO::ConstConfigRcPtr& cfg, const Json& request) {
    const auto input = request.at("input").get<std::string>();
    const auto display = request.at("display").get<std::string>();
    const auto view = request.at("view").get<std::string>();
    auto space = cfg->getColorSpace(input.c_str());
    if (!space) throw std::runtime_error("输入颜色空间不存在。");
    bool displayFound = false, viewFound = false;
    for (int i = 0; i < cfg->getNumDisplays(); ++i)
        if (display == cfg->getDisplay(i)) displayFound = true;
    if (displayFound) for (int i = 0; i < cfg->getNumViews(display.c_str()); ++i)
        if (view == cfg->getView(display.c_str(), i)) viewFound = true;
    if (!displayFound || !viewFound) throw std::runtime_error("Display / View 不存在。");
    if (space->isData()) {
        auto identity = cfg->getProcessor(input.c_str(), input.c_str());
        return {identity, identity};
    }
    if (!cfg->getColorSpace("scene_linear"))
        throw std::runtime_error("配置缺少 scene_linear，无法确定曝光工作空间；请使用 Raw 或补充配置。");
    auto mode = request.value("lookMode", std::string("config"));
    auto look = request.value("look", std::string());
    if (mode != "config" && mode != "none" && mode != "override")
        throw std::runtime_error("Look 模式无效。");
    auto group = OCIO::GroupTransform::Create();
    if (mode == "override") {
        bool found = false;
        for (int i = 0; i < cfg->getNumLooks(); ++i)
            if (look == cfg->getLookNameByIndex(i)) found = true;
        if (!found) throw std::runtime_error("Look 不存在。");
        auto transform = OCIO::LookTransform::Create();
        transform->setSrc("scene_linear");
        transform->setDst("scene_linear");
        transform->setLooks(look.c_str());
        group->appendTransform(transform);
    }
    auto transform = OCIO::DisplayViewTransform::Create();
    transform->setSrc("scene_linear");
    transform->setDisplay(display.c_str());
    transform->setView(view.c_str());
    transform->setLooksBypass(mode != "config");
    group->appendTransform(transform);
    return {cfg->getProcessor(input.c_str(), "scene_linear"), cfg->getProcessor(group)};
}

Json shader(const OCIO::ConstProcessorRcPtr& processor, const std::string& function, bool hlsl = false) {
    auto desc = OCIO::GpuShaderDesc::CreateShaderDesc();
    desc->setLanguage(hlsl ? OCIO::GPU_LANGUAGE_HLSL_SM_5_0 : OCIO::GPU_LANGUAGE_GLSL_ES_3_0);
    desc->setAllowTexture1D(false);
    desc->setTextureMaxWidth(4096);
    desc->setFunctionName(function.c_str());
    desc->setResourcePrefix((function + "_").c_str());
    processor->getDefaultGPUProcessor()->extractGpuShaderInfo(desc);
    if (desc->getNumUniforms()) throw std::runtime_error("此配置包含暂不支持的动态 OCIO 参数。");
    Json textures = Json::array();
    size_t total = 0;
    auto values = [&](const float* data, uint64_t count) {
        if (count > maxValues || total > maxValues - count)
            throw std::runtime_error("配置 LUT 超过当前 GPU 预览资源上限。");
        total += static_cast<size_t>(count);
        if (!data && count) throw std::runtime_error("OCIO LUT 数据缺失。");
        Json result = Json::array();
        for (size_t i = 0; i < count; ++i) {
            if (!std::isfinite(data[i])) throw std::runtime_error("OCIO LUT 包含非有限数值。");
            result.push_back(data[i]);
        }
        return result;
    };
    for (unsigned i = 0; i < desc->getNumTextures(); ++i) {
        const char* textureName = nullptr;
        const char* sampler = nullptr;
        unsigned width = 0, height = 0;
        OCIO::GpuShaderDesc::TextureType channel;
        OCIO::GpuShaderDesc::TextureDimensions dimensions;
        OCIO::Interpolation interpolation;
        desc->getTexture(i, textureName, sampler, width, height, channel, dimensions, interpolation);
        const int channels = channel == OCIO::GpuShaderDesc::TEXTURE_RED_CHANNEL ? 1 : 3;
        const float* data = nullptr;
        desc->getTextureValues(i, data);
        // Division guards the product even for corrupt or pathological metadata.
        if (!width || !height || width > maxValues || height > maxValues / width / channels)
            throw std::runtime_error("配置 LUT 超过当前 GPU 预览资源上限。");
        textures.push_back({{"textureName", textureName}, {"sampler", sampler}, {"dimension", 2}, {"width", width},
            {"height", height}, {"channels", channels}, {"linear", interpolation == OCIO::INTERP_LINEAR},
            {"values", values(data, uint64_t(width) * height * channels)}});
    }
    for (unsigned i = 0; i < desc->getNum3DTextures(); ++i) {
        const char* textureName = nullptr;
        const char* sampler = nullptr;
        unsigned edge = 0;
        OCIO::Interpolation interpolation;
        desc->get3DTexture(i, textureName, sampler, edge, interpolation);
        const float* data = nullptr;
        desc->get3DTextureValues(i, data);
        if (!edge || edge > 128) throw std::runtime_error("配置 LUT 超过当前 GPU 预览资源上限。");
        textures.push_back({{"textureName", textureName}, {"sampler", sampler}, {"dimension", 3}, {"width", edge},
            {"height", edge}, {"depth", edge}, {"channels", 3},
            {"linear", interpolation == OCIO::INTERP_LINEAR},
            {"values", values(data, uint64_t(edge) * edge * edge * 3)}});
    }
    return {{"code", desc->getShaderText()}, {"textures", textures}};
}

std::string sha256(const std::string& value) {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
    struct Cleanup {
        BCRYPT_ALG_HANDLE& algorithm; BCRYPT_HASH_HANDLE& hash;
        ~Cleanup() { if (hash) BCryptDestroyHash(hash); if (algorithm) BCryptCloseAlgorithmProvider(algorithm, 0); }
    } cleanup{algorithm, hash};
    auto require = [](NTSTATUS status) {
        if (status < 0) throw std::runtime_error("无法生成 OCIO 资源标识。");
    };
    require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0));
    require(BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0));
    require(BCryptHashData(hash, reinterpret_cast<PUCHAR>(const_cast<char*>(value.data())),
        static_cast<ULONG>(value.size()), 0));
    std::array<unsigned char, 32> digest{};
    require(BCryptFinishHash(hash, digest.data(), static_cast<ULONG>(digest.size()), 0));
    const char* hex = "0123456789abcdef";
    std::string result;
    for (auto byte : digest) { result += hex[byte >> 4]; result += hex[byte & 15]; }
    return result;
}

Json build(const Json& request) {
    auto cfg = configFor(request.at("source").get<std::string>());
    const auto pair = processors(cfg, request);
    auto a = shader(pair.first, "owlInput", request.value("hlsl", false)), b = shader(pair.second, "owlDisplay", request.value("hlsl", false));
    Json textures = std::move(a["textures"]);
    for (auto& texture : b["textures"]) textures.push_back(std::move(texture));
    size_t total = 0;
    for (const auto& texture : textures) total += texture.at("values").size();
    if (textures.size() > 14 || total > maxValues)
        throw std::runtime_error("配置 LUT 超过当前 GPU 预览资源上限。");
    const auto code = a.at("code").get<std::string>() + "\n" + b.at("code").get<std::string>();
    const bool dataInput = cfg->getColorSpace(request.at("input").get<std::string>().c_str())->isData();
    const auto id = sha256(std::string(pair.first->getCacheID()) + pair.second->getCacheID() +
                           code + (dataInput ? "True" : "False"));
    Json selection = Json::object();
    for (const char* key : {"input", "display", "view", "lookMode", "look"})
        selection[key] = request.contains(key) ? request.at(key) : Json(nullptr);
    return {{"id", id}, {"dataInput", dataInput}, {"code", code},
            {"textures", textures}, {"selection", selection}};
}

Json run(const Json& request) {
    const auto action = request.at("action").get<std::string>();
    if (action == "catalog") return catalog(request.at("source").get<std::string>());
    if (action == "build") return build(request);
    if (action == "reference") {
        auto cfg = configFor(request.at("source").get<std::string>());
        auto space = cfg->getColorSpace(request.at("input").get<std::string>().c_str());
        if (!space) throw std::runtime_error("输入颜色空间不存在。");
        if (space->isData()) return request.at("samples");
        auto pair = processors(cfg, request);
        auto a = pair.first->getDefaultCPUProcessor(), b = pair.second->getDefaultCPUProcessor();
        const auto exposure = std::exp2(request.value("exposure", 0.0));
        if (!std::isfinite(exposure)) throw std::runtime_error("曝光值无效。");
        Json results = Json::array();
        for (const auto& sample : request.at("samples")) {
            if (!sample.is_array() || sample.size() != 3) throw std::runtime_error("RGB 样本格式无效。");
            float rgb[3] = {sample[0].get<float>(), sample[1].get<float>(), sample[2].get<float>()};
            a->applyRGB(rgb);
            for (auto& v : rgb) v = static_cast<float>(v * exposure);
            b->applyRGB(rgb);
            for (auto v : rgb) if (!std::isfinite(v)) throw std::runtime_error("色彩结果包含非有限数值。");
            results.push_back({rgb[0], rgb[1], rgb[2]});
        }
        return results;
    }
    throw std::runtime_error("未知 OCIO 请求。");
}
} // namespace

namespace owl::desktop {
nlohmann::json colorRequest(const nlohmann::json& request) { return run(request); }
}
#ifndef OWLSIGHT_OCIO_LIBRARY
int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    OCIO::SetLoggingLevel(OCIO::LOGGING_LEVEL_WARNING);
    // Drain oversized lines without allocating unbounded memory, then report one error.
    while (true) {
        std::string line;
        bool oversized = false, received = false;
        char ch;
        while (std::cin.get(ch)) {
            received = true;
            if (ch == '\n') break;
            if (line.size() < maxRequest) line += ch; else oversized = true;
        }
        if (!received) break;
        Json response;
        try {
            if (oversized) throw std::runtime_error("OCIO 请求过长。");
            response = {{"ok", true}, {"result", run(Json::parse(line))}};
            const auto encoded = response.dump(-1, ' ', false, Json::error_handler_t::replace);
            if (encoded.size() >= 64 * 1024 * 1024) throw std::runtime_error("OCIO 配置生成的数据超过上限。");
            std::cout << encoded << '\n' << std::flush;
        } catch (const std::exception& error) {
            response = {{"ok", false}, {"error", error.what()}};
            std::cout << response.dump(-1, ' ', false, Json::error_handler_t::replace) << '\n' << std::flush;
        }
        if (!std::cout) return 1;
    }
    return 0;
}
#endif
