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
New-Item -ItemType Directory -Force $StagingDirectory | Out-Null
Copy-Item -LiteralPath $exe -Destination "$StagingDirectory/OwlSight.exe"
# The official LLVM SDK plugins are marked as debug by windeployqt's PE
# heuristic despite this being the release SDK. Deploy the matching SDK
# runtime together rather than mixing binaries or rewriting DLL metadata.
Get-ChildItem -LiteralPath "$qt/bin" -Filter '*.dll' -File | ForEach-Object {
 Copy-Item -LiteralPath $_.FullName -Destination $StagingDirectory
}
foreach($name in @('platforms','imageformats','iconengines','styles','networkinformation','tls')){
 if(Test-Path -LiteralPath "$qt/plugins/$name"){
  New-Item -ItemType Directory -Force "$StagingDirectory/$name" | Out-Null
  Copy-Item -Path "$qt/plugins/$name/*" -Destination "$StagingDirectory/$name" -Recurse -Force
 }
}
New-Item -ItemType Directory -Force "$StagingDirectory/qml" | Out-Null
Copy-Item -Path "$qt/qml/*" -Destination "$StagingDirectory/qml" -Recurse -Force
foreach($name in @('libc++.dll','libunwind.dll','libwinpthread-1.dll')){Copy-Item -LiteralPath "$toolchain/x86_64-w64-mingw32/bin/$name" -Destination $StagingDirectory/$name}
$conf="[Paths]"+[Environment]::NewLine+"Prefix=."+[Environment]::NewLine+"Plugins=."+[Environment]::NewLine+"QmlImports=qml"+[Environment]::NewLine
[IO.File]::WriteAllText("$StagingDirectory/qt.conf",$conf,[Text.UTF8Encoding]::new($false))
Write-Output $StagingDirectory
