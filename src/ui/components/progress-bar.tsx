import React from 'react'
import {Bar} from './viz.js'

/** The heavy-on-hairline bar with its percent (see viz.tsx). */
export function ProgressBar({percent, width = 30, tone = 'live'}: {percent: number; width?: number; tone?: 'live' | 'rest' | 'done' | 'failed'}) {
  return <Bar fraction={percent} width={width + 5} tone={tone} />
}
