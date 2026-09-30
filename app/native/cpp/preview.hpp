// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <nlohmann/json.hpp>
#include <half.h>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <list>
#include <memory>
#include <string>
#include <vector>

namespace owl {
using Json = nlohmann::json;
using Clock = std::chrono::steady_clock;
constexpr std::size_t MiB = 1024u * 1024u;
constexpr std::size_t PlaneLimit = 96u * MiB;
double elapsed(Clock::time_point start);
Json processSample();
void writeFrame(const Json& metadata, const void* pixels = nullptr, std::size_t bytes = 0);

struct Part {
    Json metadata;
    std::vector<std::string> channels;
    std::vector<int> types;
    int width = 0, height = 0;
};
struct Header {
    std::string key;
    std::vector<Part> parts;
    Json metadata() const;
};
struct Plane {
    std::string fileKey;
    int partIndex = 0, width = 0, height = 0;
    std::vector<std::string> channels;
    bool half = false;
    std::vector<IMATH_NAMESPACE::half> halves;
    std::vector<float> floats;
    ~Plane();
    static std::size_t liveBytes();
    void allocate(std::size_t samples, Json* timing=nullptr);
    std::size_t byteSize() const;
    const void* data() const;
    void* data();
    float value(std::size_t index) const;
    void copySample(std::size_t target, const Plane& source, std::size_t index);
};
struct PreviewResult { Json metadata; std::shared_ptr<const Plane> pixels; };
class Preview {
public:
    Preview();
    PreviewResult result(const Json& request);
    void respond(const Json& request);
private:
    std::list<Header> headers_;
    std::list<std::shared_ptr<Plane>> planes_;
    std::size_t planeBytes_ = 0;
    double initializationMs_ = 0;
    Header& header(const std::string& filename, bool& hit);
    std::shared_ptr<Plane> read(const std::string& filename, const Header& header,
        int partIndex, const std::vector<std::string>& names, bool& hit, Json& timing);
};
} // namespace owl
