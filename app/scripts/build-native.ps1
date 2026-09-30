# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$QtRoot,[string]$BuildDirectory,[switch]$PrepareQt)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$QtRoot){$QtRoot=Join-Path $WorkspaceRoot 'build/qt-sdk'}
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/windows-x64'}
if($PrepareQt){& "$PSScriptRoot/prepare-qt.ps1" -SdkRoot $QtRoot}
. (Join-Path $PSScriptRoot 'prepare-cpp-tools.ps1') -SdkRoot (Join-Path $WorkspaceRoot 'build/cpp-sdk')
$env:OWLSIGHT_CPP_BUILD_DIR=Join-Path $WorkspaceRoot 'build/native/color'
$prefix=Join-Path $WorkspaceRoot 'build/native/color-ocio-prefix'
if(!(Test-Path "$prefix/lib/libOpenColorIO.a")){
 Write-Host "OCIO dependencies not found. Building..."
 & node (Join-Path $PSScriptRoot 'build-ocio.mjs') --dependencies-only
 if($LASTEXITCODE -ne 0){throw 'OCIO compilation failed.'}
}
$staticZlib=Join-Path $prefix 'lib/libzlibstatic.a'
if(!(Test-Path -LiteralPath $staticZlib -PathType Leaf)){throw 'The required static zlib archive is missing. Rebuild OCIO dependencies.'}
$env:PATH="$QtRoot/bin;$env:OWLSIGHT_CPP_TOOLCHAIN;$env:PATH"
$argsList=@('-S',"$SourceRoot/native/desktop",'-B',$BuildDirectory,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',
 "-DCMAKE_MAKE_PROGRAM=$env:OWLSIGHT_NINJA",
 "-DCMAKE_C_COMPILER=$env:OWLSIGHT_CPP_TOOLCHAIN/x86_64-w64-mingw32-clang.exe",
 "-DCMAKE_CXX_COMPILER=$env:OWLSIGHT_CPP_TOOLCHAIN/x86_64-w64-mingw32-clang++.exe",
 "-DCMAKE_RC_COMPILER=$env:OWLSIGHT_CPP_TOOLCHAIN/x86_64-w64-mingw32-windres.exe",
 "-DCMAKE_PREFIX_PATH=$QtRoot;$prefix",
 "-DFETCHCONTENT_SOURCE_DIR_IMATH=$env:OWLSIGHT_CPP_DEPS/Imath-3.2.2",
 "-DFETCHCONTENT_SOURCE_DIR_OPENEXR=$env:OWLSIGHT_CPP_DEPS/openexr-3.4.15",
 "-DZLIB_LIBRARY=$staticZlib","-DZLIB_LIBRARY_RELEASE=$staticZlib","-DZLIB_LIBRARY_DEBUG=$staticZlib",'-DZLIB_USE_STATIC_LIBS=ON')
$argsList=@($argsList|ForEach-Object{$_.Replace('\','/')})
& $env:OWLSIGHT_CMAKE @argsList
if($LASTEXITCODE){throw 'Native configuration failed.'}
& $env:OWLSIGHT_CMAKE --build $BuildDirectory --target OwlSight --parallel 8
if($LASTEXITCODE){throw 'Native compilation failed.'}
$builtExe=Join-Path $BuildDirectory 'OwlSight.exe'
$buildRecord=[ordered]@{version=$Release.version;build=[int]$Release.build;sha256=(Get-FileHash -LiteralPath $builtExe -Algorithm SHA256).Hash.ToLowerInvariant()}
[IO.File]::WriteAllText((Join-Path $BuildDirectory 'build-info.json'),($buildRecord|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
Write-Output $builtExe
