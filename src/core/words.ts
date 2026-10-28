/**
 * Simple Language: the same interface, in everyday words.
 *
 * The house's own wording stays in the code where it is written. This table
 * maps it to plain language, keyed by the original text itself, so turning
 * the mode off is the identity: the original comes back exactly. Nothing
 * here touches layout; the text primitives (ui/text.tsx) pass their strings
 * through plain() and measure the result.
 *
 * Keys are matched in this order:
 *   1. the whole string
 *   2. the string without surrounding spaces, or without a leading glyph (∴, ·, ✕…)
 *   3. patterns, where {} stands for any text (itself translated)
 *   4. " · " separated parts, each on its own
 *
 * Browser-safe: no Node imports (the GUI uses the same table).
 */

// ---------------------------------------------------------------- whole strings
const EXACT: Record<string, string> = {
  // -- the words that recur everywhere
  draw: 'download',
  'draw it': 'download it',
  'draw another': 'download another',
  'draw again': 'download again',
  vessel: 'format',
  Vessels: 'Formats',
  'with vessel': 'with format',
  ledger: 'history',
  vigils: 'channels',
  tunnels: 'downloads',
  login: 'sign in',
  leave: 'quit',
  batch: 'many links',
  seek: 'search',
  seeking: 'searching',
  'seeking…': 'searching…',
  distill: 'highlights',
  reveal: 'show file',
  inspect: 'details',
  recipes: 'presets',
  'recipes…': 'presets…',
  received: 'done',
  'received.': 'done.',
  'it rests in:': 'saved in:',
  'binding…': 'finishing…',
  'descending…': 'downloading…',
  'writing…': 'saving…',
  'opening…': 'starting…',
  descending: 'downloading',
  binding: 'finishing',
  keep: 'save',
  abyss: 'dark',
  ash: 'grey',
  held: 'waiting',
  drawing: 'downloading',
  'drawn before': 'downloaded before',
  'drawn before · skipped': 'downloaded before · skipped',
  'waiting its turn': 'waiting',
  'gathering speed': 'starting up',

  // -- home
  'paste. draw. receive.': 'paste. download. done.',
  'Offer a link': 'Paste a link',
  'draw what you offered (↵)': 'download the link you pasted (↵)',
  'a link waits in your clipboard ·': 'you copied a link ·',
  'or tab to take it': 'or press tab to paste it',
  'nothing answers to that. offer a full link, https://…': 'that is not a link. paste a full link, starting https://',
  'that is not a door the deep knows. paste a whole link': 'that is not a link. paste the whole link',
  'the vessel stays empty: a full link, if you please': 'nothing to download. paste a full link',
  'fetch: any file over up to 16 connections, torrents and magnets (ctrl+d)': 'download any file, torrent or magnet link, faster (ctrl+d)',
  'seek on YouTube and draw from the results': 'search YouTube and download from the results',
  'many links at once, from a .txt file, or pasted': 'download many links at once, pasted or from a text file',
  'everything you have drawn, searchable': 'everything you downloaded, searchable',
  'keep watch on channels, draw only what is new': 'follow channels and download only new videos',
  'settings: where, how, and what happens after': 'where files go, quality, and what happens after',
  'see every draw, pause, reorder': 'see every download, pause, reorder',
  'new here? press ? for every key and every door': 'new here? press ? to see everything Axive Free can do',

  // -- the shell
  'draw ≤1080p': 'download (up to 1080p)',
  'look at it first: pick the vessel': 'see the formats first',
  'this key no longer opens Axive. offer it again, or another': 'this licence key no longer works. enter it again, or another one',
  'reading spotify…': 'reading the Spotify link…',
  'reading…': 'reading the link…',
  'your pasted login has expired. paste a fresh export in login': 'your saved sign-in has expired. paste a new one in sign in',
  'ghost is watching the clipboard for links · click (or ctrl+alt+g) to rest it': 'watching your clipboard for links · click (or ctrl+alt+g) to stop',
  'ghost rests · click to watch the clipboard for links': 'not watching your clipboard · click to watch it for links',
  'see every draw': 'see every download',
  'the raw output of yt-dlp and ffmpeg (ctrl+l)': 'technical details from the download tools (ctrl+l)',
  'renew in settings › renewal & tools': 'update in settings › updates & tools',
  'bound: Axive is yours': 'activated. Axive is ready',
  'the whole log is on your clipboard': 'the whole log is copied',
  'leave Axive Free': 'close Axive Free',

  // -- where it rests
  'Axive Free may not write in that folder. choose another': 'Axive Free cannot save in that folder. choose another',
  'Where should this draw rest?': 'Where should this download be saved?',
  'where shall it rest?': 'where should it be saved?',
  'where shall they rest?': 'where should they be saved?',
  'rest here': 'save here',
  '↵ · draw into this folder': '↵ · save into this folder',
  'choose another…': 'choose a folder…',
  'ask each time': 'ask every time',
  'off: draws go straight to the last folder': 'off: downloads go straight to the last folder',
  'queue it now, start at night. leave Axive open': 'start later, at night. keep Axive open',

  // -- a draw
  'renew yt-dlp': 'update yt-dlp',
  'seek a mirror': 'find another copy',
  'another vessel': 'another format',
  'copy the raw error text': 'copy the technical error',
  'keep only a part (lossless, in seconds)': 'keep only part of it (quick, no quality loss)',
  'a highlight reel of the loudest moments': 'a short video of the liveliest moments',
  'every draw': 'every download',
  'that draw is gone from the tunnels.': 'that download is no longer in the list.',
  'already drawn before: the archive skipped it.': 'already downloaded before, so it was skipped.',
  'waiting for a free tunnel…': 'waiting for a free slot…',
  'paused · the partial file waits': 'paused · the unfinished file is kept',
  'stop for now; resume picks up where it stopped': 'stop for now; resume continues where it stopped',
  'stop and delete the partial file': 'stop and delete the unfinished file',
  'the draw carries on in its tunnel': 'the download keeps going',
  'every draw at once': 'all downloads',

  // -- tunnels
  "don't wait for off-peak": 'start now instead of at night',
  'cancel and delete the partial file': 'cancel and delete the unfinished file',
  'clear from the list (the file stays)': 'remove from the list (the file is kept)',
  'nothing is being drawn': 'nothing is downloading',
  'offer a link on the home screen; draws appear here, side by side.': 'paste a link on the home screen; downloads appear here.',
  'how many draws run side by side': 'how many downloads run at the same time',
  'tidy the list (files stay)': 'tidy the list (files are kept)',

  // -- the download manager
  'reading the magnet…': 'reading the magnet link…',
  'reading the magnet · looking for peers…': 'reading the magnet link · looking for sources…',
  'stop seeding; the files stay': 'stop sharing; the files are kept',
  'clear it and delete the partial file': 'remove it and delete the unfinished file',
  'fetching: it appears below': 'downloading: it appears below',
  'offer a full address (https://…) or a magnet link': 'paste a full link (https://…) or a magnet link',
  'fetching the torrent: it appears below': 'downloading the torrent: it appears below',
  'fetch any file, torrent or magnet · split across up to 16 connections': 'download any file, torrent or magnet link · up to 16 connections for speed',
  'Offer a file link or a magnet': 'Paste a file link or a magnet link',
  fetch: 'download',
  'fetch what you offered (↵)': 'download the link you pasted (↵)',
  'Where fetched files rest': 'Where downloaded files are saved',
  'waking the engine…': 'starting the downloader…',
  'nothing yet. paste a file link, a magnet, or open a .torrent.': 'nothing here yet. paste a file link or magnet link, or open a .torrent file.',
  'side by side': 'at once',
  'how many fetches run at once': 'how many downloads run at the same time',
  'parallel streams per file: more is faster on servers that allow it': 'more connections download faster, where the server allows it',
  'torrents share pieces while they download and stop sharing when complete. fetch only what you have the right to':
    'torrents share pieces with others while they download, and stop when done. only download what you are allowed to',
  'torrents share pieces while they download. fetch only what you have the right to': 'torrents share pieces with others while they download. only download what you are allowed to',
  'if Windows asks about network access for aria2c, allow private networks only': 'if Windows asks whether aria2c may use the network, allow private networks only',
  'the fetch engine is missing: run Repair in settings': 'the downloader is missing: run check & repair in settings',
  'the fetch engine would not start': 'the downloader would not start',
  'the fetch engine did not answer': 'the downloader did not respond',
  'not a link the fetcher takes': 'the download manager cannot take that link',
  'the fetch failed': 'the download failed',

  // -- choosing a vessel
  'not enough room': 'not enough space',
  'your chosen thumbnail will be embedded': 'your chosen cover image will be added to the file',
  'the words, as plain text': 'the spoken words, as a text file',
  'timed subtitles, .srt': 'subtitles, as an .srt file',
  'draw only a part: start and end': 'download only part of it',
  'forget the trim': 'undo the trim',
  'see the thumbnails; pick one to embed or save': 'see the cover images; add one to the file or save it',
  'dry run: exact formats, size and file name, without drawing': 'see the exact format, size and file name before downloading',

  // -- playlists, batches, search
  'how every chosen item is drawn': 'the format for every selected item',
  '↵ · one tunnel per item; the archive skips repeats': '↵ · each item downloads on its own; repeats are skipped',
  'feed it a list and walk away': 'add many links and download them all',
  'from a .txt file…': 'from a text file…',
  'click to remove from the batch': 'click to remove it from the list',
  'how every link is drawn (Spotify links always come as mp3)': 'the format for every link (Spotify links are always mp3)',
  'asks where once, then draws them all': 'asks where to save once, then downloads them all',
  'Seek on YouTube': 'Search YouTube',
  'the deep returned nothing for that': 'no results for that',
  'click to choose a vessel': 'click to pick a format',
  'space to check': 'space to select',
  'each ≤ 1080p mp4; asks where once': 'each as mp4 up to 1080p; asks where to save once',
  'results come from YouTube; click one to choose its vessel, check several to draw them all.': 'results come from YouTube. click one to pick its format, or select several to download them all.',

  // -- errors before a draw, the remote, recipes, mirrors, setup
  'fetch it as a file': 'download it as a file',
  remote: 'phone & browser',
  'scan with your phone (same Wi-Fi), paste a link, press offer': 'scan with your phone (same Wi-Fi), paste a link, press send',
  'links from your browser, on this PC': 'send links from your browser on this PC',
  'copy bookmarklet': 'copy browser button',
  'a browser bookmark that offers the page you are on': 'a bookmark that sends the page you are on to Axive',
  'the address carries a secret token: anyone with it can offer links (Axive still asks you first)': 'the address contains a secret key: anyone who has it can send links (Axive still asks you first)',
  'opening the remote…': 'starting…',
  'a whole setup under one name, shareable as a single line': 'save your settings under a name and share them',
  'apply & keep': 'use & save',
  'Keep the current settings as': 'Save the current settings as',
  'no recipes yet.': 'no presets yet.',
  apply: 'use',
  'paste a recipe': 'paste a preset',
  'from a share code on your clipboard': 'from a share code you copied',
  'no recipe on the clipboard. it starts with axive:recipe:': 'no preset copied. a share code starts with axive:recipe:',
  'copied: anyone can paste it into their recipes': 'copied: anyone can paste it into their presets',
  'recipes never carry programs, webhooks, tokens or folders': 'presets never include programs, webhooks, passwords or folders',
  'seeking a mirror': 'looking for another copy',
  'these might be the same video. choose one to look closer. nothing is drawn yet.': 'these might be the same video. choose one to look closer. nothing is downloaded yet.',
  'no mirror surfaced. the deep keeps some things.': 'no other copy found.',
  'the vessels are ready': 'the tools are ready',
  'preparing the vessels': 'setting up',
  'Axive Free carries its own tools; unpacking them once': 'Axive Free includes its own tools; unpacking them once',
  'something is amiss': 'something is broken',
  'every vessel is whole': 'every tool is working',

  // -- convert, trim, distill
  // the GUI's tools panel, its doors on the draw view, and the disc folder
  'turn it into another vessel: mp4, mp3, gif…': 'convert it to another format: mp4, mp3, gif…',
  'choose what it becomes; the new file rests beside the old one': 'choose the new format; the new file is saved next to the original',
  'choose a title, then what it becomes; the new file rests in your default folder': 'choose a title, then the new format; the new file is saved in your default folder',
  'each moment': 'each part',
  'Axive listens first, then cuts': 'Axive finds the liveliest parts first, then cuts',
  'trim and distill are for video and sound': 'trim and highlights are for video and audio',
  'or begin from': 'or start from',
  'work on a file you already have: convert, trim, distill (ctrl+o)': 'work on a file on your PC: convert, trim, highlights (ctrl+o)',
  'a file you have: convert, trim, distill': 'a file on your PC: convert, trim, highlights',
  'a .txt with one link per line: each one becomes a draw': 'a .txt file with one link per line: each one is downloaded',
  'A file to convert, trim or distill': 'A file to convert, trim or make highlights from',
  'restore from Axive Free itself': 'restore it from Axive Free',
  // the GUI's recipes and repair (settings)
  'copy as a line': 'copy share code',
  'the share code: anyone can paste it into their recipes': 'the share code: anyone can paste it into their presets',
  'its settings become yours now': 'use its settings now',
  'it replaces the recipe kept under the same name': 'it replaces the preset saved under the same name',
  'give the recipe a name': 'give the preset a name',
  'that recipe is no longer kept': 'that preset no longer exists',
  'let the running draws finish (or pause them) before repairing the tools': 'let the running downloads finish (or pause them) before repairing the tools',
  'checking every tool…': 'checking every tool…',
  // the window's first moment (the surfacing)
  'rising from the deep': 'starting Axive Free',
  'the core is slow to answer · it is still coming': 'Axive is taking a while to start · still starting',
  Into: 'Convert to',
  'ffmpeg cannot convert that kind of file': 'Axive cannot convert that kind of file',
  'only this part will be drawn': 'only this part will be downloaded',
  'exact cut (re-encodes, slower)': 'exact cut (slower, re-saves the video)',
  'lossless (instant, starts at the nearest keyframe)': 'quick (no quality loss, may start a second early)',
  'lossless copies the streams untouched: seconds even for 4K. exact lands on the very frame.': 'quick keeps the original quality and takes seconds. exact cuts on the very frame but takes longer.',
  'a highlight reel (new file)': 'a highlights video (new file)',
  'chapter marks at the peaks (a copy)': 'chapter marks at the best moments (a copy)',
  'reel length': 'video length',
  'exact cuts (re-encodes)': 'exact cuts (slower)',
  'lossless cuts (fast, keyframe-snapped)': 'quick cuts (no quality loss)',

  // -- the ledger
  'nothing drawn yet': 'nothing downloaded yet',
  Find: 'Search',
  'that file is no longer where it was left': 'that file has been moved or deleted',
  'draws you finish are written here.': 'your finished downloads are listed here.',
  forget: 'remove',
  'remove from the ledger (the file stays)': 'remove from history (the file is kept)',
  'really forget all?': 'really clear all history?',
  'forget all': 'clear history',

  // -- vigils
  'keep watch over a channel; draw only what is new since you last looked': 'follow a channel and download only what is new since you last checked',
  'Keep vigil over': 'Follow',
  watch: 'follow',
  'now on (only new uploads)': 'from now on (new uploads only)',
  'click to look for new uploads': 'click to check for new uploads',
  'never looked': 'never checked',
  'no vigils yet.': 'no channels yet.',
  'keep all now': 'check all now',
  'look at every vigil for new uploads': 'check every channel for new uploads',
  'look at this one': 'check this one',
  'stop watching': 'unfollow',
  'forget this vigil (drawn files stay)': 'stop following (downloaded files are kept)',
  'keep vigils when Axive opens': 'check channels when Axive opens',
  'daily at 09:00 (Task Scheduler)': 'check daily at 09:00',
  'Windows runs Axive quietly each morning to keep your vigils; off by default': 'Windows runs Axive in the background each morning to check your channels; off by default',
  'Where should this vigil keep what it draws?': 'Where should new videos from this channel be saved?',
  'looking at it…': 'checking it…',
  'keeping every vigil…': 'checking every channel…',
  'nothing new since the last look': 'nothing new since the last check',
  'Task Scheduler will keep your vigils every morning at 09:00': 'Windows will check your channels every morning at 09:00',
  'the daily vigil is removed from Task Scheduler': 'the daily check is turned off',
  'That is a single video. A vigil needs a channel, playlist or profile.': 'That is a single video. Follow a channel, playlist or profile instead.',

  // -- login
  'for what asks you to sign in: age-gated videos, members-only, private posts': 'for videos that need an account: age-restricted, members-only, private posts',
  'no login': 'not signed in',
  "borrow your browser's login": "use your browser's sign-in",
  'pick the browser you are signed in with. yt-dlp asks it each time; Axive keeps nothing.': 'pick the browser you are signed in with. Axive asks it each time and keeps nothing.',
  'no browsers found that yt-dlp can read.': 'no supported browsers found.',
  'asking the browser…': 'checking the browser…',
  'read a Netscape cookies.txt export from your clipboard': 'paste a cookies.txt export you copied',
  "read the browser's login once and count it": "check that Axive can read your browser's sign-in",
  'forget login': 'sign out',
  'Axive no longer uses any login': 'Axive no longer uses any sign-in',
  'the login reads fine': 'the sign-in works',
  'those cookies have all expired. sign in again in the browser, then export afresh': 'those cookies have expired. sign in again in the browser, then export again',

  // -- thumbnails, inspect
  thumbnails: 'cover images',
  'developing…': 'loading…',
  'embed this one': 'add this one to the file',
  'the draw carries this image as its cover': 'the download gets this image as its cover',
  'draw just the picture, as a jpg': 'download just the picture, as a jpg',
  'nothing is drawn: this is what would happen': 'nothing is downloaded: this is what would happen',
  'the draw': 'the download',
  'asking yt-dlp…': 'checking…',
  'these choices are made offline from the probe, no request is sent': 'worked out from what Axive already read; nothing is sent',

  // -- the licence
  'this copy is not yet bound to anyone': 'this copy is not activated yet',
  'Offer your key': 'Enter your licence key',
  bind: 'activate',
  'bind this key to this PC (↵)': 'activate this key on this PC (↵)',
  'asking the house…': 'checking with axive.xyz…',
  'the key was shown on the page after you paid': 'your key was shown on the page after you paid',
  'obtain a key · $7.99': 'buy a key · $7.99',
  'opens axive.xyz in your browser: once, for life, crypto welcome': 'opens axive.xyz in your browser: one payment, for life',
  'your licence needs to see the house again. reconnect, or offer the key once more': 'your licence needs to be checked online. connect to the internet, or enter the key again',
  'the house does not know that key. check it against your receipt': 'that key was not found. check it and try again',
  'that key already opens three PCs. free one (axive licence release on it), or write to support': 'that key is already used on three PCs. free one first, or contact support',
  'that key has been withdrawn. write to support if this is a mistake': 'that key was cancelled. contact support if this is a mistake',
  'that key has lapsed': 'that key has expired',
  'the house cannot be reached. check the connection and try again': 'axive.xyz could not be reached. check your internet and try again',
  'your licence is renewed by the house every few days, and it could not be reached. connect to the internet and Axive opens again': 'your licence is checked with axive.xyz every few days, and it could not be reached. connect to the internet and Axive opens again',
  'the house is busy for a moment. try again shortly': 'the server is busy. try again in a moment',
  'that does not look like a licence key. copy it whole from your receipt': 'that is not a licence key. copy the whole key',
  'that key does not open Axive': 'that key does not work for Axive',

  // -- settings
  'ghost chime': 'sound when a link is copied',
  'a soft chime when ghost finds a link you copied': 'a soft sound when Axive notices a link you copied',
  'hush the chime after': 'pause the sound after',
  'within seconds': 'within this many seconds',
  'manners are the last thing a person loses. set yours': 'choose how Axive works',
  'embed & sponsorblock': 'file extras',
  'after drawing': 'when finished',
  'ghost & remote': 'clipboard & phone',
  'renewal & tools': 'updates & tools',
  terminal: 'appearance',
  'ask where each draw rests': 'ask where to save each download',
  'ask for a folder before drawing; playlists and batches ask once': 'ask for a folder before downloading; playlists and lists ask once',
  'where draws rest when Axive does not ask': 'where downloads are saved when Axive does not ask',
  'how many draws run side by side (1-4)': 'how many downloads run at the same time (1-4)',
  'per draw, like 2M or 500K; empty for none': 'per download, like 2M or 500K; empty for none',
  'how often a draw that hit a network glitch is retried, with growing pauses': 'how many times to retry after a network problem',
  'keep seeding torrents': 'keep sharing torrents',
  'public trackers for magnets': 'public trackers for magnet links',
  'a magnet also asks well-known public trackers for peers, so it starts sooner. never one that names a private tracker':
    'magnet links also ask well-known public trackers for sources, so they start sooner. never for a private tracker',
  'off-peak': 'night start',
  'when "hold until off-peak" draws start, HH:MM': 'when downloads set to start at night begin, HH:MM',
  'skip what was drawn before': 'skip what was downloaded before',
  'keep an archive of every video id and never draw one twice': 'remember every video and never download one twice',
  'say so when a link was drawn before, and where it went': 'say so when a link was downloaded before, and where it went',
  metadata: 'title & artist',
  thumbnail: 'cover image',
  'yt-dlp language list, like en.*,en or de,fr': 'language codes, like en or de,fr',
  'sponsorblock · YouTube only': 'skip sponsors · YouTube only',
  segments: 'sponsor parts',
  'YouTube only: cut sponsored segments out, or mark them as chapters': 'YouTube only: cut out sponsored parts, or mark them as chapters',
  'save this whole setup under a name; share it as one line': 'save these settings under a name and share them',
  'a notification when a draw finishes and Axive is not in front': 'a notification when a download finishes and Axive is not in front',
  'a soft chime when a draw finishes': 'a soft chime when a download finishes',
  'run after drawing': 'run when finished',
  'a program or script, given the finished file as its only argument': 'a program to open with each finished file',
  'Discord (or any JSON) webhook url pinged when a draw finishes': 'a Discord (or other) webhook address told when a download finishes',
  'toast, sound, webhook and telegram, all at once': 'try every notification at once',
  'if you can read this, the pings work': 'if you can read this, notifications work',
  'ghost · watch the clipboard for links': 'watch the clipboard for links',
  // 2.3.1: ghost and the extension in the menu, delete with the file
  // 2.4: "clipboard watcher" where there is room (the window's switch, settings); the terminal's header keeps it short
  ghost: 'clipboard watcher',
  '◉ ghost': '◉ clipboard',
  '◌ ghost': '◌ clipboard',
  '● ghost': '● clipboard',
  'o ghost': 'o clipboard',
  // 2.4: the phone chooses a folder and takes files; deletes ask everywhere
  "Axive's helper would not watch the clipboard. Repair the tools in settings › renewal and tools, then try again": "Axive's helper would not watch the clipboard. Repair the tools in settings › updates and tools, then try again",
  'from the phone: draw a link into any folder of this PC (Windows and program folders stay closed), take what Axive received, and delete it here once the phone has it.':
    'from the phone: download a link into any folder of this PC (Windows and program folders stay closed), save what Axive downloaded to the phone, and delete it here once the phone has it.',
  'renewal and tools': 'updates and tools',
  'ghost ■': 'clipboard ■',
  'ghost ·': 'clipboard ·',
  'ghost · watch the clipboard': 'watch the clipboard',
  'ghost: a link you copy is offered at once. its settings': 'clipboard watch: a link you copy is offered at once. its settings',
  'ghost watches the clipboard: a link you copy is offered at once. press to stop': 'watching the clipboard: a link you copy is offered at once. press to stop',
  'add Axive to your browser: draw with one press on any video': 'add Axive to your browser: download any video with one press',
  'the Axive extension: draw with one press on any video': 'the Axive extension: download any video with one press',
  'from the ledger, and if you choose, the file from the drive': 'from the history, and if you choose, the file from the drive',
  'remove from the ledger': 'remove from the history',
  'removed from the ledger': 'removed from the history',
  'the ledger': 'the history',
  'it leaves the ledger': 'it leaves the history',
  'they leave the ledger': 'they leave the history',
  'ghost · watch the clipboard for links (needs the native host)': "watch the clipboard for links (needs Axive's helper)",
  'when you copy a video link anywhere, Axive offers to draw it. it never draws on its own': 'when you copy a video link anywhere, Axive offers to download it. it never downloads on its own',
  'ghost only reads links. anything else you copy is dropped at once, never stored, logged or sent.': 'only links are read. anything else you copy is ignored, never saved or sent.',
  'what password managers mark as private is never even read.': 'passwords copied from password managers are never read.',
  'corner notice': 'pop-up in the corner',
  'a small card in the corner of the screen when a link surfaces: draw, choose or dismiss. It never takes focus':
    'a small card in the screen corner when you copy a link: download, choose or dismiss. it never interrupts typing',
  'ctrl+alt+g pauses / wakes it': 'ctrl+alt+g turns it on or off',
  'a hotkey that works from any window': 'a shortcut that works in any window',
  'rise with Windows': 'start with Windows',
  'start Axive minimized with ghost on when you sign in. off unless you turn it on': 'start Axive minimized, watching the clipboard, when you sign in to Windows',
  'remote · accept links from your browser': 'accept links from your browser',
  "a local address only Axive's token opens; links are offered, never drawn on their own": 'a private address on this PC; links are offered, never downloaded on their own',
  'show QR & bookmarklet': 'show QR code & browser button',
  'new token': 'new secret key',
  'invalidate every old remote link': 'old links and QR codes stop working',
  'a new token: old links and QR codes stop working': 'new secret key made: old links and QR codes stop working',
  'sites change often; yt-dlp keeps up. checked against its published checksum': 'sites change often; updating yt-dlp keeps downloads working',
  'look for renewal': 'check for updates',
  'verify & repair': 'check & repair',
  'check every tool against its recorded hash; restore anything damaged': "check Axive's tools and fix anything damaged",
  'renewing yt-dlp…': 'updating yt-dlp…',
  'looking for renewal…': 'checking for updates…',
  'let the running draws finish (or pause them) before renewing yt-dlp': 'let downloads finish (or pause them) before updating yt-dlp',
  'yt-dlp is current': 'yt-dlp is up to date',
  'Axive is current': 'Axive is up to date',
  'check for renewal': 'check for updates',
  'reports for the developer, scrubbed of your name and secrets': 'reports for the developer, without your name or passwords',
  'cinematic vignette': 'darker corners',
  'Windows Terminal shader: darkened corners, a little bloom on the red': 'darkened corners and a soft glow',
  'the shimmer, the whispers, the sigil': 'the moving letters and effects',
  'grand sigil': 'large title line',
  'draw the turning line under the crest at double height (Windows Terminal)': 'show the moving line under the logo at double size',
  'hover hints': 'tips on hover',
  'describe a button when the mouse rests on it': 'explain a button when the mouse rests on it',
  'abyss (bone on black water), ash (grey), auto (your terminal colours)': "dark (default), grey, or your terminal's own colours",
  'they open straight into Windows Terminal, without a console flash': 'they open Axive straight away',
  'asking yt-dlp to renew itself': 'asking yt-dlp to update itself',
  'looking for the newest yt-dlp': 'checking for the newest yt-dlp',
  'trying it': 'testing it',
  'simple language': 'simple language',
  "everyday words instead of the house's own: draw, vessel, ledger…": 'everyday words everywhere in Axive. turn off for the original wording',

  // -- cookies, errors from the tools
  'the clipboard is empty: copy the export first': 'nothing is copied: copy the export first',

  // -- the guide (the ? sheet)
  keys: 'help',
  'every key, and every door (?)': 'everything Axive can do, and where to find it (?)',
  '? keys': '? help',
  'every key, and every door': 'everything Axive can do, and where to find it',
  here: 'on this screen',
  everywhere: 'anywhere',
  'every door': 'every feature',
  'go back, or close a sheet': 'go back',
  'this sheet': 'this help',
  'the logs drawer': 'technical log',
  'ghost on / off': 'clipboard watch on / off',
  'paste into the field': 'paste',
  'drag across text': 'select text',
  'copy it': 'copy it',
  'draw a link: video, music, playlists, 1,800+ sites': 'download a link: video, music, playlists, 1,800+ sites',
  'any file, torrent or magnet, up to 16 connections': 'any file, torrent or magnet link, faster',
  'every draw in flight: pause, reorder, retry': 'every download in progress: pause, reorder, retry',
  'everything drawn, searchable, with its file': 'everything you downloaded, searchable',
  'watch channels; draw only what is new': 'follow channels and download only new videos',
  'age-gated, members-only and private videos': 'videos that need you to be signed in',
  'many links, pasted or from a .txt file': 'many links at once, pasted or from a text file',
  'turn a file into another format': 'change a file into another format',
  'send links from your phone or browser': 'send links from your phone or browser',
  'every setting: folders, quality, what happens after': 'every setting: folders, quality, what happens after',
  'a whole setup under one name': 'save settings under a name',
  'watch the clipboard; offer links you copy anywhere': 'watch the clipboard and offer links you copy anywhere',
  'after you offer a video: trim, thumbnail, inspect, chapters': 'after pasting a video link: trim, cover image, details, chapters',
  'Spotify links come as tagged mp3s': 'Spotify links download as mp3s with their details',
  'also from PowerShell: axive --help': 'also from PowerShell: axive --help',
  'a draw': 'a download',
  'draw what you offered': 'download the link you pasted',
  'take the link waiting in your clipboard': 'paste the link you copied',
  'links you offered before': 'links you pasted before',
  'choose a vessel': 'choose a format',
  'check or uncheck': 'select or unselect',
  'check a result': 'select a result',
  'choose its vessel': 'choose its format',
  'fetch what you offered': 'download the link you pasted',
  'draw another, once it is done': 'download another, once it is done',
  'words': 'wording',
  "the house's own": 'original',
  everyday: 'simple',

  // -- the window (GUI)
  'the window': 'the window',
  'the same Axive in a graphical window; this terminal hands over and closes': 'the same Axive in a normal window; this terminal closes',
  'offered before': 'pasted before',
  'offer a link: video, music, playlists, Spotify, files, torrents, or words to search': 'paste a link: video, music, playlists, Spotify, files, torrents, or words to search',
  'every draw and every file in flight: pause, reorder, retry': 'every download in progress: pause, reorder, retry',
  'rests in': 'saving to',
  'the offer box, from anywhere': 'the link box, from anywhere',
  'outside a box: offer what you copied': 'outside a box: paste what you copied',
  'choose a vessel and draw it': 'choose a format and download it',
  'in the shell': 'in PowerShell',
  'a file link, or a magnet: fetched over up to 16 connections': 'a file link, or a magnet link: downloaded over up to 16 connections',
  'click to check · double-click to choose its vessel': 'click to select · double-click to pick its format',
  'convert after drawing': 'convert when finished',
  'ghost (watch clipboard)': 'watch the clipboard',
  'offer links you copy; never draws without asking': 'offers links you copy; never downloads without asking',
  'ghost notice': 'pop-up in the corner',
  'ghost hotkey ctrl+alt+g': 'shortcut ctrl+alt+g',
  'pause or wake ghost from anywhere': 'turn clipboard watch on or off from any window',
  'words & motion': 'wording & motion',
  'binds to your Wi-Fi and shows the address to open on your phone': 'connects over your Wi-Fi and shows the address to open on your phone',

  // -- tips that turn with the whispers
  'Paste a Spotify album: every track arrives as a tagged mp3.': 'Paste a Spotify album: every track downloads as an mp3 with its details.',
  'Paste a dozen links at once. They become a batch.': 'Paste many links at once to download them together.',
  'A magnet or a file link goes straight to the download manager.': 'Magnet and file links go to the download manager.',
  'esc returns you, from anywhere. ? shows every key.': 'esc goes back from anywhere. ? shows every shortcut.',
  'Right-click pastes. Dragging across the screen copies.': 'Right-click pastes. Dragging across the screen copies.',
  'Offer a channel and choose what to keep: the newest five, or all.': 'Paste a channel to choose which videos to download.',
  'Let ghost watch the clipboard: links you copy anywhere are offered here.': 'Turn on clipboard watch and Axive offers links you copy anywhere.',
  'Trim before you draw: only the part you keep descends.': 'Trim before downloading: only the part you keep is downloaded.',
  'The ledger remembers every draw, and where it rests.': 'History lists everything you downloaded, and where it is.',
  'Simple language waits in the settings, should the house’s words get in the way.': 'Simple language in settings can be switched off again at any time.',

  // -- the download manager, 1.4 (core)
  'waiting for its tunnel to open': 'waiting for its queue to open',
  'twenty tunnels is the most Axive keeps': 'Axive keeps at most twenty queues',
  'that tunnel needs a name (up to 40 letters)': 'that queue needs a name (up to 40 letters)',
  'no such tunnel': 'no such queue',
  'the main tunnel always stays': 'the main queue always stays',
  'named queues: how many run at once, a speed limit, days and hours, and what happens when one empties': 'named queues: how many run at once, a speed limit, days and hours, and what happens when one is finished',
  'a link sent from your phone starts drawing at once (off: Axive asks on the PC first)': 'a link sent from your phone starts downloading at once (off: Axive asks on the PC first)',
  'phone may draw': 'phone may download',
  // view subtitles under the 1.4 masthead
  'the deep is asked what it holds': 'looking up what the link holds',
  'choose what to draw from it': 'choose what to download from it',
  'on YouTube, then draw from the results': 'on YouTube, then download from the results',
  'it carries on in its tunnel if you leave': 'it keeps going in its queue if you leave',
  'turn a file you already have into another vessel': 'turn a file you already have into another format',
  'every stream a vessel holds': 'every stream a format holds',
  'every candidate is shown; none is drawn unbidden': 'every option is shown; nothing downloads unless you ask',
  'named lines, each with its own pace, limit and hours': 'named queues, each with its own speed, limit and hours',
}

