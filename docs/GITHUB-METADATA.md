# GitHub metadata for AxiveCuisine/axive-free (for the owner to apply)

Nothing here has been applied. Set these on the repository page (the gear beside "About") or with `gh repo edit`.

## Description (about 150 characters)

> Free, open-source video downloader and download manager for Windows: 1,800+ sites up to 8K, a window or the terminal, 16 connections per file.

## Website

`https://axive.xyz/?ref=github`

## Topics (GitHub allows 20; these are 14, each true of the app)

```
video-downloader
youtube-downloader
download-manager
yt-dlp
aria2
ffmpeg
windows
windows-app
terminal-app
tui
webview2
audio-downloader
mp3
gpl3
```

Left out on purpose: `torrent`, `spotify`, `playlist-downloader`, `browser-extension` (those are in the paid Axive, not Free), `idm-alternative` and "fastest" (not something this repository can show).

## With the GitHub CLI

```powershell
gh repo edit AxiveCuisine/axive-free --description "Free, open-source video downloader and download manager for Windows: 1,800+ sites up to 8K, a window or the terminal, 16 connections per file." --homepage "https://axive.xyz/?ref=github"
gh repo edit AxiveCuisine/axive-free --add-topic video-downloader,youtube-downloader,download-manager,yt-dlp,aria2,ffmpeg,windows,windows-app,terminal-app,tui,webview2,audio-downloader,mp3,gpl3
```

## Social preview

Settings > General > Social preview: upload `docs/screens/window.png` (GitHub crops to 1280×640; the window shot is taken at that size).

## Release v1.1.0 notes (draft)

Axive Free 1.1.0

- **The window.** Axive Free now has the same graphical window as Axive, beside the terminal. Double-click the exe for the window; type it in a terminal for the terminal. Opening the other one moves Axive Free there and carries what is downloading.
- **Up to 8K.** The 1080p cap is gone: every quality the site offers.
- **Choose the audio track** of a YouTube video with dubbed or described audio. Axive Free never swaps in another one.
- **Three downloads side by side** (was two).
- **"Axive is open in another window" with nothing open** after a crash or a killed session: fixed (the lock now checks which program holds it).
- Upgrading keeps your settings, ledger and unfinished downloads.

Attach `Axive-Free.exe` and its SHA-256.
