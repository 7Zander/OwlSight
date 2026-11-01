# SPDX-License-Identifier: GPL-3.0-or-later
$SourceRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$parent=[IO.Path]::GetFullPath((Join-Path $SourceRoot '..'))
$WorkspaceRoot=if((Test-Path -LiteralPath (Join-Path $parent 'app/release.json')) -and (Test-Path -LiteralPath (Join-Path $parent 'LICENSE'))){$parent}else{$SourceRoot}
$Release=Get-Content -LiteralPath "$SourceRoot/release.json" -Raw | ConvertFrom-Json
if($Release.version -notmatch '^\d+\.\d+\.\d+$' -or [int]$Release.build -lt 1){throw 'Invalid release version or build number.'}
$BuildName='build-{0:D4}' -f [int]$Release.build
$ReleaseStem="$($Release.product)-v$($Release.version)-$BuildName"