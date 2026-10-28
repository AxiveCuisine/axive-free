import React, {type ReactNode} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {G} from '../../core/glyphs.js'
import {useRegion} from '../mouse.js'
import {plain} from '../../core/words.js'
import {useTheme} from '../theme.js'

/** Total columns the button occupies (label + 2 cells padding per side). */
const frameButtonWidth = (label: string) => label.length + 4

/**
 * A single-line input frame with the title sitting on the top border,
 * like `╭─ Offer a link ────╮`. Drawn by hand because ink borders don't
 * support embedded titles.
 *
 * `button` renders a filled block forged onto the right edge: the frame
 * drops its own right border and its lines run straight into the block, so
 * input and button read as one control. Half-blocks on the outer rows keep
 * the fill optically the same height as the thin frame borders. The block
 * is a real button: it brightens under the mouse. `buttonDim` shows the
 * pressed/loading state.
 */
export function FramedInput({
  title: titleText,
  width,
  button: buttonText,
  buttonDim = false,
  onButton,
  buttonHint,
  onFrame,
  children,
}: {
  title: string
  width: number
  button?: string
  buttonDim?: boolean
  onButton?: () => void
  buttonHint?: string
  /** clicking the frame (e.g. to focus the field) */
  onFrame?: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  // measured in the words it will show (Simple Language)
  const title = plain(titleText)
  const button = buttonText === undefined ? undefined : plain(buttonText)
  const inner = width - 2
  const tail = Math.max(0, inner - title.length - 3)
  const buttonW = button ? frameButtonWidth(button) : 0
  const {ref: buttonRef, hovered} = useRegion({onPress: buttonDim ? undefined : onButton, hint: buttonHint, disabled: buttonDim || !onButton, label: button})
  const {ref: frameRef} = useRegion({onPress: onFrame, disabled: !onFrame})
  const fillColor = buttonDim ? theme.ruleStrong : hovered ? theme.hover ?? theme.primary : theme.button ?? theme.primary
  return (
    <Box width={width + buttonW}>
      <Box ref={frameRef} flexDirection="column" width={width}>
        <Text>
          <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>
            {'┌─ '}
          </Text>
          <Text color={theme.primary}>{title}</Text>
          <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>{` ${'─'.repeat(tail)}${button ? '─' : '┐'}`}</Text>
        </Text>
        <Box width={width} height={1} overflow="hidden">
          <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>
            │{' '}
          </Text>
          <Text color={theme.ink2}>{G.prompt} </Text>
          <Box flexGrow={1} height={1} overflow="hidden">
            {children}
          </Box>
          {button ? null : (
            <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>
              {' '}│
            </Text>
          )}
        </Box>
        <Text color={theme.ruleStrong} dimColor={theme.dimSecondary}>{`└${'─'.repeat(inner)}${button ? '─' : '┘'}`}</Text>
      </Box>
      {button ? (
        <Box ref={buttonRef} flexDirection="column" width={buttonW}>
          {/* bold matches the label row: with `inverse`, terminals brighten the
              bold default foreground, and the half-block fills must brighten too */}
          <Text bold color={fillColor} dimColor={buttonDim && theme.dimSecondary}>
            {'▄'.repeat(buttonW)}
          </Text>
          <Text
            backgroundColor={theme.inverseButton ? undefined : fillColor}
            color={theme.inverseButton ? undefined : theme.buttonText ?? theme.dark}
            // terminals disagree on whether `dim` reaches an inverted
            // background — many keep it bright, splitting the dim button into
            // gray/white/gray bands. Skip inverse while dim: the label fades
            // with the fills as a ghost button instead
            inverse={theme.inverseButton && !buttonDim}
            dimColor={buttonDim && theme.dimSecondary}
            bold
          >{`  ${button}  `}</Text>
          <Text bold color={fillColor} dimColor={buttonDim && theme.dimSecondary}>
            {'▀'.repeat(buttonW)}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
