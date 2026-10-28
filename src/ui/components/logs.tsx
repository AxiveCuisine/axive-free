import React from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {G} from '../../core/glyphs.js'
import {rawStore, type RawLine} from '../../core/log.js'
import {paths} from '../../core/paths.js'
import {useStore} from '../../core/store.js'
import {truncate} from '../../core/format.js'
import {reveal} from '../context.js'
import {Button} from '../kit.js'
import {useTheme} from '../theme.js'

/**
 * The raw output of yt-dlp and ffmpeg, in a drawer at the foot of the
 * screen — for when something needs looking into, out of the way otherwise.
 * Drag across it to copy lines; "copy all" takes everything, untruncated.
 */
export function LogsDrawer({width, height, onCopy, onClose}: {width: number; height: number; onCopy: (text: string) => void; onClose: () => void}) {
  const theme = useTheme()
  const lines = useStore(rawStore)
  const shown = lines.slice(-(height - 1))
  const colorOf = (line: RawLine) => (line.stream === 'cmd' ? theme.accent : line.stream === 'err' ? theme.primary : theme.gray)
  const title = `── raw output · ${lines.length} line${lines.length === 1 ? '' : 's'} `
  return (
    <Box flexDirection="column" width={width} height={height} paddingX={1}>
      <Box>
        <Text color={theme.accent} dimColor={theme.dimSecondary}>
          {title}
        </Text>
        <Box flexGrow={1}>
          <Text color={theme.whisper ?? theme.gray}>{'─'.repeat(Math.max(0, width - title.length - 46))}</Text>
        </Box>
        <Box columnGap={1}>
          <Button compact label="copy all" onPress={() => onCopy(lines.map(l => (l.stream === 'cmd' ? l.text : l.text)).join('\n'))} />
          <Button compact label="log folder" onPress={() => reveal(paths.logs)} hint="axive.log and the reports for the developer" />
          <Button compact label={G.close} onPress={onClose} hint="hide (ctrl+l)" />
        </Box>
      </Box>
      {shown.length ? (
        shown.map((line, i) => (
          <Text verbatim key={i} color={colorOf(line)} dimColor={line.stream === 'out' && theme.dimSecondary} wrap="truncate-end">
            {truncate(line.text, width - 3)}
          </Text>
        ))
      ) : (
        <Text color={theme.whisper ?? theme.gray}>nothing yet. the raw words of yt-dlp and ffmpeg appear here while they work.</Text>
      )}
    </Box>
  )
}
