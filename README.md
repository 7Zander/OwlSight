# OwlSight

本项目全程采用 Vibe Coding 方式开发。

**这是一个面向 CG / VFX 工作流的 EXR 图像与序列查看器。**
## 介绍

<img width="1280" height="850" alt="Interface preview" src="https://github.com/user-attachments/assets/fe703393-a279-40e4-bca0-a979bc1d34c3" />
<img width="1280" height="850" alt="Interface preview2" src="https://github.com/user-attachments/assets/812c4394-bac0-4eb0-932d-82af19fdd423" />
<img width="1280" height="850" alt="Interface preview3" src="https://github.com/user-attachments/assets/9ca218a4-acbd-4676-9df0-bddf8db62f0a" />


OwlSight 专注于快速查看渲染结果。将其设为 EXR 默认打开方式后，可以双击文件打开；也可以直接把 EXR 拖入窗口，查看各个通道和播放图像序列。使用快捷键切换通道与预览分辨率，并通过 OpenColorIO 调整色彩显示。

当前仍处于 Alpha 阶段，计划提供两种使用模式：
1. **Quick Viewer**：用户双击 EXR 文件后快速打开，用于轻量查看和基础序列浏览。（当前已完成的基础功能）
2. **Board Workspace**：用户主动进入的画布空间，用于排列、比较和 Review 多个 EXR 序列及参考素材。（规划中）