// ---------------------------------------------------------------- patterns ({} = any text)
const PATTERNS: Array<[string, string]> = [
  // the shell
  ['a {} link surfaced on your clipboard. draw it?', 'you copied a {} link. download it?'],
  ['a {} link was offered remotely. draw it?', 'a {} link came from your phone or browser. download it?'],
  ['{} draw is still descending: leave again to go (they come back paused)', '{} download is still running. quit again to close (it resumes paused next time)'],
  ['{} draws are still descending: leave again to go (they come back paused)', '{} downloads are still running. quit again to close (they resume paused next time)'],
  ['{} unfinished draw came back paused. resume them in tunnels', '{} unfinished download is back, paused. resume it in downloads'],
  ['{} unfinished draws came back paused. resume them in tunnels', '{} unfinished downloads are back, paused. resume them in downloads'],
  ['yt-dlp {} is out (you have {})', 'yt-dlp {} is available (you have {})'],
  ['yt-dlp {} is out', 'yt-dlp {} is available'],
  ['Axive {} is out', 'Axive {} is available'],
  ['your vigils found {} new, drawing them', 'your channels have {} new videos, downloading them'],
  ['{} ghost', '{} clipboard'],
  ['{} descending · {} in all', '{} downloading · {} in total'],
  ['{} descending', '{} downloading'],
  ['{} fetching', '{} downloading'],
  ['{} file handed to fetch', '{} file added to the download manager'],
  ['{} files handed to fetch', '{} files added to the download manager'],
  // where it rests
  ['Where should these {} draws rest?', 'Where should these {} downloads be saved?'],
  ['{} draws · {}', '{} downloads · {}'],
  ['hold until off-peak ({})', 'start at night ({})'],
  ['starts at {}; Axive must stay open (it can be minimized)', 'starts at {}. keep Axive open (minimized is fine)'],
  // a draw
  ['a report for the developer rests in {}', 'a report for the developer is saved in {}'],
  ['held until {}', 'waiting until {}'],
  ['{} · trying again in {}s', '{} · trying again in {}s'],
  ['{} · trying again', '{} · trying again'],
  ['resting in {}', 'saving to {}'],
  ['retrying in {}s', 'trying again in {}s'],
  ['received · {}', 'done · {}'],
  ['converting to {}…', 'converting to {}…'],
  // the download manager
  ['reading the magnet · {} peers…', 'reading the magnet link · {} sources…'],
  ['reading the magnet · {} peer…', 'reading the magnet link · {} source…'],
  ['{} peers', '{} sources'],
  ['{} peer', '{} source'],
  ['{} seeding', '{} sharing'],
  ['received · sharing {}', 'done · sharing {}'],
  ['could not fetch that: {}', 'could not download that: {}'],
  ['fetching {}: they appear below', 'downloading {}: they appear below'],
  ['into {}', 'saving to {}'],
  ['fetch: the server refused parallel streams ({}); retrying with {}', 'the server refused several connections ({}); trying again with {}'],
  // choosing a vessel
  ['draw as {}', 'download as {}'],
  ['split into its {} chapters', 'split into {} chapter files'],
  ['you drew this {} as {} (the file is gone)', 'you downloaded this {} as {} (the file was deleted)'],
  ['you drew this {} (the file is gone)', 'you downloaded this {} (the file was deleted)'],
  ['you drew this {} as {}', 'you downloaded this {} as {}'],
  ['you drew this {}', 'you downloaded this {}'],
  // playlists, batches, search
  ['{} chosen', '{} selected'],
  ['draw {} checked', 'download {} selected'],
  ['draw {}', 'download {}'],
  ['{} links gathered', '{} links added'],
  ['{} link gathered', '{} link added'],
  ['video ≤ {}p', 'video up to {}p'],
  ['≤ {}p', 'up to {}p'],
  // recipes, mirrors, setup
  ['apply “{}”?', 'use “{}”?'],
  ['vessel: {}', 'format: {}'],
  ['“{}” applied to your settings', '“{}” applied to your settings'],
  ['recipe “{}” kept', 'preset “{}” saved'],
  ['the remote would not start: {}', 'phone & browser links could not start: {}'],
  // convert, trim, distill
  ['length {}. Axive listens for the loudest, liveliest stretches', 'length {}. Axive finds the loudest, liveliest parts'],
  ['distilled {} moments', 'made a video of {} moments'],
  ['marked {} peaks', 'marked {} moments'],
  // the ledger
  ['{} drawn. every collection is a portrait of its collector', '{} downloaded'],
  ['kept in {}', 'saved in {}'],
  // vigils
  ['keeping vigil over {} · drawing the newest {}', 'following {} · downloading the newest {}'],
  ['keeping vigil over {} · only new uploads will come', 'following {} · only new uploads will download'],
  ['{} new, drawing in the tunnels', '{} new, downloading now'],
  ['{} new across {} vigils', '{} new across {} channels'],
  ['{} new across {} vigil', '{} new across {} channel'],
  ['looked {}', 'checked {}'],
  // login
  ['draws will borrow your {} login', 'downloads will use your {} sign-in'],
  ['{} cookies readable from {}: logins should work', 'Axive can read {} cookies from {}: sign-in should work'],
  ['{} is open and keeps its keys locked. close it fully (tray too), then test again', '{} is open and locks its sign-in. close it fully (including the tray), then test again'],
  ['{} seals its keys to itself now. use Firefox, or paste cookies', '{} no longer shares its sign-in. use Firefox, or paste cookies'],
  ['could not read that login: {}', 'could not read that sign-in: {}'],
  ['{} kept its keys this session, so draws went ahead without it. Close it fully, then press test.', '{} was locked this session, so downloads ran without your sign-in. close it fully, then press test.'],
  ['{} keeps its keys locked while it is open, drawing without your login. Close {} fully to use it.', '{} is open and locks its sign-in, so downloads run without it. Close {} fully to use it.'],
  ['{} has sealed its keys to itself, drawing without your login. Firefox, or pasted cookies, will open the door.', '{} no longer shares its sign-in, so downloads run without it. Use Firefox, or paste cookies.'],
  // thumbnails, inspect
  ['inspect · {}', 'details · {}'],
  ['{}: close it fully first (the tray too); newer versions may refuse (app-bound encryption)', '{}: close it fully first (including the tray); newer versions may not allow it'],
  ['{} tracks from Spotify · each matched on YouTube and drawn as a tagged mp3', '{} tracks from Spotify · each found on YouTube and downloaded as an mp3 with its details'],
  // settings
  ['renewal failed: {}', 'update failed: {}'],
  ['yt-dlp renewed: {} → {}', 'yt-dlp updated: {} → {}'],
  ['yt-dlp {} is current', 'yt-dlp {} is up to date'],
  ['fetching yt-dlp {}', 'downloading yt-dlp {}'],
  // the guide
  ['here · {}', 'on this screen · {}'],
  // the download manager, 1.4 (core)
  ['a file named {} already rests there', 'a file named {} is already there'],
  ['the tunnel {} is empty: every draw received', 'the queue {} is finished: every download is done'],
]

