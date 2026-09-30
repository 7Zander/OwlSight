# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$SdkRoot)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$SdkRoot){$SdkRoot=Join-Path $WorkspaceRoot 'build/qt-sdk'}
$SdkRoot=[IO.Path]::GetFullPath($SdkRoot)
$repo='https://download.qt.io/online/qtsdkrepository/windows_x86/desktop/qt6_6113/qt6_6113_llvm_mingw'
$version='6.11.3-0-202609240253'
$suffix='-Windows-Windows_11_24H2-Clang-Windows-Windows_11_24H2-X86_64.7z'
New-Item -ItemType Directory -Force "$SdkRoot/downloads" | Out-Null
foreach($module in @('qtbase','qtdeclarative','qtsvg','qtshadertools')){
 $package=if($module -eq 'qtshadertools'){'qt.qt6.6113.addons.qtshadertools.win64_llvm_mingw'}else{'qt.qt6.6113.win64_llvm_mingw'}
 $name=$version+$module+$suffix
 $file=Join-Path "$SdkRoot/downloads" $name
 $url="$repo/$package/$name"
 if(!(Test-Path -LiteralPath $file)){ & curl.exe -f -L --retry 3 --connect-timeout 30 --max-time 900 $url -o $file; if($LASTEXITCODE){throw "Download failed: $module"} }
 Invoke-WebRequest ($url+'.sha1') -OutFile ($file+'.sha1')
 $expected=([IO.File]::ReadAllText($file+'.sha1')).Trim().Split(' ')[0]
 if((Get-FileHash -LiteralPath $file -Algorithm SHA1).Hash.ToLowerInvariant() -ne $expected.ToLowerInvariant()){throw "Archive checksum differs: $module"}
 $stamp=Join-Path $SdkRoot "$module.extracted"
 if(!(Test-Path -LiteralPath $stamp)){
  & tar.exe -xf $file -C $SdkRoot
  if($LASTEXITCODE){throw "Extraction failed: $module"}
  [IO.File]::WriteAllText($stamp,$expected)
 }
 Write-Output "$module ready"
}