import {type Screen} from './context.js'

/**
 * What the shell says about each screen: its title in the masthead, the line
 * under it, which door in the rail it belongs to, and the keys shown in the
 * foot. Screens keep only their own content.
 */
export type View = {title: string; sub?: string; door: string; keys?: Array<[string, string]>; center?: boolean}

export const VIEWS: Record<Screen['name'], View> = {
  home: {title: 'paste. draw. receive.', sub: 'a link from 1,800+ sites, or any file', door: 'home', center: true, keys: [['↵', 'draw'], ['ctrl+d', 'download manager'], ['ctrl+n', 'new']]},
  probing: {title: 'Reading the link', sub: 'the deep is asked what it holds', door: 'home', center: true, keys: [['esc', 'cancel']]},
  picking: {title: 'Choose a vessel', sub: 'the shape it will take on your disk', door: 'home', keys: [['↑ ↓', 'choose'], ['↵', 'draw it']]},
  destination: {title: 'Where shall it rest?', sub: 'the folder it lands in', door: 'home'},
  drawing: {title: 'A draw', sub: 'it carries on in its tunnel if you leave', door: 'tunnels', keys: [['ctrl+p', 'pause'], ['ctrl+r', 'resume'], ['o', 'show the file']]},
  tunnels: {title: 'Tunnels', sub: 'every draw in flight: pause, reorder, retry', door: 'tunnels', keys: [['↑ ↓', 'choose'], ['space', 'mark'], ['↵', 'details'], ['del', 'delete']]},
  error: {title: 'A door would not open', sub: 'what happened, plainly, and what can be done', door: 'home'},
  settings: {title: 'Settings', sub: 'manners are the last thing a person loses. set yours', door: 'settings', keys: [['↑ ↓', 'section'], ['esc', 'home']]},
  setup: {title: 'Preparing the vessels', sub: 'Axive Free carries its own tools', door: 'settings'},
  fetch: {title: 'Download manager', sub: 'any file over up to 16 connections', door: 'fetch', keys: [['↑ ↓', 'choose'], ['space', 'mark'], ['tab', 'details'], ['ctrl+p', 'pause'], ['del', 'delete']]},
  axive: {title: 'Axive', sub: 'the full table, for $7.99 once', door: 'axive', keys: [['↵', 'open axive.xyz']]},
  guide: {title: 'Keys', sub: 'every key, and every door', door: 'guide', keys: [['esc', 'close']]},
}
