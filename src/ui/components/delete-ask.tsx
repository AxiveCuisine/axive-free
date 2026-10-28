import React, {useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {truncate} from '../../core/format.js'
import {Button, ButtonRow, Toggle} from '../kit.js'
import {useTheme} from '../theme.js'

/**
 * Delete, asked every time (as the window does): only the line, or the file
 * too. `live` is a download that stops: off keeps what arrived, on deletes the
 * partial file. Files go to the Recycle Bin. Answers `undefined` for "keep".
 */
export function DeleteAsk({what, live, width, onAnswer}: {what: string; live: boolean; width: number; onAnswer: (drive: boolean | undefined) => void}) {
  const theme = useTheme()
  const [drive, setDrive] = useState(false)
  return (
    <Box flexDirection="column" width={width}>
      <Text color={theme.primary} wrap="truncate-end" verbatim>{`delete ${truncate(what, Math.max(10, width - 12))}?`}</Text>
      <Toggle
        label={live ? 'also delete the partial file' : 'also delete from the drive'}
        value={drive}
        onChange={setDrive}
        hint={live ? 'on: what arrived goes to the Recycle Bin. off: it stays on the drive' : 'the file goes to the Recycle Bin, so you can still bring it back. a file another program has open stays'}
      />
      <ButtonRow>
        <Button compact primary label={drive ? 'delete, with the file' : live ? 'stop, keep the file' : 'remove from the list'} onPress={() => onAnswer(drive)} />
        <Button compact label="keep" onPress={() => onAnswer(undefined)} />
      </ButtonRow>
    </Box>
  )
}
