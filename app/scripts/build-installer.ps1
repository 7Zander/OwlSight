# SPDX-License-Identifier: GPL-3.0-or-later
param([Parameter(Mandatory=$true)][string]$ProgramDirectory,[Parameter(Mandatory=$true)][string]$OutputDirectory,[string]$Compiler)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
if(!$Compiler){$Compiler=Join-Path $WorkspaceRoot 'build/installer-tools/inno-7.1.1/ISCC.exe'}
if(!(Test-Path -LiteralPath $Compiler)){throw 'Prepare the project-local Inno Setup compiler with prepare-installer-tools.ps1.'}
$ProgramDirectory=[IO.Path]::GetFullPath($ProgramDirectory)
$OutputDirectory=[IO.Path]::GetFullPath($OutputDirectory)
$setup=Join-Path $OutputDirectory "OwlSight-$($Release.version)-Setup-x64.exe"
if(Test-Path -LiteralPath $setup){throw 'Setup output already exists; earlier deliveries are preserved.'}
$arguments=@('/Qp',"/DAppVersion=$($Release.version)","/DBuildNumber=$($Release.build)","/DProgramDirectory=$ProgramDirectory","/DOutputDirectory=$OutputDirectory","/DIconFile=$SourceRoot/resources/owlsight.ico","$SourceRoot/installer/OwlSight.iss")
& $Compiler @arguments
if($LASTEXITCODE){throw 'Setup compilation failed.'}
Write-Output $setup
