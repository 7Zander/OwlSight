# OwlSight

OwlSight v0.2.0 / build-0030 是 Windows x64 的 EXR 查看器，使用 C++ 与 Qt Quick。支持图像序列播放、通道切换、静态通道网格及 OpenColorIO 显示变换。

## 操作

打开 EXR 或将文件拖入窗口。S 切换通道，A 在单图和静态网格之间切换，Space 播放/暂停，左右键逐帧，1 / 2 / 3 / 4 切换显示分辨率。右键菜单提供色彩、曝光和缓存设置。此版网格为静态预览。

完整解压 Windows 程序包后运行 OwlSight.exe，保留同目录的 DLL、qml 和插件目录。个人设置位于程序旁 settings/；点击记录按钮后才会生成 logs/。

## 源码与构建

- app/native/desktop/：Qt Quick 客户端、QML 界面和着色器。
- app/native/cpp/：EXR 与色彩处理核心。
- app/scripts/：依赖准备、编译和打包脚本。
- app/release.json：版本配置。
- app/third_party/：随源码提供的头文件与许可证。

在仓库根目录执行（需要 PowerShell、Node.js，以及支持解压 Qt 7z 归档的 tar.exe）：

```powershell
powershell -ExecutionPolicy Bypass -File app/scripts/build-native.ps1 -PrepareQt
powershell -ExecutionPolicy Bypass -File app/scripts/package-native.ps1
```

依赖准备脚本会下载固定版本工具链和库并核对归档摘要；固定地址及摘要见 prepare-cpp-tools.ps1 与 prepare-qt.ps1。Qt 版本为 6.11.3，其他依赖版本见 THIRD_PARTY_NOTICES.md。构建文件位于 build/，交付文件位于 dist/v0.2.0/build-0030/。

此源码目录以 build-0030 为准；本次仅整理源码与构建路径，未重新编译、运行程序或测试。

## 许可

应用采用 GPL-3.0-or-later，全文见 LICENSE。第三方组件声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证原文保留在 app/third_party/。