## 项目导航
[下载 Alpha](https://github.com/7Zander/OwlSight/releases) · [使用说明](USER_GUIDE.md) · [更新记录](CHANGELOG.md) · [问题反馈](https://github.com/7Zander/OwlSight/issues)

> 当前版本：**alpha_v0.1.0**（`0.1.0-alpha.1`）。目前提供 Windows x64 便携版，处于早期公开测试阶段，功能和兼容性仍在完善。

## 主要功能

- **EXR 图像与序列** — 打开单张 EXR，自动识别同目录序列，支持播放、逐帧浏览、循环与拖动定位。
- **图层与通道查看** — 在组合图层、独立数据通道和 RGBA 分量之间切换；使用网格同时浏览多个图层。
- **色彩显示** — 内置 ACES 配置，支持自定义 OCIO 配置与 LUT、Input / Display / View / Look 选择、曝光和 Raw 数据查看。
- **预览与缓存** — 提供完整、1/2、1/3、1/4、1/8 分辨率，可设置默认预览分辨率与图像缓存预算。
- **桌面操作** — 缩放、平移、全屏播放、窗口置顶，以及通过 Windows 设置 EXR 默认打开方式。
- **本地工作** — 不改写源 EXR，不自动上传日志；运行所需依赖随便携包提供。

## 下载与运行

1. 打开 [Releases](https://github.com/7Zander/OwlSight/releases)，下载 `OwlSight-alpha_v0.1.0-windows-x64.zip`。
2. 将 ZIP **完整解压**到可写目录。
3. 运行文件夹内的 `OwlSight.exe`，拖入 EXR，或按 **Ctrl+O** 选择文件。

请保留整个程序文件夹，不能只复制 EXE。普通使用无需安装 Node.js、Python 或其他开发工具；首页提供内置多通道样例。

| 项目 | 当前范围 |
|---|---|
| 发布平台 | Windows x64；以 Windows 11 为主要目标 |
| Windows 10 | 兼容性需在实际系统确认 |
| 图形环境 | 需要可用的 WebGL2 图形环境 |
| 分发形式 | ZIP 便携包，无安装器 |
| 代码签名 | 当前版本未签名 |

Release 同时提供源码 ZIP 和 `SHA256SUMS.txt`。源码包供开发者使用；下载校验文件可用于核对 ZIP 的完整性。

## 常用快捷键

| 快捷键 / 操作 | 功能 |
|---|---|
| Ctrl+O | 打开 EXR |
| Space | 播放 / 暂停 |
| ← / → | 上一张 / 下一张已有帧 |
| R | 从序列第一帧重新播放 |
| S | 循环切换图层 / 通道 |
| A | 切换网格与单图 |
| 右键 | 图层、RGBA 分量、显示设置和应用设置 |
| 主键盘 1 / 2 / 3 / 4 | 完整 / 1/2 / 1/3 / 1/4 分辨率 |
| F / 双击画面 | 适应窗口 / 切换适应窗口与 100% |
| 滚轮 / 中键拖动 | 缩放 / 平移 |
| Ctrl+F / Esc | 全屏播放 / 退出全屏 |
| Ctrl+T | 切换窗口置顶 |

完整鼠标操作、序列命名规则、OCIO 设置和日志位置见 [使用说明](USER_GUIDE.md)。

## 当前限制

- 暂不支持 Deep EXR、子采样通道、Alpha 合成、显示器 ICC 管理与 HDR 输出。
- 图像按 Data Window 显示，尚未还原到完整 Display Window。
- 单文件上限 256 MiB；最长边 16384，最多约 3200 万像素；全通道解码预算 1024 MiB。
- 播放速度受素材、分辨率、缓存与硬件影响，首次读取和未缓存切层可能等待。
- 序列目录不会实时刷新；渲染器新增或覆盖帧后，需要重新打开。
- 暂无 macOS / Linux 发布包、自动更新或快捷键自定义。

更多边界见 [使用说明](USER_GUIDE.md#已知限制)。Alpha 不承诺全部 EXR 格式组合、网络存储和硬件配置均兼容。

## 从源码构建

以下步骤用于 Windows x64 开发环境。

**前置环境**：Node.js `>=24.15.0 <25`、npm `12.0.2`、CPython `3.12` x64。当前便携包使用 CPython `3.12.14`；依赖版本见 [`package.json`](package.json)、[`package-lock.json`](package-lock.json) 和 [`native/requirements.txt`](native/requirements.txt)。

获取源码后，在项目根目录执行：

```powershell
npm ci
py -3.12 -m venv build/native-env
build/native-env/Scripts/python.exe -m pip install -r native/requirements.txt
npm run build:decoder
npm start
```

`build:decoder` 会在 `resources/decoder` 生成隔离的 Python 与解码运行资源。该目录、开发依赖与本地构建输出不提交到仓库。

生成 Windows 便携程序：

```powershell
npm run package:win
```

输出位于 `dist/<构建时间>/OwlSight-win32-x64`，最新路径记录在 `build/latest-package.json`。每次构建使用独立目录；程序需连同该目录中的运行依赖整体分发。

<details>
<summary>构建目录配置</summary>

可选环境变量：

| 变量 | 用途 |
|---|---|
| `OWLSIGHT_BUILD_PYTHON` | 构建原生运行资源时使用的 Python |
| `OWLSIGHT_DECODER_DIR` | 打包时使用的解码运行资源 |
| `OWLSIGHT_ELECTRON_CACHE` | Electron 下载缓存 |
| `OWLSIGHT_PACKAGE_WORK_DIR` | 打包临时目录与构建记录 |
| `OWLSIGHT_PACKAGE_OUT` | 打包输出父目录 |

</details>

## 项目结构

```text
src/          Electron 主进程、通信接口、解码适配、缓存与渲染
ui/           界面、交互与播放调度
native/       Python 解码、OCIO 与平台辅助代码
resources/    内置样例与构建生成的运行资源
scripts/      构建、打包、样例生成与开发验证
tests/       单元测试、集成测试与样例生成辅助代码
third_party/  第三方许可证与来源信息
```

## 反馈与贡献

欢迎通过 [Issues](https://github.com/7Zander/OwlSight/issues) 报告问题或提出建议。反馈时请提供软件版本、Windows 版本、复现步骤、预期行为和实际结果；性能问题还应说明素材尺寸、通道数、预览分辨率与硬件信息。

请只提供有权分享的最小样例。性能日志可能包含素材路径，提交前请检查并脱敏。安全问题请按 [安全报告说明](SECURITY.md) 处理。

提交代码前可运行现有基础检查：

```powershell
npm run check
npm test
```

其他专项验证入口见 `package.json`；部分脚本需要先生成对应样例。目录检查和构建完成不等同于实际桌面体验或性能验收。

## 许可证

OwlSight 采用 [GPL-3.0-or-later](LICENSE)。Electron、OpenEXR、OpenImageIO、OpenColorIO、NumPy 与其他随附组件遵循各自的许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。

本地数据与日志处理方式见 [隐私说明](PRIVACY.md)。
