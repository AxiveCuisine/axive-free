import {ToolError} from './ytdlp.js'

export type ErrorKind =
  | 'private'
  | 'gone'
  | 'geo'
  | 'age'
  | 'login'
  | 'members'
  | 'upcoming'
  | 'drm'
  | 'unsupported'
  | 'network'
  | 'ratelimit'
  | 'forbidden'
  | 'format'
  | 'disk'
  | 'permission'
  | 'ffmpeg'
  | 'cookies'
  | 'outdated'
  | 'tools'
  | 'unknown'

export type Remedy = 'retry' | 'login' | 'renew' | 'mirror' | 'repair' | 'folder' | 'vessel'

export type Classified = {
  kind: ErrorKind
  /** themed headline */
  title: string
  /** one plain sentence: what happened and what to do */
  detail: string
  /** worth retrying on its own, with a pause */
  transient: boolean
  remedies: Remedy[]
  /** the tool's own words, for the logs panel */
  raw: string
}

type Rule = {kind: ErrorKind; test: RegExp; transient?: boolean}

// first match wins — the specific before the general
const RULES: Rule[] = [
  {kind: 'tools', test: /yt-dlp is missing|ffmpeg not found|ffprobe not found|ffprobe and ffmpeg not found|ENOENT.*(yt-dlp|ffmpeg)/i},
  {kind: 'cookies', test: /could not copy .* cookie database|failed to decrypt with dpapi|cannot decrypt v1\d cookies|app.bound|could not find .* cookies database|failed to decrypt cookie|unsupported browser specified for cookies/i},
  {kind: 'drm', test: /drm protected|\bdrm\b/i},
  {kind: 'private', test: /private video|this video is private|video is private|is a private|private (post|account|playlist)/i},
  {kind: 'members', test: /members[- ]only|join this channel|channel member|premium members|only available to (music )?premium|requires a subscription|subscriber[- ]only/i},
  {kind: 'age', test: /confirm your age|age[- ]restricted|age_verification|inappropriate for some users|age check/i},
  {kind: 'login', test: /sign in to confirm (you.re not a bot|you are not a bot)|not a bot|captcha|only available for registered users|login required|log in to|sign in|requires authentication|cookies (are|is) needed|use --cookies|account cookies are no longer valid|this content isn.t available/i},
  {kind: 'geo', test: /not available (from|in) your (location|country)|geo.?restrict|blocked it in your country|not made this video available in your country|available in your region/i},
  {kind: 'upcoming', test: /live event will begin|premieres? in|this live stream (has not|hasn.t) (started|begun)|is_upcoming|scheduled to start|will begin in/i},
  {kind: 'gone', test: /video unavailable|has been removed|no longer available|does not exist|account (has been )?terminated|copyright (claim|grounds|infringement)|video is unavailable|removed by the (uploader|user)|deleted|this post is unavailable|http error 410|not found.*404|http error 404/i},
  {kind: 'unsupported', test: /unsupported url|no suitable extractor|is not a valid url|no video formats found|no video could be found/i},
  {kind: 'format', test: /requested format is not available|no formats? (found|available)|format not available/i},
  {kind: 'ratelimit', test: /http error 429|too many requests|rate.?limit/i, transient: true},
  {kind: 'outdated', test: /unable to extract|signature extraction failed|nsig|n challenge|please report this issue|unable to decode|player response|confirm you are on the latest version|precondition check failed|http error 403.*youtube/i},
  {kind: 'forbidden', test: /http error 403|forbidden/i},
  {kind: 'disk', test: /no space left|enospc|disk (is )?full|not enough (disk )?space|errno 28/i},
  {kind: 'permission', test: /permission denied|access is denied|eacces|eperm|errno 13|winerror 5\b|read-only file system/i},
  {kind: 'ffmpeg', test: /postprocessing:|ffmpeg(.*)error|conversion failed|error opening (input|output)|invalid data found when processing input/i},
  {
    kind: 'network',
    test: /timed out|timeout|connection (reset|refused|aborted|closed)|network (error|is unreachable)|getaddrinfo|name or service not known|temporary failure in name resolution|unable to download (webpage|video data|json)|remote end closed|ssl|eof occurred|errno 10054|errno 11001|winerror 10060|incomplete read|http error 5\d\d|bad gateway|service unavailable|giving up after/i,
    transient: true,
  },
]

