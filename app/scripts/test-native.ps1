# SPDX-License-Identifier: GPL-3.0-or-later
param([string]$RunName='run-0001',[string]$ProgramDirectory,[Parameter(Mandatory=$true)][string]$FixtureFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'paths.ps1')
$testRoot=Join-Path $WorkspaceRoot "build/native/tests/$RunName"
$sequenceRoot=Join-Path $WorkspaceRoot 'build/native/tests/public-sequence'
if(!(Test-Path -LiteralPath $FixtureFile -PathType Leaf)){throw 'Provide an external EXR fixture. No sample is bundled.'}
if(Test-Path -LiteralPath $testRoot){throw 'Use a fresh test run name.'}
New-Item -ItemType Directory -Force $testRoot,$sequenceRoot | Out-Null
foreach($frame in 1001..1003){Copy-Item -LiteralPath $FixtureFile -Destination "$sequenceRoot/demo.$frame.exr"}
if(!$ProgramDirectory){$ProgramDirectory=Join-Path $WorkspaceRoot "build/native/staging-$BuildName/OwlSight"}
$env:PATH="$env:SystemRoot/System32;$env:SystemRoot"
$env:QT_PLUGIN_PATH=''
$env:QML_IMPORT_PATH=''
$env:QML2_IMPORT_PATH=''
$process=Start-Process -FilePath "$ProgramDirectory/OwlSight.exe" -ArgumentList "--smoke-dir=$testRoot","--smoke-sequence=$sequenceRoot" -WorkingDirectory $ProgramDirectory -WindowStyle Hidden -PassThru
$deadline=[DateTime]::UtcNow.AddSeconds(120)
while(!$process.WaitForExit(1000)){if([DateTime]::UtcNow -gt $deadline){$process.Kill();throw 'Smoke test timed out.'}}
Write-Output "ExitCode=$($process.ExitCode)"
if(Test-Path "$testRoot/result.json"){Get-Content "$testRoot/result.json" -Raw}
if(Test-Path "$testRoot/qml.log"){Get-Content "$testRoot/qml.log" -Tail 20}
if($process.ExitCode -ne 0){throw 'Smoke test failed. See result.json.'}
