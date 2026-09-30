# SPDX-License-Identifier: GPL-3.0-or-later
# Dot-source to keep process-local build settings: . ./scripts/prepare-cpp-tools.ps1
param([string]$SdkRoot = (Join-Path $PSScriptRoot '../build/cpp-sdk'))
$ErrorActionPreference = 'Stop'
$SdkRoot = [System.IO.Path]::GetFullPath($SdkRoot)
$downloads = Join-Path $SdkRoot 'downloads'
$sources = Join-Path $SdkRoot 'sources'
New-Item -ItemType Directory -Path $downloads,$sources -Force | Out-Null
$archives = @(
  @{name='llvm-mingw-20260922-ucrt-x86_64.zip';url='https://github.com/mstorsjo/llvm-mingw/releases/download/20260922/llvm-mingw-20260922-ucrt-x86_64.zip';sha='e3ad77d117a4bea19a7a3b333341824d79a5a371004a10e25b8504e7b3047666';folder='llvm-mingw-20260922-ucrt-x86_64'},
  @{name='cmake-4.4.3-windows-x86_64.zip';url='https://github.com/Kitware/CMake/releases/download/v4.4.3/cmake-4.4.3-windows-x86_64.zip';sha='4d52ebab7193a698651639ed80d8d04fd903358843572cf44c7fd234cb7c26ab';folder='cmake-4.4.3-windows-x86_64'},
  @{name='ninja-win.zip';url='https://github.com/ninja-build/ninja/releases/download/v1.13.2/ninja-win.zip';sha='07fc8261b42b20e71d1720b39068c2e14ffcee6396b76fb7a795fb460b78dc65';folder='ninja'},
  @{name='Imath-3.2.2.tar.gz';url='https://github.com/AcademySoftwareFoundation/Imath/releases/download/v3.2.2/Imath-3.2.2.tar.gz';sha='0f5a783b424f374e6f27ec8b0c73130e89b08814ac8fa2e84fd7fe0b05862c53';folder='sources/Imath-3.2.2'},
  @{name='openexr-3.4.15.tar.gz';url='https://github.com/AcademySoftwareFoundation/openexr/releases/download/v3.4.15/openexr-3.4.15.tar.gz';sha='ab893d8003773ccd9a5556b2caf38da591ae37e20b06ee9d589a08984c5191f2';folder='sources/openexr-3.4.15'},
  @{name='OpenColorIO-2.5.1.tar.gz';url='https://github.com/AcademySoftwareFoundation/OpenColorIO/releases/download/v2.5.1/OpenColorIO-2.5.1.tar.gz';sha='49ab04d023d7a7a7237e24f2cfead3171b0ff7f466ce20e6e32859ec8c7cc94b';folder='sources/OpenColorIO-2.5.1'},
  @{name='expat-2.7.2.tar.gz';url='https://github.com/libexpat/libexpat/releases/download/R_2_7_2/expat-2.7.2.tar.gz';sha='13d42a125897329bfeecab899cb9b5a3ec8c26072994b5cd4c41f28241f5bce7';folder='sources/expat-2.7.2'},
  @{name='yaml-cpp-0.8.0.tar.gz';url='https://codeload.github.com/jbeder/yaml-cpp/tar.gz/refs/tags/0.8.0';sha='fbe74bbdcee21d656715688706da3c8becfd946d92cd44705cc6098bb23b3a16';folder='sources/yaml-cpp-0.8.0'},
  @{name='pystring-1.1.4.tar.gz';url='https://codeload.github.com/imageworks/pystring/tar.gz/refs/tags/v1.1.4';sha='49da0fe2a049340d3c45cce530df63a2278af936003642330287b68cefd788fb';folder='sources/pystring-1.1.4'},
  @{name='zlib-1.3.1.tar.gz';url='https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz';sha='9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23';folder='sources/zlib-1.3.1'},
  @{name='minizip-ng-4.0.10.tar.gz';url='https://codeload.github.com/zlib-ng/minizip-ng/tar.gz/refs/tags/4.0.10';sha='c362e35ee973fa7be58cc5e38a4a6c23cc8f7e652555daf4f115a9eb2d3a6be7';folder='sources/minizip-ng-4.0.10'}
)
foreach ($item in $archives) {
  $archive = Join-Path $downloads $item.name
  if (-not (Test-Path -LiteralPath $archive)) { Invoke-WebRequest -Uri $item.url -OutFile $archive }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha) {
    throw "Downloaded file checksum differs: $archive. No build was started."
  }
  $stamp = Join-Path $SdkRoot ($item.folder + '/.owlsight-extracted')
  if (Test-Path -LiteralPath $stamp) { continue }
  if ($item.name.EndsWith('.zip')) {
    $destination = if ($item.name -eq 'ninja-win.zip') {Join-Path $SdkRoot 'ninja'} else {$SdkRoot}
    Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
  } else {
    & tar --exclude=openexr-3.4.15/src/test/OpenEXRFuzzTest/oss-fuzz -xzf $archive -C $sources
    if ($LASTEXITCODE -ne 0) { throw "Source extraction failed: $archive" }
  }
  [System.IO.File]::WriteAllText($stamp,$item.sha)
}
$env:OWLSIGHT_CPP_TOOLCHAIN = Join-Path $SdkRoot 'llvm-mingw-20260922-ucrt-x86_64/bin'
$env:OWLSIGHT_CMAKE = Join-Path $SdkRoot 'cmake-4.4.3-windows-x86_64/bin/cmake.exe'
$env:OWLSIGHT_NINJA = Join-Path $SdkRoot 'ninja/ninja.exe'
$env:OWLSIGHT_CPP_DEPS = $sources
Write-Output "C++ build tools ready in $SdkRoot. Only this process environment was changed."
