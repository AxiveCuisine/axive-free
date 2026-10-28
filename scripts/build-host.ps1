#Requires -Version 5.1
# Compiles native\AxiveHost.cs — Axive's small native companion — with the
# C# compiler that ships with every Windows (.NET Framework 4.x). No SDK, no
# NuGet, nothing downloaded.
#
#   pwsh -NoProfile -File scripts\build-host.ps1 [-Out build\host]
param(
  [string]$Out = (Join-Path (Split-Path $PSScriptRoot -Parent) 'build\host')
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'the .NET Framework 4 C# compiler (csc.exe) was not found' }

New-Item -ItemType Directory -Force $Out | Out-Null
$ico = Join-Path $root 'build\axive.ico'
if (-not (Test-Path $ico)) {
  & node (Join-Path $PSScriptRoot 'make-icon.mjs') $ico
  if ($LASTEXITCODE -ne 0) { throw 'make-icon.mjs failed' }
}

# the ghost chime, synthesized by our own script, embedded in the host
$chime = Join-Path $root 'build\chime.wav'
if (-not (Test-Path $chime)) {
  & node (Join-Path $PSScriptRoot 'make-chime.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'make-chime.mjs failed' }
}

$exe = Join-Path $Out 'axive-host.exe'
# references by full path: run from PowerShell 7, a bare name can resolve to
# the .NET (Core) copy of WinForms that ships beside pwsh.exe
$fx = Split-Path $csc
$refs = 'System.Web.Extensions.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll' | ForEach-Object { "/r:$(Join-Path $fx $_)" }
Push-Location $fx
try {
  & $csc /nologo /target:exe /platform:anycpu /optimize+ /utf8output "/lib:$fx" `
    "/out:$exe" "/win32icon:$ico" "/resource:$chime,Axive.chime.wav" @refs `
    (Join-Path $root 'native\AxiveHost.cs')
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

# smoke test: the host answers a ping
$reply = '{"id":1,"cmd":"ping"}' | & $exe | Select-Object -First 1
if ($reply -notmatch '"ok":true') { throw "axive-host did not answer: $reply" }
Write-Host ("built {0} ({1:N0} KB)" -f $exe, ((Get-Item $exe).Length / 1KB))
