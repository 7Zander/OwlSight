# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$StagingDirectory,[string]$BuildDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/windows-x64'}
if(!$StagingDirectory){$StagingDirectory=Join-Path $WorkspaceRoot "build/native/staging-$BuildName/OwlSight"}
$qt=Join-Path $WorkspaceRoot 'build/qt-sdk'
$toolchain=Join-Path $WorkspaceRoot 'build/cpp-sdk/llvm-mingw-20260922-ucrt-x86_64'
$exe=Join-Path $BuildDirectory 'OwlSight.exe'
$env:PATH="$qt/bin;$toolchain/bin;$toolchain/x86_64-w64-mingw32/bin;$env:PATH"
# Keep matching SDK binaries intact: windeployqt misidentifies these LLVM SDK
# plugins as debug. Resolve imports without rewriting DLL metadata.
& node "$PSScriptRoot/deploy-qt-runtime.mjs" --qt $qt --toolchain $toolchain --exe $exe --updater (Join-Path $BuildDirectory 'OwlSightUpdater.exe') --qml "$SourceRoot/native/desktop/qml" --destination $StagingDirectory --plan (Join-Path $BuildDirectory 'deployment-imports')
if($LASTEXITCODE -ne 0){throw 'Qt runtime deployment failed; incomplete staging is preserved for diagnosis.'}
Write-Output $StagingDirectory
