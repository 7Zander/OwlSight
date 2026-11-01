# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$BuildDirectory,[string]$OutputDirectory,[string]$PublicSourceDirectory,[string]$InstallerCompiler)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/windows-x64'}
if(!$OutputDirectory){$OutputDirectory=Join-Path $WorkspaceRoot "dist/v$($Release.version)/$BuildName"}
if(!$PublicSourceDirectory){$PublicSourceDirectory=$WorkspaceRoot}
$BuildDirectory=[IO.Path]::GetFullPath($BuildDirectory)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$PublicSourceDirectory=[IO.Path]::GetFullPath($PublicSourceDirectory)
if(Test-Path -LiteralPath $OutputDirectory){throw 'Output already exists; choose a new output directory.'}
$built=Get-Content -LiteralPath "$BuildDirectory/build-info.json" -Raw|ConvertFrom-Json
$exe=Join-Path $BuildDirectory 'OwlSight.exe'
$updater=Join-Path $BuildDirectory 'OwlSightUpdater.exe'
$exeHash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$updaterHash=(Get-FileHash -LiteralPath $updater -Algorithm SHA256).Hash.ToLowerInvariant()
if($built.version -ne $Release.version -or [int]$built.build -ne [int]$Release.build -or $built.sha256 -ne $exeHash -or $built.updaterSHA256 -ne $updaterHash){throw 'Compiled build identity differs. Rebuild first.'}
if(Select-String -LiteralPath "$BuildDirectory/CMakeCache.txt" -Pattern '^OWLSIGHT_ENABLE_SMOKE_DRIVER:BOOL=ON$' -Quiet){throw 'Production packages must exclude the smoke driver.'}
$sourceRelease=Get-Content -LiteralPath "$PublicSourceDirectory/app/release.json" -Raw|ConvertFrom-Json
if($sourceRelease.version -ne $Release.version -or [int]$sourceRelease.build -ne [int]$Release.build){throw 'Public source version differs.'}
$sourceCommit=$null
if(Test-Path -LiteralPath "$PublicSourceDirectory/.git"){
 if(git -C $PublicSourceDirectory status --porcelain){throw 'Public source has uncommitted changes.'}
 $sourceCommit=(git -C $PublicSourceDirectory rev-parse HEAD).Trim()
 if($LASTEXITCODE){throw 'Cannot read source commit.'}
}
$staging=Join-Path $WorkspaceRoot "build/native/staging-$BuildName/OwlSight"
$program=Join-Path $WorkspaceRoot "build/native/payload-$BuildName/OwlSight"
if(Test-Path -LiteralPath $program){throw 'Payload already exists; old deliveries are preserved.'}
& "$PSScriptRoot/stage-native.ps1" -StagingDirectory $staging -BuildDirectory $BuildDirectory
New-Item -ItemType Directory -Path $program -Force|Out-Null
foreach($file in Get-ChildItem -LiteralPath $staging -Recurse -File){
 $relative=$file.FullName.Substring($staging.Length+1)
 if($relative -match '^third_party[\\/]'){continue}
 $target=Join-Path $program $relative
 New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
 Copy-Item -LiteralPath $file.FullName -Destination $target
}
$licenseRoot=Join-Path $program 'third_party/licenses'
New-Item -ItemType Directory -Force -Path $licenseRoot|Out-Null
$licenses=@('Imath-3.2.2-LICENSE.md','libdeflate-1.25-COPYING','LLVM-23-LICENSE.TXT','nlohmann-json-3.12.0-LICENSE.MIT','OpenEXR-3.4.15-LICENSE.md','OpenJPH-LICENSE','MinGW-runtime','qt','OpenColorIO-2.5.1-native','expat-2.7.2-native','minizip-ng-4.0.10-native','pystring-1.1.4-native','yaml-cpp-0.8.0-native','zlib-1.3.1-native','InnoSetup-7.1.1-LICENSE.txt')
foreach($name in $licenses){
 $source=Get-Item -LiteralPath "$SourceRoot/third_party/licenses/$name"
 if(!$source.PSIsContainer){Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $licenseRoot $name);continue}
 foreach($file in Get-ChildItem -LiteralPath $source.FullName -Recurse -File){
  if($file.Name -eq 'README.md'){continue}
  $relative=$file.FullName.Substring($source.FullName.Length+1)
  $target=Join-Path (Join-Path $licenseRoot $name) $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)|Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $target
 }
}
New-Item -ItemType Directory -Force -Path "$program/third_party/qt-sbom"|Out-Null
foreach($name in @('qtbase','qtdeclarative','qtsvg')){Copy-Item -LiteralPath "$WorkspaceRoot/build/qt-sdk/sbom/$name-$($Release.qt).spdx" -Destination "$program/third_party/qt-sbom"}
Copy-Item -LiteralPath "$SourceRoot/native/desktop/sdk-archives.json" -Destination "$program/third_party/qt-archives.json"
Copy-Item -LiteralPath "$PublicSourceDirectory/LICENSE" -Destination "$program/LICENSE"
$notice=[IO.File]::ReadAllText("$PublicSourceDirectory/THIRD_PARTY_NOTICES.md").Replace('app/third_party/','third_party/')
[IO.File]::WriteAllText("$program/THIRD_PARTY_NOTICES.md",$notice,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllLines("$program/README.md",@("# OwlSight v$($Release.version)",'','Windows EXR 图像与序列查看器。运行 OwlSight.exe；右键菜单提供色彩、缓存和更新设置。','设置与日志位于程序旁 settings/、logs/；升级和普通卸载保留用户文件。','安装时可选择 EXR 默认打开方式，在 Windows 界面确认。','更新下载与旧安装包保存在 %LocalAppData%/OwlSight/，供手动回退。',"源码：https://github.com/7Zander/OwlSight/tree/v$($Release.version)",'许可见 LICENSE 和 THIRD_PARTY_NOTICES.md。'),[Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Path $OutputDirectory|Out-Null
$sourceZip=Join-Path $OutputDirectory "OwlSight-v$($Release.version)-source.zip"
if($sourceCommit){
 git -C $PublicSourceDirectory archive --format=zip --prefix="OwlSight-v$($Release.version)-source/" --output=$sourceZip $sourceCommit
 if($LASTEXITCODE){throw 'Source archive failed.'}
}else{
 Add-Type -AssemblyName System.IO.Compression.FileSystem
 $stream=[IO.File]::Open($sourceZip,[IO.FileMode]::CreateNew)
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
 try{foreach($file in Get-ChildItem -LiteralPath $PublicSourceDirectory -Recurse -File -Force){
  $r=$file.FullName.Substring($PublicSourceDirectory.Length+1).Replace('\','/')
  if($r -match '(^|/)(\.git|\.agents|\.codex|build|dist|settings|logs|node_modules)(/|$)' -or $r -match '(?i)(^|/)(agents?\.md|PERFORMANCE_.*|CHANGELOG\.md|STRUCTURE\.md|USER_GUIDE\.md)$' -or $r -match '\.(exe|dll|obj|log|jsonl|exr|zip|7z)$'){continue}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,"OwlSight-v$($Release.version)-source/$r",[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }}finally{$zip.Dispose();$stream.Dispose()}
}
$installer=& "$PSScriptRoot/build-installer.ps1" -ProgramDirectory $program -OutputDirectory $OutputDirectory -Compiler $InstallerCompiler
$setup=Join-Path $OutputDirectory "OwlSight-$($Release.version)-Setup-x64.exe"
if(!(Test-Path -LiteralPath $setup)){throw 'Setup output was not created.'}
$assets=@(foreach($file in @($setup,$sourceZip)){[ordered]@{name=[IO.Path]::GetFileName($file);path=$file;bytes=(Get-Item -LiteralPath $file).Length;sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}})
$files=@(Get-ChildItem -LiteralPath $program -Recurse -File)
$record=[ordered]@{version=$Release.version;build=[int]$Release.build;buildName=$BuildName;directory=$program;executable="$program/OwlSight.exe";installer=$setup;sourceZip=$sourceZip;sourceCommit=$sourceCommit;exeSHA256=$exeHash;updaterSHA256=$updaterHash;assets=$assets;files=$files.Count;dlls=@($files|Where-Object Extension -eq '.dll').Count;agentValidation='compiled and packaged only; no application launch, installer run, tests or code review'}
$recordText=$record|ConvertTo-Json -Depth 8
[IO.File]::WriteAllText("$OutputDirectory/manifest.json",$recordText,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText("$WorkspaceRoot/dist/latest.json",$recordText,[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllLines("$WorkspaceRoot/LATEST.md",@("# OwlSight v$($Release.version) · $BuildName",'',"- [安装包]($setup)","- [对应源码]($sourceZip)",'','仅完成编译和打包；未运行 OwlSight、产品安装器、测试或代码审查。'),[Text.UTF8Encoding]::new($false))
$assets|ConvertTo-Json -Depth 4
