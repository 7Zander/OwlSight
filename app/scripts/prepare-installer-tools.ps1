# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$ToolsDirectory)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$ToolsDirectory){$ToolsDirectory=Join-Path $WorkspaceRoot 'build/installer-tools'}
$ToolsDirectory=[IO.Path]::GetFullPath($ToolsDirectory)
$compiler=Join-Path $ToolsDirectory 'inno-7.1.1/ISCC.exe'
if(Test-Path -LiteralPath $compiler){Write-Output $compiler;return}
New-Item -ItemType Directory -Force -Path $ToolsDirectory|Out-Null
$archive=Join-Path $ToolsDirectory 'innosetup-7.1.1-x64.exe'
if(!(Test-Path -LiteralPath $archive)){
 Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/jrsoftware/issrc/releases/download/is-7_1_1/innosetup-7.1.1-x64.exe' -OutFile $archive
}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne '8a5a6711c3766a6e5fb74f280ba0e3551e719ce94538d901fdbd1f8f9920b3f0'){throw 'Inno Setup compiler archive checksum differs.'}
$destination=Join-Path $ToolsDirectory 'inno-7.1.1'
if(Test-Path -LiteralPath $destination){throw 'Incomplete compiler directory is preserved; select another ToolsDirectory.'}
$arguments=@('/PORTABLE=1','/CURRENTUSER','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS','/SP-',('/DIR="'+$destination+'"'),('/LOG="'+(Join-Path $ToolsDirectory 'compiler-preparation.log')+'"'))
$process=Start-Process -FilePath $archive -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if($process.ExitCode -ne 0 -or !(Test-Path -LiteralPath $compiler)){throw 'Portable Inno Setup compiler preparation failed.'}
Write-Output $compiler
