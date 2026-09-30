# 第三方组件

OwlSight v0.2.0 / build-0030 使用 C++ 与 Qt Quick。应用许可为 GPL-3.0-or-later，全文见 LICENSE。下列组件的许可证原文保留在 app/third_party/licenses/；nlohmann/json 的许可证同时位于 app/third_party/nlohmann/LICENSE.MIT。

| 组件 | 固定版本 | 许可或说明 |
|---|---|---|
| Qt | 6.11.3 | 动态库；GPL/LGPL 及 Qt exception 原文见 qt/ |
| OpenEXR | 3.4.15 | BSD-3-Clause |
| Imath | 3.2.2 | BSD-3-Clause |
| libdeflate | 1.25 | MIT；OpenEXR 附带依赖 |
| OpenJPH | 0.31.0 | BSD-2-Clause；OpenEXR 附带依赖 |
| OpenColorIO | 2.5.1 | BSD-3-Clause；附带组件声明见 OpenColorIO-2.5.1-native/THIRD-PARTY.md |
| yaml-cpp | 0.8.0 | MIT |
| pystring | 1.1.4 | BSD-3-Clause；C++ 库 |
| expat | 2.7.2 | MIT |
| zlib | 1.3.1 | zlib |
| minizip-ng | 4.0.10 | zlib |
| nlohmann/json | 3.12.0 | MIT |
| LLVM-MinGW | 20260922 | LLVM 与 MinGW runtime 许可见 LLVM-23-LICENSE.TXT 和 MinGW-runtime/ |

固定下载地址与摘要在 app/scripts/prepare-cpp-tools.ps1 和 app/scripts/prepare-qt.ps1 中；Qt 归档记录在 app/native/desktop/sdk-archives.json 中。

OCIO 的 FileTransform.cpp 使用 C++17 filesystem::path 兼容 LLVM libc++ 的 Windows Unicode 路径；修改由 app/scripts/build-ocio.mjs 实施。随程序打包的 Qt 组件详细记录来自官方 SDK 的 sbom/，放在 third_party/qt-sbom/。

Windows 系统 DLL 与系统字体不随程序复制分发。