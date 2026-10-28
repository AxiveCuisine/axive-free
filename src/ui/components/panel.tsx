import React, {type ReactNode} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {plain} from '../../core/words.js'
import {useTheme} from '../theme.js'

/**
 * A square panel with the title on its top hairline, sized to its content:
 * the top line is drawn by hand (ink borders can't embed titles), the sides
 * and bottom come from ink with borderTop disabled.
 */
export function Panel({title: titleText, width, children}: {title: string; width: number; children: ReactNode}) {
  const theme = useTheme()
  const title = plain(titleText)
  const inner = width - 2
  const tail = Math.max(0, inner - title.length - 3)
  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Text>
        <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>{'┌─ '}</Text>
        <Text color={theme.ink}>{title}</Text>
        <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>{` ${'─'.repeat(tail)}┐`}</Text>
      </Text>
      <Box width={width} borderStyle="single" borderColor={theme.ruleStrong} borderDimColor={theme.dimSecondary} borderTop={false} flexDirection="column" paddingX={2}>
        {children}
      </Box>
    </Box>
  )
}
