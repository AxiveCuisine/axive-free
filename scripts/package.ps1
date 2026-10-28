#Requires -Version 5.1
# Builds release\Axive.exe — one self-contained file. Inside it (Node SEA assets):
# yt-dlp (folder build, checked against the SHA2-256SUMS published with the
# release), ffmpeg + ffprobe, a node runtime for yt-dlp's YouTube solver, aria2,
# the native host and the icon. On first launch Axive Free unpacks them into its data
# folder and verifies them by hash on every launch after.
#
#   npm run build ; pwsh -NoProfile -File scripts\package.ps1 [-FfmpegDir <folder with ffmpeg.exe + dlls>]
param(
  [string]$FfmpegDir,
  [string]$YtdlpVersion = 'latest'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$build = Join-Path $root 'build'
$pay = Join-Path $build 'payload'
$rel = Join-Path $root 'release'
$tar = "$env:SystemRoot\System32\tar.exe"
Remove-Item -Recurse -Force $pay -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $pay, $rel | Out-Null
$bundle = Join-Path $root 'dist\axive.cjs'
if (-not (Test-Path $bundle)) { throw 'dist\axive.cjs is missing - run npm run build first' }
$version = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
function Sha([string]$f) { (Get-FileHash -Algorithm SHA256 $f).Hash.ToLowerInvariant() }

# 1. yt-dlp: the release zip, verified against its published checksums
$base = 'https://github.com/yt-dlp/yt-dlp/releases'
if ($YtdlpVersion -eq 'latest') {
  $YtdlpVersion = (Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest').tag_name
}
$ytZip = Join-Path $pay 'yt-dlp.zip'
Invoke-WebRequest -UseBasicParsing -Uri "$base/download/$YtdlpVersion/yt-dlp_win.zip" -OutFile $ytZip
$sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/download/$YtdlpVersion/SHA2-256SUMS").Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$want = ($sums -split "`n" | Where-Object { $_ -match '\syt-dlp_win\.zip\s*$' } | Select-Object -First 1) -split '\s+' | Select-Object -First 1
if ((Sha $ytZip) -ne $want.ToLowerInvariant()) { throw "yt-dlp_win.zip does not match SHA2-256SUMS" }
Write-Host "yt-dlp $YtdlpVersion verified"
$probe = Join-Path $build 'yt-probe'; Remove-Item -Recurse -Force $probe -ErrorAction SilentlyContinue; New-Item -ItemType Directory $probe | Out-Null
& $tar -xf $ytZip -C $probe
$ytExe = Get-ChildItem $probe -Recurse -Filter yt-dlp.exe | Select-Object -First 1
$ytCheck = 'yt-dlp/' + $ytExe.FullName.Substring($probe.Length + 1).Replace('\', '/')
$ytSha = Sha $ytExe.FullName
Remove-Item -Recurse -Force $probe

# 2. ffmpeg + ffprobe (+ their dlls)
$fetchedFfmpeg = -not $FfmpegDir
if ($fetchedFfmpeg) { $FfmpegDir = Join-Path $build 'ffmpeg-src'; & (Join-Path $PSScriptRoot 'fetch-bin.ps1') -Dest $FfmpegDir }
$ffZip = Join-Path $pay 'ffmpeg.zip'
$ffFiles = Get-ChildItem $FfmpegDir -File | Where-Object { $_.Name -match '^(ffmpeg|ffprobe)\.exe$|\.dll$' -and $_.Name -notmatch '^(python|lib(crypto|ssl|ffi)|vcruntime|sqlite)' }
# which build this is, and where its source lives (FFmpeg is GPL: see THIRD-PARTY-NOTICES.txt)
$ffInfo = Join-Path $pay 'ffinfo'; New-Item -ItemType Directory -Force $ffInfo | Out-Null
$ffVersion = (& (Join-Path $FfmpegDir 'ffmpeg.exe') -hide_banner -version | Select-Object -First 1)
[IO.File]::WriteAllText((Join-Path $ffInfo 'BUILD.txt'), "$ffVersion`r`nLicence: GNU GPL v3 (https://www.gnu.org/licenses/gpl-3.0.html)`r`nBuilt by https://github.com/yt-dlp/FFmpeg-Builds - complete source: https://github.com/yt-dlp/FFmpeg-Builds/releases and https://ffmpeg.org/download.html`r`n", (New-Object Text.UTF8Encoding $false))
& $tar -a -cf $ffZip -C $FfmpegDir @($ffFiles.Name) -C $ffInfo BUILD.txt
if ($LASTEXITCODE -ne 0) { throw 'tar (ffmpeg) failed' }
$ffSha = Sha (Join-Path $FfmpegDir 'ffmpeg.exe')
# fetched fresh on every build (fetch-bin.ps1 keeps no cache): 200+ MB that is never read again once zipped
if ($fetchedFfmpeg) { Remove-Item -Recurse -Force $FfmpegDir }

# 3. node for yt-dlp's solver
$node = (Get-Command node).Source
$nodeZip = Join-Path $pay 'node.zip'
Push-Location (Split-Path $node); try { & $tar -a -cf $nodeZip node.exe } finally { Pop-Location }
$nodeSha = Sha $node

# 3b. aria2: the download manager's engine (segmented HTTP/FTP, BitTorrent, magnets). aria2 publishes no
# checksum file, so the release zip is pinned here (the same hash as Scoop's independent manifest).
$aria2Url = 'https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip'
$aria2Pin = '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288'
$aria2Src = Join-Path $build 'aria2-src.zip'
if (-not (Test-Path $aria2Src) -or (Sha $aria2Src) -ne $aria2Pin) { Invoke-WebRequest -UseBasicParsing -Uri $aria2Url -OutFile $aria2Src }
if ((Sha $aria2Src) -ne $aria2Pin) { throw 'aria2 release zip does not match its pinned SHA-256' }
$aria2Probe = Join-Path $build 'aria2-probe'; Remove-Item -Recurse -Force $aria2Probe -ErrorAction SilentlyContinue; New-Item -ItemType Directory $aria2Probe | Out-Null
& $tar -xf $aria2Src -C $aria2Probe
$aria2Dir = (Get-ChildItem $aria2Probe -Directory | Select-Object -First 1).FullName
# aria2 is GPL v2+: its licence and where its source lives travel with it (see THIRD-PARTY-NOTICES.txt)
[IO.File]::WriteAllText((Join-Path $aria2Dir 'SOURCE.txt'), "aria2 1.37.0 - GNU GPL v2 or later (COPYING), with the OpenSSL exception (LICENSE.OpenSSL).`r`nComplete source: https://github.com/aria2/aria2/releases/tag/release-1.37.0`r`n", (New-Object Text.UTF8Encoding $false))
$aria2Zip = Join-Path $pay 'aria2.zip'
& $tar -a -cf $aria2Zip -C $aria2Dir aria2c.exe COPYING LICENSE.OpenSSL AUTHORS SOURCE.txt
if ($LASTEXITCODE -ne 0) { throw 'tar (aria2) failed' }
$aria2Sha = Sha (Join-Path $aria2Dir 'aria2c.exe')
Remove-Item -Recurse -Force $aria2Probe

# 4. host + icon
& (Join-Path $PSScriptRoot 'build-host.ps1') -Out (Join-Path $build 'host')
Copy-Item (Join-Path $build 'host\axive-host.exe') (Join-Path $pay 'axive-host.exe')
Copy-Item (Join-Path $build 'axive.ico') (Join-Path $pay 'axive.ico')
$hostSha = Sha (Join-Path $pay 'axive-host.exe')
$items = @(
  @{name='yt-dlp'; asset='yt-dlp.zip'; kind='zip'; dest='yt-dlp'; check=$ytCheck; sha256=$ytSha; size=(Get-Item $ytZip).Length},
  @{name='ffmpeg'; asset='ffmpeg.zip'; kind='zip'; dest='ffmpeg'; check='ffmpeg/ffmpeg.exe'; sha256=$ffSha; size=(Get-Item $ffZip).Length},
  @{name='node'; asset='node.zip'; kind='zip'; dest='node'; check='node/node.exe'; sha256=$nodeSha; size=(Get-Item $nodeZip).Length},
  @{name='aria2'; asset='aria2.zip'; kind='zip'; dest='aria2'; check='aria2/aria2c.exe'; sha256=$aria2Sha; size=(Get-Item $aria2Zip).Length},
  @{name='host'; asset='axive-host.exe'; kind='raw'; dest='host/axive-host.exe'; check='host/axive-host.exe'; sha256=$hostSha; size=(Get-Item (Join-Path $pay 'axive-host.exe')).Length}
)
$payloadJson = Join-Path $pay 'payload.json'
[IO.File]::WriteAllText($payloadJson, (@{version="$version+$YtdlpVersion"; items=$items} | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding $false))

# 5. the single executable: blob (from a neutral folder, so no user path is recorded), icon, inject
$neutral = Join-Path $env:PUBLIC 'axive-free-sea'; Remove-Item -Recurse -Force $neutral -ErrorAction SilentlyContinue; New-Item -ItemType Directory $neutral | Out-Null
Copy-Item $bundle (Join-Path $neutral 'axive.cjs')
$seaFiles = @('payload.json','yt-dlp.zip','ffmpeg.zip','node.zip','aria2.zip','axive-host.exe','axive.ico')
$assets = @{}; foreach ($f in $seaFiles) { Copy-Item (Join-Path $pay $f) $neutral; $assets[$f] = Join-Path $neutral $f }
$cfg = Join-Path $neutral 'sea-config.json'
[IO.File]::WriteAllText($cfg, (@{main=(Join-Path $neutral 'axive.cjs'); output=(Join-Path $neutral 'axive.blob'); disableExperimentalSEAWarning=$true; useCodeCache=$false; assets=$assets} | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
& $node --experimental-sea-config $cfg
if ($LASTEXITCODE -ne 0) { throw 'node --experimental-sea-config failed' }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;

public static class AxiveIcon {
  const uint RT_ICON = 3, RT_GROUP_ICON = 14;
  delegate bool EnumNameProc(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool EnumLangProc(IntPtr module, IntPtr type, IntPtr name, ushort lang, IntPtr param);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, EnumNameProc cb, IntPtr param);
  [DllImport("kernel32", SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, EnumLangProc cb, IntPtr param);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32", SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort lang, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);

  class Entry { public uint Type; public int Id; public string Name; public ushort Lang; }

  static List<Entry> List(string exe) {
    var found = new List<Entry>();
    IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, 0x2 | 0x20);
    if (module == IntPtr.Zero) throw new IOException("cannot open " + exe + " (" + Marshal.GetLastWin32Error() + ")");
    try {
      foreach (uint type in new[] { RT_GROUP_ICON, RT_ICON }) {
        EnumResourceNames(module, (IntPtr)type, (m, t, name, p) => {
          bool isId = ((long)name >> 16) == 0;
          int id = isId ? (int)(long)name : 0;
          string text = isId ? null : Marshal.PtrToStringUni(name);
          EnumResourceLanguages(m, t, name, (m2, t2, n2, lang, p2) => {
            found.Add(new Entry { Type = type, Id = id, Name = text, Lang = lang });
            return true;
          }, IntPtr.Zero);
          return true;
        }, IntPtr.Zero);
      }
    } finally { FreeLibrary(module); }
    return found;
  }

  static void Update(IntPtr h, Entry e, byte[] data) {
    IntPtr name = e.Name != null ? Marshal.StringToHGlobalUni(e.Name) : (IntPtr)e.Id;
    try {
      if (!UpdateResource(h, (IntPtr)e.Type, name, e.Lang, data, data == null ? 0u : (uint)data.Length))
        throw new IOException("UpdateResource failed (" + Marshal.GetLastWin32Error() + ")");
    } finally { if (e.Name != null) Marshal.FreeHGlobal(name); }
  }

  public static void Set(string exe, string ico) {
    byte[] file = File.ReadAllBytes(ico);
    int count = BitConverter.ToUInt16(file, 4);
    if (BitConverter.ToUInt16(file, 2) != 1 || count == 0) throw new InvalidDataException(ico + " is not an .ico");

    List<Entry> existing = List(exe);
    Entry first = existing.Find(e => e.Type == RT_GROUP_ICON);
    Entry group = first != null
      ? new Entry { Type = RT_GROUP_ICON, Id = first.Id, Name = first.Name, Lang = first.Lang }
      : new Entry { Type = RT_GROUP_ICON, Id = 1, Lang = 1033 };

    IntPtr h = BeginUpdateResource(exe, false);
    if (h == IntPtr.Zero) throw new IOException("BeginUpdateResource failed (" + Marshal.GetLastWin32Error() + ")");
    bool ok = false;
    try {
      foreach (Entry e in existing) Update(h, e, null);
      // GRPICONDIR: the ICONDIR header, then each 16-byte ICONDIRENTRY with its
      // 4-byte file offset swapped for a 2-byte RT_ICON id
      var dir = new MemoryStream();
      dir.Write(file, 0, 6);
      for (int i = 0; i < count; i++) {
        int at = 6 + i * 16;
        int size = BitConverter.ToInt32(file, at + 8), offset = BitConverter.ToInt32(file, at + 12);
        byte[] image = new byte[size];
        Array.Copy(file, offset, image, 0, size);
        Update(h, new Entry { Type = RT_ICON, Id = i + 1, Lang = group.Lang }, image);
        dir.Write(file, at, 12);
        dir.Write(BitConverter.GetBytes((ushort)(i + 1)), 0, 2);
      }
      Update(h, group, dir.ToArray());
      ok = true;
    } finally {
      if (!EndUpdateResource(h, !ok) && ok) throw new IOException("EndUpdateResource failed (" + Marshal.GetLastWin32Error() + ")");
    }
  }
}
'@
$exe = Join-Path $rel 'Axive-Free.exe'
Copy-Item $node $exe -Force
Set-ItemProperty $exe -Name IsReadOnly -Value $false
[AxiveIcon]::Set($exe, (Join-Path $build 'axive.ico'))
& npx --yes postject@1.0.0-alpha.6 $exe NODE_SEA_BLOB (Join-Path $neutral 'axive.blob') --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw 'postject failed' }
Remove-Item -Recurse -Force $neutral, $pay
$actual = & $exe --version
if ($actual -ne $version) { throw "Axive-Free.exe --version printed '$actual'" }
Write-Host ("built {0} ({1:N0} MB), version {2}" -f $exe, ((Get-Item $exe).Length / 1MB), $actual)

