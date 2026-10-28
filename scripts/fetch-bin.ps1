# Fetch the binaries Axive runs — yt-dlp and ffmpeg — pinned by version and
# SHA-256. A hash mismatch stops the build; nothing unverified is unpacked.
param(
  [Parameter(Mandatory)] [string]$Dest
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$pins = @(
  @{
    # onedir build: starts in ~0.3s instead of the onefile's ~2s self-extraction
    Name   = 'yt-dlp 2026.08.19'
    Url    = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp_win.zip'
    Sha256 = '30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf'
    Take   = @('yt-dlp.exe', '_internal')
  },
  @{
    # yt-dlp's own FFmpeg builds, shared variant (one copy of the libraries)
    Name   = 'ffmpeg N-127654-g7045cc9b80'
    Url    = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/autobuild-2026-10-18-17-17/ffmpeg-N-127654-g7045cc9b80-win64-gpl-shared.zip'
    Sha256 = 'bc0a49e622f9cec9cae04d2e7add8fdad8293889dcd39bf4db60daeaf64c7a36'
    Take   = @('ffmpeg.exe', 'ffprobe.exe', '*.dll')
  }
)

$work = Join-Path ([IO.Path]::GetTempPath()) "axive-fetch-$PID"
New-Item -ItemType Directory -Force $work, $Dest | Out-Null
try {
  foreach ($pin in $pins) {
    $zip = Join-Path $work ([IO.Path]::GetFileName($pin.Url))
    Write-Host "fetching $($pin.Name)"
    Invoke-WebRequest -Uri $pin.Url -OutFile $zip -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($actual -ne $pin.Sha256) { throw "$($pin.Name): sha256 $actual does not match pinned $($pin.Sha256)" }
    Write-Host "  sha256 ok"

    $unpacked = Join-Path $work ([IO.Path]::GetFileNameWithoutExtension($zip))
    New-Item -ItemType Directory -Force $unpacked | Out-Null
    & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $unpacked
    if ($LASTEXITCODE -ne 0) { throw "could not unpack $zip" }

    foreach ($pattern in $pin.Take) {
      # top-level matches only — yt-dlp's _internal folder is copied whole, never picked apart
      $found = Get-ChildItem -Path $unpacked -Recurse -Filter $pattern | Where-Object { $_.FullName -notmatch '\\_internal\\' }
      if (-not $found) { throw "$($pin.Name): $pattern not found in archive" }
      foreach ($item in $found) { Copy-Item -Recurse -Force $item.FullName $Dest }
    }
  }
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
