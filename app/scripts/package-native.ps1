# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$BuildDirectory,[string]$OutputDirectory,[string]$TestRun)
$ErrorActionPreference='Stop'
function Get-RelativePath{param($base,$full)$b=$base.TrimEnd('/\').Replace('\','/')+'/';$f=$full.Replace('\','/');if($f.StartsWith($b)){return $f.Substring($b.Length)};return $full}
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/windows-x64'}
if(!$OutputDirectory){$OutputDirectory=Join-Path $WorkspaceRoot "dist/v$($Release.version)/$BuildName"}
$BuildDirectory=[IO.Path]::GetFullPath($BuildDirectory)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$exe=Join-Path $BuildDirectory 'OwlSight.exe'
if(!(Test-Path -LiteralPath $exe -PathType Leaf)){throw 'Build OwlSight.exe first with build-native.ps1.'}
$built=Get-Content -LiteralPath "$BuildDirectory/build-info.json" -Raw | ConvertFrom-Json
$exeHash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if($built.version -ne $Release.version -or [int]$built.build -ne [int]$Release.build -or $built.sha256 -ne $exeHash){throw 'Build identity differs from release.json. Rebuild before packaging.'}
if(Test-Path -LiteralPath $OutputDirectory){throw "Delivery directory already exists: $OutputDirectory"}
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$staging=Join-Path $WorkspaceRoot "build/native/staging-$BuildName/OwlSight"
& "$PSScriptRoot/stage-native.ps1" -StagingDirectory $staging -BuildDirectory $BuildDirectory
$program=$staging
New-Item -ItemType Directory -Force "$program/third_party" | Out-Null
Copy-Item -LiteralPath "$WorkspaceRoot/LICENSE" -Destination "$program/LICENSE"
Copy-Item -LiteralPath "$WorkspaceRoot/README.md" -Destination "$program/README.md"
Copy-Item -LiteralPath "$WorkspaceRoot/THIRD_PARTY_NOTICES.md" -Destination "$program/THIRD_PARTY_NOTICES.md"
Copy-Item -LiteralPath "$SourceRoot/third_party/licenses" -Destination "$program/third_party/licenses" -Recurse
Copy-Item -LiteralPath "$WorkspaceRoot/build/qt-sdk/sbom" -Destination "$program/third_party/qt-sbom" -Recurse
Copy-Item -LiteralPath "$SourceRoot/native/desktop/sdk-archives.json" -Destination "$program/third_party/qt-archives.json"
if($TestRun){
 $testRoot=Join-Path $WorkspaceRoot "build/native/tests/$TestRun"
 if(Test-Path "$testRoot/result.json"){
  New-Item -ItemType Directory -Force "$OutputDirectory/validation" | Out-Null
  Copy-Item -Path "$testRoot/*" -Destination "$OutputDirectory/validation" -Recurse
 }
}
$metadata=[ordered]@{
 version=$Release.version;build=[int]$Release.build;buildName=$BuildName;packagedAt=[DateTime]::UtcNow.ToString('o')
 platform=$Release.platform;arch=$Release.arch;client='C++ + Qt Quick 6.11.3'
 Qt='6.11.3';OpenEXR='3.4.15';Imath='3.2.2';OpenColorIO='2.5.1'
 agentValidation='compiled and packaged only; no application launch, tests, performance measurement or code review'
 sha256=$exeHash
}
[IO.File]::WriteAllText("$program/version.json",($metadata|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllLines("$program/SOURCE.txt",@(
 "OwlSight v$($Release.version) ($BuildName)"
 "Corresponding source: $($ReleaseStem)-source.zip alongside this Windows ZIP."
 'License: GPL-3.0-or-later; third-party terms in THIRD_PARTY_NOTICES.md and third_party/licenses.'
),[Text.UTF8Encoding]::new($false))
Add-Type -AssemblyName System.IO.Compression.FileSystem
$windowsZip=Join-Path $OutputDirectory "$ReleaseStem-windows-x64.zip"
$sourceZip=Join-Path $OutputDirectory "$ReleaseStem-source.zip"
[IO.Compression.ZipFile]::CreateFromDirectory($program,$windowsZip,[IO.Compression.CompressionLevel]::Optimal,$true)
$stream=[IO.File]::Open($sourceZip,[IO.FileMode]::CreateNew)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
 foreach($file in Get-ChildItem -LiteralPath $SourceRoot -Recurse -File -Force){
  $relative=(Get-RelativePath $SourceRoot $file.FullName).Replace('\','/')
  if($relative -match '(^|/)(\.git|\.agents|\.codex|node_modules|build|dist|logs|__pycache__|private-fixtures)(/|$)'){continue}
  if($relative -match '^resources/(decoder|native)/' -or $relative -match '\.(pyc|log|jsonl|exe|dll|lib|obj|pdb)$'){continue}
  if($relative -match '(?i)\.exr$'){continue}
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,"$ReleaseStem-source/app/"+$relative,[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }
 foreach($name in @('LICENSE','README.md','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes')){
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $WorkspaceRoot $name),"$ReleaseStem-source/$name",[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }
} finally {$zip.Dispose();$stream.Dispose()}
$hashes=foreach($path in @($windowsZip,$sourceZip)){(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()+'  '+[IO.Path]::GetFileName($path)}
[IO.File]::WriteAllLines("$OutputDirectory/SHA256SUMS.txt",$hashes,[Text.UTF8Encoding]::new($false))
$record=[ordered]@{version=$Release.version;build=[int]$Release.build;buildName=$BuildName;directory=$program;executable="$program/OwlSight.exe";windowsZip=$windowsZip;sourceZip=$sourceZip;agentValidation=$metadata.agentValidation}
$recordText=$record|ConvertTo-Json
[IO.File]::WriteAllText("$OutputDirectory/manifest.json",$recordText,[Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Force -Path "$WorkspaceRoot/dist"|Out-Null
[IO.File]::WriteAllText("$WorkspaceRoot/dist/latest.json",$recordText,[Text.UTF8Encoding]::new($false))
$relativeProgram=(Get-RelativePath $WorkspaceRoot $program).Replace('\','/')
$relativeWin=(Get-RelativePath $WorkspaceRoot $windowsZip).Replace('\','/')
$relativeSource=(Get-RelativePath $WorkspaceRoot $sourceZip).Replace('\','/')
[IO.File]::WriteAllLines("$WorkspaceRoot/LATEST.md",@(
 "# OwlSight v$($Release.version) · $BuildName"
 ''
 "- [Windows 程序包]($relativeWin)"
 "- [对应源码包]($relativeSource)"
 "- [OwlSight.exe]($relativeProgram/OwlSight.exe)"
 ''
 '请完整解压程序包后运行。仅完成编译与打包；未运行应用、测试或审查，由用户验收。'
),[Text.UTF8Encoding]::new($false))
Get-Item -LiteralPath $windowsZip,$sourceZip | Select-Object FullName,Length