const COPY: Record<ErrorKind, {title: string; detail: string; remedies: Remedy[]}> = {
  private: {title: 'the vessel is sealed', detail: 'This one is private: only its owner, and those they let in, can see it. Signing in comes with the full Axive.', remedies: ['login', 'retry']},
  gone: {title: 'the deep has taken it back', detail: 'Removed, deleted or no longer available. A copy may survive elsewhere: the full Axive can seek a mirror.', remedies: ['mirror', 'retry']},
  geo: {title: 'this door is shut where you stand', detail: 'The site will not show this in your region.', remedies: ['mirror', 'retry']},
  age: {title: 'it asks who you are', detail: 'Age-restricted. The full Axive can borrow your browser’s login so the site knows you.', remedies: ['login', 'retry']},
  login: {title: 'it wishes to see your face', detail: 'The site wants a signed-in visitor (or proof you are not a bot). Renewing yt-dlp sometimes helps; signing in comes with the full Axive.', remedies: ['login', 'retry', 'renew']},
  members: {title: 'for members only', detail: 'This needs a membership or subscription on your account. Signing in comes with the full Axive.', remedies: ['login']},
  upcoming: {title: 'it has not yet begun', detail: 'A scheduled live stream or premiere. Try again once it starts.', remedies: ['retry']},
  drm: {title: 'sealed with a lock we will not break', detail: 'DRM-protected. Axive Free does not break copy protection.', remedies: []},
  unsupported: {title: 'nothing answers at that address', detail: 'This site or link type is not one yt-dlp can draw from. Check the link, or renew yt-dlp.', remedies: ['renew', 'retry']},
  network: {title: 'the line went quiet', detail: 'The connection dropped or timed out. Axive Free retried with growing pauses; it may simply need another moment.', remedies: ['retry']},
  ratelimit: {title: 'the house asks us to wait', detail: 'Too many requests. Give it a few minutes.', remedies: ['retry']},
  forbidden: {title: 'the door was closed in our face', detail: 'The site refused the request (403). Renewing yt-dlp usually fixes this.', remedies: ['renew', 'retry']},
  format: {title: 'that vessel is not offered', detail: 'This quality is not available for this video. Choose another.', remedies: ['vessel']},
  disk: {title: 'there is no room left', detail: 'The destination drive is full. Free some space or choose another folder.', remedies: ['folder', 'retry']},
  permission: {title: 'we may not enter that room', detail: 'Axive Free is not allowed to write in that folder. Choose another.', remedies: ['folder']},
  ffmpeg: {title: 'the binding failed', detail: 'The file arrived but the finishing step (ffmpeg) failed. Try another vessel, or repair the tools.', remedies: ['retry', 'repair', 'vessel']},
  cookies: {title: 'your browser kept its keys', detail: 'Chromium browsers (Chrome, Brave, Thorium, Edge) lock their cookies while open and newer ones seal them to themselves. Close it fully and retry.', remedies: ['login', 'retry']},
  outdated: {title: 'the old words no longer open it', detail: 'The site changed and this yt-dlp has not caught up. Renew it: it takes a moment.', remedies: ['renew', 'retry']},
  tools: {title: 'a vessel is missing', detail: 'One of Axive Free’s tools is missing or damaged. Repair restores it from Axive Free itself.', remedies: ['repair']},
  unknown: {title: 'something in the dark resisted', detail: '', remedies: ['retry', 'renew']},
}

export function classify(error: unknown): Classified {
  const message = error instanceof Error ? error.message : String(error)
  const raw = error instanceof ToolError ? `${message}\n${error.stderr}` : message
  const errorLines = raw
    .split('\n')
    .filter(line => /^ERROR:|error/i.test(line))
    .join('\n')
  const haystack = `${message}\n${errorLines || raw}`
  const rule = RULES.find(r => r.test.test(haystack))
  const kind = rule?.kind ?? 'unknown'
  const copy = COPY[kind]
  return {
    kind,
    title: copy.title,
    detail: copy.detail || firstSentence(message),
    transient: Boolean(rule?.transient),
    remedies: copy.remedies,
    raw: message,
  }
}

function firstSentence(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return line.length > 180 ? `${line.slice(0, 179)}…` : line
}

/** Pause before retry n (1-based): 2s, 4s, 8s… up to a minute; a rate limit waits longer. */
export function backoffMs(attempt: number, kind: ErrorKind): number {
  const base = kind === 'ratelimit' ? 30_000 : 2_000
  const jitter = 0.8 + Math.random() * 0.4
  return Math.min(kind === 'ratelimit' ? 180_000 : 60_000, base * 2 ** (attempt - 1)) * jitter
}
