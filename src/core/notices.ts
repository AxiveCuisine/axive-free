/**
 * The programs Axive-Free.exe carries are separate works under their own licences.
 * Shipping them means passing these notices on: `axive-free --notices` prints
 * this, and THIRD-PARTY-NOTICES.txt holds the same text.
 */
export const NOTICES = `Axive Free is free software under the GNU General Public License, version 3
(https://www.gnu.org/licenses/gpl-3.0.html). Its source: https://github.com/AxiveCuisine/axive-free

It bundles the following independent programs. Each runs as its own
process and keeps its own licence.

yt-dlp · https://github.com/yt-dlp/yt-dlp
  Released into the public domain under the Unlicense.

FFmpeg and FFprobe · https://ffmpeg.org
  The bundled build is FFmpeg licensed under the GNU General Public License,
  version 3 (https://www.gnu.org/licenses/gpl-3.0.html), built by the yt-dlp
  project: https://github.com/yt-dlp/FFmpeg-Builds
  The complete corresponding source code is available from
  https://github.com/yt-dlp/FFmpeg-Builds/releases (the release named in
  %LOCALAPPDATA%\\Axive Free\\bin\\ffmpeg\\BUILD.txt) and from https://ffmpeg.org/download.html.
  On request Axive Free will supply a copy of that source for three years from
  the date you received this build.

aria2 · https://aria2.github.io
  The download manager runs aria2 1.37.0, licensed under the GNU General Public
  License, version 2 or later (https://www.gnu.org/licenses/old-licenses/gpl-2.0.html),
  with the OpenSSL linking exception. Copyright Tatsuhiro Tsujikawa and contributors.
  Its licence travels with it in %LOCALAPPDATA%\\Axive Free\\bin\\aria2 (COPYING, LICENSE.OpenSSL).
  The complete corresponding source code is available from
  https://github.com/aria2/aria2/releases/tag/release-1.37.0. On request Axive Free will
  supply a copy of that source for three years from the date you received this build.

Node.js · https://nodejs.org
  Copyright Node.js contributors. MIT licence; see
  https://github.com/nodejs/node/blob/main/LICENSE for Node.js and the
  third-party code it includes.

Ink, React, string-width, slice-ansi
  MIT licence. Copyright their respective authors.

Microsoft WebView2 SDK · https://aka.ms/webview2
  The window of Axive Free shows its interface through WebView2 (the Edge
  engine that ships with Windows). The SDK files beside axive-window.exe
  (Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll,
  WebView2Loader.dll) are Copyright (C) Microsoft Corporation, redistributed
  under its BSD-style licence, which travels with them as WebView2-LICENSE.txt
  in %LOCALAPPDATA%\\Axive Free\\bin\\window. The WebView2 runtime itself is part
  of Windows and is not bundled.

Cormorant, Cormorant SC · https://github.com/CatharsisFonts/Cormorant
  Copyright Christian Thalmann. SIL Open Font License 1.1 (gui/fonts/Cormorant-OFL.txt).

Source Serif 4 · https://github.com/adobe-fonts/source-serif
  Copyright Adobe. SIL Open Font License 1.1 (gui/fonts/SourceSerif-LICENSE.md).

React DOM
  MIT licence. Copyright Meta Platforms, Inc. and affiliates.
`
