// SPDX-License-Identifier: GPL-3.0-or-later
#include "preview.hpp"
#include <array>
#include <iostream>
#include <limits>
#include <stdexcept>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#include <fcntl.h>
#include <io.h>
#endif

namespace owl {
double elapsed(Clock::time_point start) {
    return std::chrono::duration<double, std::milli>(Clock::now() - start).count();
}
Json processSample() {
    static auto previous = Clock::now();
    static double previousCpu = 0;
    static Json cached;
    const auto now = Clock::now();
    const double interval = std::chrono::duration<double>(now - previous).count();
    if (!cached.is_null() && interval < 1.0) return cached;
    Json result;
    result["collectedAtUnixMs"] = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    result["intervalMs"] = interval * 1000;
#ifdef _WIN32
    result["pid"] = GetCurrentProcessId();
    FILETIME creation{}, exit{}, kernel{}, user{};
    if (GetProcessTimes(GetCurrentProcess(), &creation, &exit, &kernel, &user)) {
        const auto seconds = [](FILETIME t) {
            ULARGE_INTEGER value{}; value.LowPart = t.dwLowDateTime; value.HighPart = t.dwHighDateTime;
            return static_cast<double>(value.QuadPart) / 10000000.0;
        };
        const double cpu = seconds(kernel) + seconds(user);
        result["cpuCorePercent"] = cached.is_null() ? 0.0 : 100 * (cpu - previousCpu) / std::max(0.001, interval);
        previousCpu = cpu;
    }
    PROCESS_MEMORY_COUNTERS_EX memory{};
    memory.cb = sizeof(memory);
    if (GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&memory), sizeof(memory))) {
        result["workingSetMiB"] = static_cast<double>(memory.WorkingSetSize) / MiB;
        result["privateMiB"] = static_cast<double>(memory.PrivateUsage) / MiB;
    }
#endif
    previous = now; cached = result;
    return result;
}
void writeFrame(const Json& metadata, const void* pixels, std::size_t bytes) {
    std::string text = metadata.dump(-1, ' ', false, Json::error_handler_t::replace);
    text.append((4 - text.size() % 4) % 4, ' ');
    if (text.size() > MiB || bytes > 512 * MiB)
        throw std::runtime_error("解码结果超过传输上限。");
    const auto count = static_cast<std::uint32_t>(text.size());
    const std::array<char,4> prefix{
        static_cast<char>(count), static_cast<char>(count >> 8),
        static_cast<char>(count >> 16), static_cast<char>(count >> 24)};
    std::cout.write(prefix.data(), prefix.size());
    std::cout.write(text.data(), static_cast<std::streamsize>(text.size()));
    if (bytes) std::cout.write(static_cast<const char*>(pixels), static_cast<std::streamsize>(bytes));
    std::cout.flush();
    if (!std::cout) throw std::ios_base::failure("Pixel output pipe closed");
}
}

int main() {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
    _setmode(_fileno(stdout), _O_BINARY);
#endif
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);
    try {
        owl::Preview preview;
        // Consume an oversized line without retaining it, preserving stream alignment.
        for (;;) {
            std::string line;
            bool oversized = false, received = false;
            char c;
            while (std::cin.get(c)) {
                received = true;
                if (c == '\n') break;
                if (line.size() < 65536) line.push_back(c); else oversized = true;
            }
            if (!received) break;
            try {
                if (oversized) throw std::runtime_error("请求过长。");
                preview.respond(owl::Json::parse(line));
            } catch (const std::exception& error) {
                if (!std::cout) return 1;
                owl::writeFrame({{"parts", owl::Json::array()}, {"error", error.what()}});
            }
            if (!std::cin) break;
        }
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    return 0;
}
