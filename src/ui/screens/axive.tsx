import React from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {UPGRADE_URL} from '../../core/brand.js'
import {G} from '../../core/glyphs.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {openUrl, useApp} from '../context.js'
import {Button, ButtonRow, Gap, Quiet, Rule} from '../kit.js'
import {useTheme} from '../theme.js'

/**
 * What the full Axive adds to Free, plainly, and where to get it. Opened from
 * the rail, the header, and wherever Free meets something only Axive does
 * (a playlist, a torrent, a Spotify link), with that reason on top.
 */

type Course = [what: string, free: string, axive: string]
const COURSES: Course[] = [
  ['quality', 'up to 1080p', '1440p, 4K and 8K'],
  ['links', 'one at a time', 'playlists, channels, search, batch'],
  ['download manager', 'files, 16 connections', 'plus torrents and magnets'],
  ['tunnels', '2 side by side', 'up to 4, named queues, schedules'],
  ['Spotify', '·', 'tracks, albums, playlists as tagged mp3'],
  ['the window', 'terminal only', 'a full window beside the terminal'],
  ['browser', '·', 'an extension: one click on any page'],
  ['your phone', '·', 'send links from it, take files to it'],
  ['tools', '·', 'convert, trim, highlight reels, subtitles'],
  ['clipboard', '·', 'ghost: copied links offered at once'],
  ['and', '·', 'SponsorBlock, chapters, vigils, login, Telegram'],
]

export function AxiveScreen({why}: {why?: string}) {
  const theme = useTheme()
  const app = useApp()
  const {columns} = useSize()
  const width = Math.max(44, Math.min(columns - 4, 92))
  const wide = width >= 80
  const open = () => {
    openUrl(UPGRADE_URL)
    say('axive.xyz is opening in your browser', 'ok', 3000)
  }
  useInput((_input, key) => key.return && open(), {isActive: Boolean(process.stdin.isTTY)})
  return (
    <Box flexDirection="column" width={width}>
      {why ? (
        <>
          <Text color={theme.signalInk} bold>
            {`${G.star} ${why}`}
          </Text>
          <Gap />
        </>
      ) : null}
      <Text color={theme.ink}>Free is fast and stays free. Axive is the whole table: $7.99 once, for life, on 3 PCs, every 1.x and 2.x update, 14-day refund.</Text>
      <Gap />
      <Rule title="Free · Axive" width={width} />
      <Box flexDirection="column" paddingLeft={2}>
        {COURSES.map(([what, free, axive]) => (
          <Box key={what}>
            <Box width={wide ? 20 : 14} flexShrink={0}>
              <Text color={theme.accent}>{what}</Text>
            </Box>
            {wide ? (
              <Box width={24} flexShrink={0}>
                <Text color={theme.gray} wrap="truncate-end">
                  {free}
                </Text>
              </Box>
            ) : null}
            <Text color={theme.primary} wrap="truncate-end">
              {axive}
            </Text>
          </Box>
        ))}
      </Box>
      <Gap />
      <ButtonRow>
        <Button primary label="open axive.xyz" onPress={open} hint={UPGRADE_URL} />
        <Button label="back" onPress={() => app.nav.back()} hint="esc" />
      </ButtonRow>
      <Gap />
      <Quiet>Your settings and downloads stay where they are: Axive keeps its own.</Quiet>
    </Box>
  )
}
