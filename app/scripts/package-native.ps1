# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$BuildDirectory,[string]$OutputDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$BuildDirectory){$BuildDirectory=Join-Path $WorkspaceRoot 'build/native/windows-x64'}
if(!$OutputDirectory){$OutputDirectory=Join-Path $WorkspaceRoot "dist/v$($Release.version)/$BuildName"}
$BuildDirectory=[IO.Path]::GetFullPath($BuildDirectory)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$exe=Join-Path $BuildDirectory 'OwlSight.exe'
$built=Get-Content -LiteralPath "$BuildDirectory/build-info.json" -Raw|ConvertFrom-Json
$hash=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
if($built.version -ne $Release.version -or [int]$built.build -ne [int]$Release.build -or $built.sha256 -ne $hash){throw 'Build identity differs from release.json. Rebuild before packaging.'}
if(Select-String -LiteralPath "$BuildDirectory/CMakeCache.txt" -Pattern '^OWLSIGHT_ENABLE_SMOKE_DRIVER:BOOL=ON$' -Quiet){throw 'Release builds must disable the smoke driver.'}
if(Test-Path -LiteralPath $OutputDirectory){throw "Output already exists: $OutputDirectory"}
$program=Join-Path $WorkspaceRoot "build/native/staging-$BuildName/OwlSight"
& "$PSScriptRoot/stage-native.ps1" -StagingDirectory $program -BuildDirectory $BuildDirectory
New-Item -ItemType Directory -Path $OutputDirectory|Out-Null
Copy-Item -LiteralPath "$WorkspaceRoot/LICENSE" -Destination "$program/LICENSE"
Copy-Item -LiteralPath "$WorkspaceRoot/README.md" -Destination "$program/README.md"
$notice=[IO.File]::ReadAllText("$WorkspaceRoot/THIRD_PARTY_NOTICES.md").Replace('app/third_party/','third_party/')
[IO.File]::WriteAllText("$program/THIRD_PARTY_NOTICES.md",$notice,[Text.UTF8Encoding]::new($false))
foreach($name in @('licenses','qt-sbom','qt-archives.json')){Copy-Item -LiteralPath "$SourceRoot/third_party/$name" -Destination "$program/third_party/$name" -Recurse}
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Write-PackageZip([string]$File,[string]$Root,[string]$Prefix,$Files){
 $base=[IO.Path]::GetFullPath($Root).TrimEnd('\')+'\'
 $stream=[IO.File]::Open($File,[IO.FileMode]::CreateNew)
 $zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
 try{foreach($entry in $Files){
  $relative=$entry.FullName.Substring($base.Length).Replace('\','/')
  [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$entry.FullName,"$Prefix/$relative",[IO.Compression.CompressionLevel]::Optimal)|Out-Null
 }}finally{$zip.Dispose();$stream.Dispose()}
}
$runtimeFiles=Get-ChildItem -LiteralPath $program -Recurse -File|Where-Object{
 $r=$_.FullName.Substring($program.Length+1).Replace('\','/')
 if($r -match '^third_party/licenses/.+/README\.md$'){return $false}
 $r -match '^[^/]+\.dll$' -or $r -in @('OwlSight.exe','qt.conf','README.md','LICENSE','THIRD_PARTY_NOTICES.md') -or $r -match '^(qml|plugins)/' -or $r -match '^third_party/(licenses|qt-sbom)/' -or $r -eq 'third_party/qt-archives.json'
}
$sourceFiles=@(Get-Item -LiteralPath "$WorkspaceRoot/.gitattributes","$WorkspaceRoot/.gitignore","$WorkspaceRoot/LICENSE","$WorkspaceRoot/README.md","$WorkspaceRoot/THIRD_PARTY_NOTICES.md","$SourceRoot/release.json","$WorkspaceRoot/assets/preview.webp")
$scriptNames=@('build-native.ps1','build-ocio.mjs','package-native.ps1','paths.ps1','prepare-cpp-tools.ps1','prepare-qt.ps1','stage-native.ps1','deploy-qt-runtime.mjs')
$sourceFiles+=Get-ChildItem -LiteralPath "$SourceRoot/native","$SourceRoot/scripts","$SourceRoot/third_party" -Recurse -File|Where-Object{
 $r=$_.FullName.Substring($SourceRoot.Length+1).Replace('\','/')
 if($r -match '^third_party/licenses/.+/README\.md$'){return $false}
 ($r -match '^native/(cpp|desktop)/' -and ($r -match '\.(cpp|hpp|qml|frag|vert)$' -or $r -match '/CMakeLists\.txt$' -or $r -eq 'native/desktop/sdk-archives.json')) -or ($r -match '^scripts/' -and $scriptNames -contains $_.Name) -or $r -in @('third_party/nlohmann/nlohmann/json.hpp','third_party/nlohmann/LICENSE.MIT','third_party/qt-archives.json') -or $r -match '^third_party/(licenses|qt-sbom)/'
}
$windowsZip=Join-Path $OutputDirectory "OwlSight-v$($Release.version)-windows-x64.zip"
$sourceZip=Join-Path $OutputDirectory "OwlSight-v$($Release.version)-source.zip"
Write-PackageZip $windowsZip $program 'OwlSight' $runtimeFiles
Write-PackageZip $sourceZip $WorkspaceRoot "OwlSight-v$($Release.version)-source" $sourceFiles
Get-Item -LiteralPath $windowsZip,$sourceZip|Select-Object FullName,Length
