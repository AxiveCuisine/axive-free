import fs from 'node:fs'
import React, {useEffect, useState} from 'react'
import {Box, useInput} from 'ink'
import {Text} from '../text.js'
import {bridge} from '../../core/bridge.js'
import {getConfig, updateConfig, useConfig} from '../../core/config.js'
import {formatBytes, truncate} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {downloadsFolder, paths, prettyPath, readJson, writeFileAtomic} from '../../core/paths.js'
import {useSize} from '../components/fullscreen.js'
import {say} from '../components/notice.js'
import {useApp, useBack} from '../context.js'
import {Action, Button, ButtonRow, Gap, Quiet, Title, Toggle} from '../kit.js'
import {useTheme} from '../theme.js'
import {freeSpace} from './picking.js'

type State = {recentFolders?: string[]}

export function rememberFolder(folder: string): void {
  const state = readJson<State>(paths.state, {})
  state.recentFolders = [folder, ...(state.recentFolders ?? []).filter(f => f.toLowerCase() !== folder.toLowerCase())].slice(0, 5)
  try {
    writeFileAtomic(paths.state, JSON.stringify(state))
  } catch {
    // a nicety
  }
}

export function DestinationScreen({title, count, onChosen}: {title: string; count: number; onChosen: (choice: {folder: string}) => void}) {
  const theme = useTheme()
  const app = useApp()
  const config = useConfig()
  const {columns} = useSize()
  const [folder, setFolder] = useState(config.folder)
  const [picking, setPicking] = useState(false)
  const [downloads, setDownloads] = useState<string>()
  const recent = (readJson<State>(paths.state, {}).recentFolders ?? []).filter(f => f !== folder && fs.existsSync(f)).slice(0, 3)
  const width = Math.max(30, Math.min(70, columns - 10))

  useEffect(() => {
    void downloadsFolder().then(setDownloads)
  }, [])

  useBack(() => {
    app.nav.back()
    return true
  })

  const rest = (target = folder) => {
    try {
      fs.mkdirSync(target, {recursive: true})
      fs.accessSync(target, fs.constants.W_OK)
    } catch {
      say('Axive Free may not write in that folder. choose another', 'error')
      return
    }
    updateConfig({folder: target})
    rememberFolder(target)
    app.nav.back()
    onChosen({folder: target})
  }

  const choose = async () => {
    if (picking) return
    setPicking(true)
    const picked = await bridge.pickFolder(count > 1 ? `Where should these ${count} draws rest?` : 'Where should this draw rest?', folder)
    setPicking(false)
    if (picked) setFolder(picked)
  }

  useInput(
    (_input, key) => {
      if (key.return) rest()
    },
    {isActive: Boolean(process.stdin.isTTY) && !picking},
  )

  const free = freeSpace(folder)
  return (
    <Box flexDirection="column" alignItems="center">
      <Title>where shall {count > 1 ? 'they' : 'it'} rest?</Title>
      <Quiet italic>{truncate(count > 1 ? `${count} draws · ${title}` : title, width)}</Quiet>
      <Gap />
      <Box borderStyle="round" borderColor={theme.gray} borderDimColor={theme.dimSecondary} borderBackgroundColor={theme.background} paddingX={2} width={width} flexDirection="column">
        <Text color={theme.primary} wrap="truncate-middle">
          {prettyPath(folder)}
        </Text>
        <Quiet>{free !== undefined ? `${formatBytes(free)} free` : ' '}</Quiet>
      </Box>
      <Gap />
      <ButtonRow>
        <Button label="rest here" primary onPress={() => rest()} hint="↵ · draw into this folder" />
        <Button label={picking ? 'choosing…' : 'choose another…'} onPress={() => void choose()} hint="open the Windows folder picker" disabled={picking} />
        {downloads && downloads !== folder ? <Button label="Downloads" onPress={() => setFolder(downloads)} hint={prettyPath(downloads)} /> : null}
      </ButtonRow>
      {recent.length ? (
        <Box marginTop={1}>
          <Quiet>recent: </Quiet>
          {recent.map((dir, i) => (
            <Box key={dir}>
              {i > 0 ? <Quiet> · </Quiet> : null}
              <Action onPress={() => setFolder(dir)} hint={dir}>
                {truncate(prettyPath(dir), 28)}
              </Action>
            </Box>
          ))}
        </Box>
      ) : null}
      <Gap />
      <Box columnGap={4}>
        <Toggle label="ask each time" value={config.askWhere} onChange={askWhere => updateConfig({askWhere})} hint="off: draws go straight to the last folder" />
      </Box>
    </Box>
  )
}