// ---------------------------------------------------------------- the machinery

type Pattern = {re: RegExp; out: string[]}

type Book = {exact: Map<string, string>; patterns: Pattern[]}

const compile = (key: string, out: string): Pattern => ({
  re: new RegExp(`^${key.split('{}').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`, 's'),
  out: out.split('{}'),
})
const EVERYDAY: Book = {exact: new Map(Object.entries(EXACT)), patterns: PATTERNS.map(([key, out]) => compile(key, out))}
// Dutch, keyed by the everyday English: keys without {} are exact, keys with {} are patterns
// (longest first, so the most specific wins; one whose {} count differs is dropped)
export type Language = 'en'
let on = false
const cache = new Map<string, string>()

/** Switch Simple Language on or off for every later plain() call. */
export function setPlainWords(value: boolean): void {
  if (on === value) return
  on = value
  cache.clear()
}

export const plainWordsOn = () => on

/** The text as the reader asked for it: in everyday words when Simple Language is on, exactly the text otherwise. */
export function plain(text: string): string {
  if (!on || !text) return text
  const hit = cache.get(text)
  if (hit !== undefined) return hit
  const out = translate(text, 0, EVERYDAY)
  if (cache.size > 4000) cache.clear()
  cache.set(text, out)
  return out
}

function translate(text: string, depth: number, book: Book): string {
  const {exact, patterns} = book
  const direct = exact.get(text)
  if (direct !== undefined) return direct
  if (depth > 2 || text.length < 2) return text
  // surrounding spaces: keep them, translate what is inside
  const spaced = /^(\s+)?(.*?)(\s+)?$/s.exec(text)!
  if (spaced[1] || spaced[3]) {
    const inner = spaced[2]!
    const out = translate(inner, depth + 1, book)
    return out === inner ? text : `${spaced[1] ?? ''}${out}${spaced[3] ?? ''}`
  }
  // a leading glyph or mark (∴ received., · torrents…, ✕ …)
  const marked = /^([^\p{L}\p{N}"“'(\[<$.?]+\s)(.+)$/su.exec(text)
  if (marked) {
    const rest = translate(marked[2]!, depth + 1, book)
    if (rest !== marked[2]) return marked[1] + rest
  }
  for (const pattern of patterns) {
    const m = pattern.re.exec(text)
    if (!m) continue
    let out = pattern.out[0]!
    for (let i = 1; i < pattern.out.length; i++) out += translate(m[i]!, depth + 1, book) + pattern.out[i]
    return out
  }
  // "a · b · c": each part on its own
  if (text.includes(' · ')) {
    const parts = text.split(' · ')
    const out = parts.map(part => translate(part, depth + 1, book))
    if (out.some((part, i) => part !== parts[i])) return out.join(' · ')
  }
  return text
}

/** Every original key, for tests. */
export const PLAIN_KEYS = {exact: Object.keys(EXACT), patterns: PATTERNS.map(([key]) => key)}

