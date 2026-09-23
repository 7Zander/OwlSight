# OwlSight 第三方软件声明

版本：alpha_v0.1.0（0.1.0-alpha.1）。以下为本版本随包运行组件与构建依赖清单。

| 组件 | 版本 | 用途 | 许可证及源码 |
|---|---|---|---|
| Electron | 44.4.3 | 桌面运行时 | MIT；https://github.com/electron/electron/tree/v44.4.3 |
| Chromium / Node.js 等 | 随 Electron | 浏览器/GPU/系统运行时 | 保留 EXE 同目录 LICENSE、LICENSES.chromium.html |
| CPython | 3.12.14 x64 | 随包隔离辅助运行时 | PSF 及附带声明；https://www.python.org/downloads/release/python-31214/ |
| OpenEXR | 3.4.15 | 官方 EXR 解码 Python 模块及 C++ 实现 | BSD-3-Clause；https://github.com/AcademySoftwareFoundation/openexr/tree/v3.4.15 |
| OpenImageIO | 3.1.17.0 | 按需读取所选 EXR Part/通道 | Apache-2.0 及 wheel 附带第三方声明；https://github.com/AcademySoftwareFoundation/OpenImageIO/tree/v3.1.17.0 |
| OpenColorIO | 2.5.1 | 生成 GPU 色彩 Shader / LUT；内置 ACES CG 配置 | BSD-3-Clause 及 wheel 随附声明；https://github.com/AcademySoftwareFoundation/OpenColorIO/tree/v2.5.1 |
| NumPy | 2.3.5 | 通道浮点数组转换 | BSD-3-Clause 及随 wheel 附带 OpenBLAS 等声明；https://github.com/numpy/numpy/tree/v2.3.5 |

运行时不再使用 exrs WASM。OpenEXR、OpenImageIO、OpenColorIO、NumPy 和 Python 许可证全文保存在 third_party/licenses；Python/LICENSE 与各 wheel 的 dist-info/licenses 等文件也随隔离运行时保留。OpenEXR wheel 的官方来源、二进制哈希、上游静态组件版本、许可证与构建材料见 [OpenEXR 来源记录](third_party/OpenEXR-PROVENANCE.md)。

构建与测试依赖不随运行包分发：@electron/packager 20.3.0（BSD-2-Clause）、Playwright 1.58.2（Apache-2.0）、npm 12.0.2（Artistic-2.0）、exrs 1.0.3（BSD-3-Clause）、exrs-raw-wasm-bindgen 0.1.0、shallow-equals 1.0.0（MIT）、tslib 2.8.1（0BSD）。exrs 仅作为独立对照测试与样例编码工具，旧许可证保留。

OwlSight 源码采用 GPL-3.0-or-later，完整文本见根目录 LICENSE。私人素材、测试日志及构建环境不进入便携包。resources/demo.exr 为本项目生成的可再分发样例，生成脚本与项目同许可证。

OpenEXR 上游构建包含 Imath 3.2.2、libdeflate 1.25、OpenJPH 0.31.0 与 pybind11 2.13.6；相应版权及许可证全文已保存在 third_party/licenses。源码获取方式与版本依据见上述来源记录。
