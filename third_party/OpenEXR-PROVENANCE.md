# OpenEXR Python 运行组件来源

本版本使用 PyPI 发布的 `openexr-3.4.15-cp312-cp312-win_amd64.whl`，不修改其中的二进制模块。

## 归档与二进制标识

| 项目 | SHA-256 |
|---|---|
| OpenEXR 3.4.15 Windows CPython 3.12 wheel | `7aa145813acfe10a83d6e89340349379828190b321608e69f2aee426e10c890b` |
| OpenEXR 3.4.15 源码归档 | `6c9a28a4f4089379c9c4fd301edaa4dba0ed315862c029f453690a8191370a47` |
| 随包 `OpenEXR.cp312-win_amd64.pyd` | `970f4c5524ff65173acee325b33897faf04864b7bf6e6c56b751b7f9722e1383` |

wheel 和源码归档哈希与 [PyPI 版本元数据](https://pypi.org/pypi/OpenEXR/3.4.15/json) 一致；随包二进制哈希与该 wheel 内的同名文件一致。

- [官方 wheel](https://files.pythonhosted.org/packages/ce/75/1f0d0acc9fbd344d274253dc26876583f74cd619438e914c210faa1c5091/openexr-3.4.15-cp312-cp312-win_amd64.whl)
- [官方源码归档](https://files.pythonhosted.org/packages/21/a3/8b57f9bef539c195363cf966bbdc02951d3ce5d0a9f612d262f7fe66caad/openexr-3.4.15.tar.gz)
- [OpenEXR v3.4.15](https://github.com/AcademySoftwareFoundation/openexr/tree/v3.4.15)

## 上游构建依赖与许可证

以下依赖按 OpenEXR 同版本官方源码与发布配置记录。其 `pyproject.toml` 强制使用内部 Imath、libdeflate、OpenJPH，并关闭共享库构建；pybind11 版本由构建依赖固定。

| 组件 | 上游版本依据 | 许可证文本 |
|---|---|---|
| OpenEXR 3.4.15 | 源码发行版本 | [BSD-3-Clause](licenses/OpenEXR-3.4.15-LICENSE.md) |
| Imath 3.2.2 | `cmake/OpenEXRSetup.cmake` 中的 `OPENEXR_IMATH_TAG` | [BSD-3-Clause](licenses/Imath-3.2.2-LICENSE.md) |
| libdeflate 1.25 | 源码中的 `external/deflate/libdeflate.h` | [MIT](licenses/libdeflate-1.25-COPYING) |
| OpenJPH 0.31.0 | 源码中的 `external/OpenJPH/src/core/openjph/ojph_version.h` | [BSD-2-Clause](licenses/OpenJPH-LICENSE) |
| pybind11 2.13.6 | `pyproject.toml` 构建依赖 | [BSD 及附带第三方声明](licenses/pybind11-2.13.6-LICENSE) |

libdeflate 和 OpenJPH 的许可证直接取自上述校验过的源码归档；Imath 与 pybind11 的文本取自对应官方版本标签。

## 构建材料

源码归档包含 `pyproject.toml`、CMake 配置、Python 绑定和内置 libdeflate / OpenJPH 源码。Imath 取自官方 `v3.2.2` 标签；Python 构建依赖为 scikit-build-core 0.12.2、pybind11 2.13.6 和 build 1.2.2.post1。

原生模块的重新构建遵循 [OpenEXR 官方构建说明](https://openexr.com/en/latest/install.html)，需要相应 C++ 编译环境与 CMake。上面记录的是源材料和上游构建入口，不表示已在 OwlSight 项目中复现了逐字节相同的 wheel。
