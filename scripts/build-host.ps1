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

# --- the window: the graphical interface (WebView2) ----------------------
# axive-window.exe references the WebView2 SDK's managed assemblies; they and
# the native loader go beside it. The SDK comes from NuGet, pinned by hash.
$wv2Version = '1.0.4258.31'
$wv2Sha256 = '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9'
$vendor = Join-Path $root 'build\vendor'
$sdk = Join-Path $vendor "webview2-$wv2Version"
if (-not (Test-Path (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
  New-Item -ItemType Directory -Force $vendor | Out-Null
  $nupkg = Join-Path $vendor "webview2-$wv2Version.zip"
  Invoke-WebRequest -UseBasicParsing "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$wv2Version/microsoft.web.webview2.$wv2Version.nupkg" -OutFile $nupkg
  if ((Get-FileHash $nupkg -Algorithm SHA256).Hash.ToLower() -ne $wv2Sha256) { Remove-Item $nupkg; throw 'the WebView2 SDK did not match its pinned hash' }
  Expand-Archive $nupkg $sdk -Force
  Remove-Item $nupkg
}
foreach ($dll in 'lib\net462\Microsoft.Web.WebView2.Core.dll', 'lib\net462\Microsoft.Web.WebView2.WinForms.dll', 'runtimes\win-x64\native\WebView2Loader.dll') {
  $sig = Get-AuthenticodeSignature (Join-Path $sdk $dll)
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw "$dll is not signed by Microsoft" }
}

# the window wears the same icon as Axive Free
$icoWindow = $ico
$winOut = Join-Path (Split-Path $Out -Parent) 'window'
New-Item -ItemType Directory -Force $winOut | Out-Null
$winExe = Join-Path $winOut 'axive-window.exe'
# the mark it paints while its page loads: Cormorant SC 500 as TrueType (scripts/make-door-font.mjs)
$doorFont = Join-Path $root 'build\door-font.ttf'
if (-not (Test-Path $doorFont)) { & node (Join-Path $PSScriptRoot 'make-door-font.mjs'); if ($LASTEXITCODE -ne 0) { throw 'make-door-font.mjs failed' } }
$wvRefs = 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll' | ForEach-Object { "/r:$(Join-Path $sdk "lib\net462\$_")" }
$fxRefs = 'System.Windows.Forms.dll', 'System.Drawing.dll' | ForEach-Object { "/r:$(Join-Path $fx $_)" }
Push-Location $fx
try {
  & $csc /nologo /target:winexe /platform:x64 /optimize+ /utf8output "/lib:$fx" `
    "/out:$winExe" "/win32icon:$icoWindow" "/resource:$doorFont,cormorant-sc-500.ttf" @fxRefs @wvRefs `
    (Join-Path $root 'native\AxiveWindow.cs')
} finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { throw 'csc failed (window)' }
Copy-Item (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.Core.dll'), (Join-Path $sdk 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'), (Join-Path $sdk 'runtimes\win-x64\native\WebView2Loader.dll') $winOut -Force
Copy-Item (Join-Path $sdk 'LICENSE.txt') (Join-Path $winOut 'WebView2-LICENSE.txt') -Force
Write-Host ("built {0} ({1:N0} KB)" -f $winExe, ((Get-Item $winExe).Length / 1KB))
