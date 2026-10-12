// The generated Devices page (spec §6.3): a scene built from the widget modules (a Header, a Repeater with one
// row per role, a message and a page-number Text, five Buttons), in the project's theme, on the start page's shape; and the
// `devices` table of VB.cfg, whose data names and click ids come from the expansions, so the runtime never guesses one.
// Valid by construction (widgets expand to valid nodes), so codegen prints it with printChecked.
import { designSize } from '../editor/geometry'
import { DEVICES_PAGE } from '../model/logic'
import type { Project } from '../model/project'
import type { Scene } from '../model/scene'
import type { Theme } from '../theme/types'
import { expandRoot, isObject, putWidget, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Params, WidgetRef } from '../widgets/types'

export type DevicesCfg = {
  id: string; surface: string; rows: number
  keys: { n: string; name: string; v: string; hasv: string; ready: string; st: string; pg: string; msg: string }
  ids: { row: string; save: string; scan: string; back: string; prev: string; next: string }
  snap: string[]; nils: Record<string, number | string | number[] | string[]>
}
/** The page's id and surface: vb_devices, or vb_devices2, … when a project page holds that id or surface. */
export function devicesName(p: Project): string {
  let name = DEVICES_PAGE, n = 1
  while (p.pages.some(x => x.id === name || x.surface === name)) name = `${DEVICES_PAGE}${++n}`
  return name
}

export function devicesPage(p: Project, t: Theme): { scene: Scene; cfg: DevicesCfg } {
  // The start page's shape as the mod reads its SCENE header. A scene loadProject kept unread (an outside project's, for
  // the checker to report) reads as one with neither w nor h: codegen never throws on a project loadProject accepts.
  const start: unknown = p.pages[0].scene
  const { w, h } = designSize(isObject(start) && isObject(start.header) ? start.header as Scene['header'] : {})
  const pad = t.metrics['devices.pad'], gap = t.metrics['devices.gap'], pitch = t.metrics['devices.pitch']
  const bar = t.geo.size.control, textH = Math.ceil(1.4 * t.type.value.size), inner = w - 2 * pad
  // Five Buttons in a row when each label box (the Button's width less its inset, 2 x space 6) is LABEL or wider; on a
  // narrower page, as the theme's label width and gaps require, two rows of three columns,
  // PREV, the page number and NEXT above RESCAN, BACK and SAVE, and the message line has the whole width (ruling P29).
  const one = (inner - 4 * gap) / 5 - 2 * t.geo.space[6] >= t.metrics['devices.labelW'], cols = one ? 5 : 3
  const bw = (inner - (cols - 1) * gap) / cols, col = (k: number) => pad + k * (bw + gap)
  const bottom = h - pad - bar, pager = one ? bottom : bottom - gap - bar, msgY = pager - gap - textH
  const top = pad + t.geo.size.header + gap
  // as many rows as fit between the header and the message line: rows - 1 pitches plus one row's height
  const fit = Math.max(1, Math.floor((msgY - gap - top - t.geo.size.row) / pitch) + 1)
  const ctx = { pages: [], page: '', size: { w, h } }
  const make = (type: string, uid: string, over: Params): WidgetRef =>
    ({ type, uid, params: sanitize(WIDGETS[type], { ...WIDGETS[type].defaults(t, ctx), ...over }, t) })
  const list = make('repeater', 'vbdev', { x: pad, y: top, w: inner, max: fit, layout: 'list', pitch, item: 'row', fmt: '', click: true })
  // The runtime pages by the rows the Repeater draws: its max.
  const rows = list.params.max as number
  const msgW = one ? inner * 0.7 : inner, value = { h: textH, style: 'value' }
  const at = one ? [[0, bottom], [1, bottom], [2, bottom], [3, bottom], [4, bottom]] : [[0, pager], [2, pager], [0, bottom], [1, bottom], [2, bottom]]
  const buttons = [['vbprev', 'PREV'], ['vbnext', 'NEXT'], ['vbscan', 'RESCAN'], ['vbback', 'BACK'], ['vbsave', 'SAVE']].map(([uid, label], k) =>
    make('button', uid, { x: col(at[k][0]), y: at[k][1], w: bw, h: bar, states: [{ label, variant: uid === 'vbsave' ? 'primary' : 'secondary' }] }))
  const widgets = [
    make('header', 'vbhdr', { x: pad, y: pad, w: inner, title: 'Devices', clock: false, counts: false }),
    list,
    make('text', 'vbmsg', { ...value, x: pad, y: msgY, w: msgW, text: '$vbdev_msg', align: 'left' }),
    make('text', 'vbpg', { ...value, text: '$vbdev_pg', ...one ? { x: pad + msgW, y: msgY, w: inner - msgW, align: 'right' }
      : { x: col(1), y: pager + (bar - textH) / 2, w: bw, align: 'center' } }),
    ...buttons,
  ]
  let scene: Scene = { header: { w, h, fit: 'contain' }, defs: [], root: [] }
  for (const x of widgets) scene = putWidget(scene, x, t)
  const exps = Object.fromEntries(widgets.map(x => [x.uid, expandRoot(x, t).exp]))
  const slot = (uid: string, s: string) => exps[uid].slots.find(x => x.slot === s)!.key
  const click = (uid: string) => exps[uid].clicks![0].id
  const keys = { n: slot('vbdev', 'n'), name: slot('vbdev', 'name'), v: slot('vbdev', 'v'), hasv: slot('vbdev', 'hasv'), ready: slot('vbdev', 'ready'), st: slot('vbdev', 'st'), pg: slot('vbpg', '$vbdev_pg'), msg: slot('vbmsg', '$vbdev_msg') }
  const name = devicesName(p)
  return { scene, cfg: { id: name, surface: name, rows, keys,
    ids: { row: click('vbdev'), save: click('vbsave'), scan: click('vbscan'), back: click('vbback'), prev: click('vbprev'), next: click('vbnext') },
    snap: Object.values(keys),
    nils: { [keys.n]: 0, [keys.name]: [''], [keys.v]: [''], [keys.hasv]: [0], [keys.ready]: 0, [keys.st]: [0], [keys.pg]: '', [keys.msg]: '' } } }
}
