# 第三方组件

OwlSight 采用 GPL-3.0-or-later，全文见 LICENSE。第三方许可证原文位于 app/third_party/licenses/；Qt 模块归属与许可记录位于 app/third_party/qt-sbom/。

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| Qt | 6.11.3 | GPL / LGPL；包含 Qt exception |
| OpenEXR | 3.4.15 | BSD-3-Clause |
| Imath | 3.2.2 | BSD-3-Clause |
| libdeflate | 1.25 | MIT |
| OpenJPH | 0.31.0 | BSD-2-Clause |
| OpenColorIO | 2.5.1 | BSD-3-Clause |
| yaml-cpp | 0.8.0 | MIT |
| pystring | 1.1.4 | BSD-3-Clause |
| expat | 2.7.2 | MIT |
| zlib | 1.3.1 | zlib |
| minizip-ng | 4.0.10 | zlib |
| nlohmann/json | 3.12.0 | MIT |
| LLVM-MinGW | 20260922 | LLVM 与 MinGW runtime 许可 |

Qt 运行库动态链接，源码见 [Qt 官方源码库](https://code.qt.io/cgit/qt/)中对应模块的 v6.11.3 标签。固定依赖来源与摘要位于 app/scripts/prepare-cpp-tools.ps1、app/scripts/prepare-qt.ps1 和 app/native/desktop/sdk-archives.json。

OpenColorIO 附带组件声明见 OpenColorIO-2.5.1-native/THIRD-PARTY.md。其 Windows Unicode 路径适配由 app/scripts/build-ocio.mjs 中的 C++17 filesystem::path 修改实现。Windows 系统 DLL 和系统字体不随程序分发。

Inno Setup 7.1.1 用于安装程序；完整许可见 app/third_party/licenses/InnoSetup-7.1.1-LICENSE.txt。安装引擎保持上游版权与网站声明。
