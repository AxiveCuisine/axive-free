import fs from 'node:fs'
import os from 'node:os'
import React, {useCallback, useMemo, useState} from 'react'
import {Box} from 'ink'
import {Text} from '../text.js'
import {getConfig, useConfig} from '../../core/config.js'
import {formatBytes, formatDuration, wrapText} from '../../core/format.js'
import {G} from '../../core/glyphs.js'
import {addJobs} from '../../core/jobs.js'
import {ago, findDuplicate, ledgerStore} from '../../core/ledger.js'
import {detectPlatform} from '../../core/platforms.js'
import {prettyPath} from '../../core/paths.js'
import {useStore} from '../../core/store.js'
import {ONLY_IN_AXIVE} from '../../core/brand.js'
import {buildChoices, heightsAboveFree, type DownloadChoice} from '../../core/ytdlp.js'
import {useSize} from '../components/fullscreen.js'
import {List, ListRow} from '../components/list.js'
import {Panel} from '../components/panel.js'
import {openFile, useApp, useBack, type VideoProbe} from '../context.js'
import {Action, Button, ButtonRow, Gap, Quiet} from '../kit.js'
import {useTheme} from '../theme.js'

export const choiceIcon = (choice: DownloadChoice) =>
  choice.kind === 'audio' ? G.audio : G.video

export function freeSpace(dir: string): number | undefined {
  try {
    let probe = dir
    while (!fs.existsSync(probe) && probe !== os.homedir()) probe = probe.replace(/[\\/][^\\/]+$/, '') || os.homedir()
    const stat = fs.statfsSync(probe)
    return stat.bavail * stat.bsize
  } catch {
    return undefined
  }
}

/**
 * Where a draw is asked to rest, then queued. Shared by every screen that
 * starts draws: asks for the folder (once for a batch) unless the settings say
 * not to ask.
 */
export function useQueueDraw() {
  const app = useApp()
  return useCallback(
    (items: Parameters<typeof addJobs>[0], opts: {title: string; single: boolean}) => {
      const go = (folder: string) => {
        const jobs = addJobs(items.map(item => ({...item, folder})))
        if (opts.single && jobs[0]) app.nav.replace({name: 'drawing', jobId: jobs[0].id})
        else app.nav.replace({name: 'tunnels'})
      }
      const config = getConfig()
      if (!config.askWhere) {
        go(config.folder)
        return
      }
      app.nav.push({
        name: 'destination',
        title: opts.title,
        count: items.length,
        onChosen: ({folder}) => go(folder),
      })
    },
    [app],
  )
}

export function PickingScreen({probe, animated}: {probe: VideoProbe; animated: boolean}) {
  const theme = useTheme()
  const app = useApp()
  const config = useConfig()
  const {columns, rows} = useSize()
  const {info} = probe
  const choices = useMemo(() => buildChoices(info), [info])
  const [selected, setSelected] = useState(0)
  const queueDraw = useQueueDraw()
  useStore(ledgerStore)

  useBack(() => {
    app.nav.home(probe.url)
    return true
  })

  const platform = detectPlatform(info.webpage_url ?? probe.url)
  // what this video also has above 1080p: Axive draws it
  const above = useMemo(() => heightsAboveFree(info), [info])
  const duplicate = config.warnDuplicates ? findDuplicate(info.extractor_key?.toLowerCase(), info.id, probe.url) : undefined
  const duplicateExists = duplicate?.filepath ? fs.existsSync(duplicate.filepath) : false
  const contentWidth = Math.max(40, Math.min(columns - 4, 100))
  const listLimit = Math.max(3, Math.min(10, rows - 20))
  const highlighted = choices[selected]
  const free = freeSpace(config.folder)
  const tooBig = highlighted?.size && free !== undefined && highlighted.size * 1.05 > free

  const draw = (index: number) => {
    const choice = choices[index]
    if (!choice) return
    queueDraw(
      [
        {
          url: probe.url,
          title: info.title,
          site: info.extractor_key?.toLowerCase(),
          videoId: info.id,
          uploader: info.uploader ?? info.channel,
          thumbnail: info.thumbnail,
          choice,
          folder: config.folder,
          options: {},
          infoJsonPath: probe.infoJsonPath,
        },
      ],
      {title: info.title, single: true},
    )
  }

  return (
    <Box flexDirection="column" alignItems="center">
      <Gap />
      <Box width={contentWidth}>
        <Box flexDirection="column" flexGrow={1} flexBasis={0} paddingTop={1} paddingRight={3}>
          {/* wrapped by hand so continuation lines stay flush left */}
          {wrapText(info.title || '(untitled)', Math.max(10, contentWidth - 46))
            .slice(0, 3)
            .map((line, index) => (
              <Text key={index} bold color={theme.primary}>
                {line}
              </Text>
            ))}
          <Gap />
          <Quiet>
            ▸ {platform.label}
            {info.duration ? ` · ${formatDuration(info.duration)}` : ''}
            {info.uploader ?? info.channel ? ` · ${info.uploader ?? info.channel}` : ''}
          </Quiet>
          {highlighted?.size ? (
            <Text color={tooBig ? theme.accent : theme.gray} dimColor={!tooBig && theme.dimSecondary}>
              {`≈ ${formatBytes(highlighted.size)}${highlighted.height ? ` at ${highlighted.height}p` : ''}${free !== undefined ? ` · ${formatBytes(free)} free in ${prettyPath(config.folder)}` : ''}${tooBig ? ' · not enough room' : ''}`}
            </Text>
          ) : (
            <Text> </Text>
          )}
          {duplicate ? (
            <Box>
              <Text color={theme.accent}>{G.therefore} </Text>
              <Quiet>{`you drew this ${ago(duplicate.at)}${duplicate.filepath ? ` as ${duplicate.filepath.split(/[\\/]/).pop()}` : ''}${duplicateExists ? ' ' : ' (the file is gone)'}`}</Quiet>
              {duplicateExists ? (
                <Action onPress={() => openFile(duplicate.filepath!)} hint={prettyPath(duplicate.filepath!)}>
                  open it
                </Action>
              ) : null}
            </Box>
          ) : null}
          {above.length ? (
            <Box>
              <Text color={theme.accent}>{G.star} </Text>
              <Quiet>{`it also comes in ${above.map(h => (h >= 4320 ? '8K' : h >= 2160 ? '4K' : `${h}p`)).join(', ')}. `}</Quiet>
              <Action onPress={() => app.nav.push({name: 'axive', why: ONLY_IN_AXIVE.quality})} hint="what the full Axive draws">
                Axive draws those
              </Action>
            </Box>
          ) : null}
        </Box>
        <Panel title="Vessels" width={42}>
          <List
            items={choices}
            selected={selected}
            onSelect={setSelected}
            onChoose={draw}
            limit={listLimit}
            render={(choice, state) => <ListRow label={`${choiceIcon(choice)} ${choice.label}`} {...state} />}
            hintFor={choice => `draw as ${choice.label}`}
          />
        </Panel>
      </Box>
      <Gap />
      <ButtonRow>
        <Button compact label="back" onPress={() => app.nav.home(probe.url)} hint="esc" />
      </ButtonRow>
    </Box>
  )
}
