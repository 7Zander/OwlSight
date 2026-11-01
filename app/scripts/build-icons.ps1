# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$QtRoot,[string]$BuildDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$QtRoot){$QtRoot=Join-Path $WorkspaceRoot 'build/qt-sdk'}
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/icon-builder'}
$arguments=@('-S',"$SourceRoot/tools",'-B',$BuildDirectory,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',"-DCMAKE_MAKE_PROGRAM=$env:OWLSIGHT_NINJA","-DCMAKE_CXX_COMPILER=$env:OWLSIGHT_CPP_TOOLCHAIN/x86_64-w64-mingw32-clang++.exe","-DCMAKE_PREFIX_PATH=$QtRoot")
& $env:OWLSIGHT_CMAKE @arguments
if($LASTEXITCODE){throw 'Icon builder configuration failed.'}
& $env:OWLSIGHT_CMAKE --build $BuildDirectory --target owlsight-icon-builder --parallel 4
if($LASTEXITCODE){throw 'Icon builder compilation failed.'}
$env:PATH="$QtRoot/bin;$env:OWLSIGHT_CPP_TOOLCHAIN;$env:PATH"
& "$BuildDirectory/owlsight-icon-builder.exe" "$SourceRoot/resources/owlsight.svg" "$SourceRoot/resources/owlsight.ico"
if($LASTEXITCODE){throw 'SVG to ICO conversion failed.'}
