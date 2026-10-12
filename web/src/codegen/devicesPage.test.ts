import { describe, expect, it } from 'vitest'
import { textWidth } from '../editor/testing'
import { fontStyle } from '../editor/fonts'
import { newPage, newProject } from '../model/project'
import type { Scene, SrcNode } from '../model/scene'
import { SHAPES } from '../model/shapes'
import { checkScene } from '../srctext/check'
import { printChecked } from '../srctext/print'
import { first } from '../srctext/props'
import { THEMES } from '../theme'
import { vanillaPlus } from '../theme/vanillaPlus'
import { devicesName, devicesPage, type DevicesCfg } from './devicesPage'

/** A new project whose start page is w by h. */
function sized(w: number, h: number) {
  const p = newProject()
  p.pages[0].scene = { ...p.pages[0].scene, header: { w, h, fit: 'contain' } }
  return p
}
/** The page's widgets in order, each its uid and box, read from its marker (widgetOf reads only a builder uid, which ends
 *  in a number). */
const boxesOf = (scene: Scene) => scene.root.map(n => {
  const [, uid, json] = /^widget [a-z]+ (\w+) (\{.*\})$/.exec(n.comments!.at(-1)!)!
  const { x, y, w, h } = JSON.parse(json) as Record<'x' | 'y' | 'w' | 'h', number>
  return { uid, x, y, w, h }
})
/** Each widget of the page that lies outside it or over another, by uid: none on a page laid out right. */
function collisions(scene: Scene, w: number, h: number): string[] {
  const boxes = boxesOf(scene), e = 1e-3, out: string[] = []
  for (const b of boxes) if (b.x < -e || b.y < -e || b.x + b.w > w + e || b.y + b.h > h + e) out.push(`${b.uid} outside ${w}x${h}`)
  boxes.forEach((b, i) => boxes.slice(i + 1).forEach(c => {
    if (b.x < c.x + c.w - e && c.x < b.x + b.w - e && b.y < c.y + c.h - e && c.y < b.y + b.h - e) out.push(`${b.uid} over ${c.uid} on ${w}x${h}`)
  }))
  return out
}
// The runtime's fixed messages for the page (VB.devMsg, Task 5); a boot problem names a read or a type, and may be cut.
const MESSAGES = ['store unreadable: saving off', 'no chip memory', 'save failed', 'unsaved', 'saved']
const labelWidth = (font: string, size: number, cspace: number, text: string, bold: boolean) =>
  textWidth(font, size, cspace, text) + [...text].length * size * parseFloat(fontStyle(font, bold ? 700 : 400).letterSpacing)
/** Each label of the page whose text runs wider than its box, which TMP cuts with an ellipsis: a literal, every fixed
 *  message in the message line, a page number up to 99/99. */
function cut(scene: Scene, cfg: DevicesCfg, w: number, h: number): string[] {
  const walk = (ns: SrcNode[]): SrcNode[] => ns.flatMap(n => [n, ...walk(n.c ?? [])]), out: string[] = []
  for (const n of walk(scene.root).filter(n => n.op === 'T')) {
    const text = String(first(n, 'TEXT')), box = Number(first(n, 'W'))
    const texts = text === '$' + cfg.keys.msg ? MESSAGES : text === '$' + cfg.keys.pg ? ['99/99'] : /[$={}]/.test(text) ? [] : [text]
    for (const s of texts) {
      const run = labelWidth(String(first(n, 'FONT') ?? ''), Number(first(n, 'SIZE')), Number(first(n, 'CSPACE') ?? 0), s, first(n, 'WEIGHT') === 'bold')
      if (run > box) out.push(`"${s}" runs ${run.toFixed(1)} in ${box.toFixed(1)} on ${w}x${h}`)
    }
  }
  return out
}

describe('the Devices page', () => {
  it('connects its row value flag to the shared repeater item', () => {
    const { cfg, scene } = devicesPage(sized(480, 480), vanillaPlus)
    expect(cfg.keys).toHaveProperty('hasv', 'vbdev_hasv')
    expect(cfg.snap).toContain('vbdev_hasv')
    expect(cfg.nils.vbdev_hasv).toEqual([0])
    expect(printChecked(scene)).toContain('$vbdev_hasv[i]')
  })
  const a = THEMES['vanilla-plus'], b = THEMES.neutral
  it('reads the theme metrics', () => {
    const p = sized(1440, 480), wide = { ...vanillaPlus, metrics: { ...vanillaPlus.metrics, 'devices.labelW': 1000 } }
    const ys = (t: typeof vanillaPlus) => new Set(boxesOf(devicesPage(p, t).scene).filter(b => ['vbprev', 'vbnext', 'vbscan', 'vbback', 'vbsave'].includes(b.uid)).map(b => b.y))
    expect(ys(vanillaPlus).size).toBe(1)
    expect(ys(wide).size).toBe(2)
  })
  it('reserves the theme metric for its widest control label', () => {
    for (const t of Object.values(THEMES)) {
      const style = t.type['button-label']
      const widest = Math.max(...['PREV', 'NEXT', 'RESCAN', 'BACK', 'SAVE'].map(word => labelWidth(style.font, style.size, style.cspace, word, style.weight === 'bold')))
      expect(widest)
        .toBeLessThanOrEqual(t.metrics?.['devices.labelW'] ?? 0)
      if (t.id === 'neutral') expect(t.metrics['devices.labelW']).toBe(Math.ceil(widest))
    }
  })
  it('checks clean, and its names and plates come from the expansions', () => {
    const { scene, cfg } = devicesPage(newProject(), a)
    const c = checkScene(scene)
    expect([c.errors, c.warnings]).toEqual([[], []])
    expect(cfg.keys).toEqual({ n: 'vbdev_n', name: 'vbdev_name', v: 'vbdev_v', hasv: 'vbdev_hasv', ready: 'vbdev_ready', st: 'vbdev_st', pg: 'vbdev_pg', msg: 'vbdev_msg' })
    expect(cfg.ids).toEqual({ row: 'vbdev_r', save: 'vbsave_hit', scan: 'vbscan_hit', back: 'vbback_hit', prev: 'vbprev_hit', next: 'vbnext_hit' })
    const plates = [...c.src!.matchAll(/\bR id=(\w+) (?:click|press)=1/g)].map(m => m[1])
    expect(plates).toEqual(expect.arrayContaining(Object.values(cfg.ids)))
    expect(cfg.snap.sort()).toEqual(Object.values(cfg.keys).sort())
    expect(cfg.nils).toEqual({ vbdev_n: 0, vbdev_name: [''], vbdev_v: [''], vbdev_hasv: [0], vbdev_ready: 0, vbdev_st: [0], vbdev_pg: '', vbdev_msg: '' })
    expect(cfg.rows).toBeGreaterThanOrEqual(3)
  })
  it('lays its widgets inside the page and none over another, and checks clean, in two themes, on a wide page and on every shape', () => {
    for (const [t, w, h] of [[a, 480, 480], [b, 480, 480], [a, 960, 480], [b, 561, 480], [a, 480, 1080]] as const) {
      const { scene } = devicesPage(sized(w, h), t), c = checkScene(scene)
      expect([c.errors, c.warnings, collisions(scene, w, h)]).toEqual([[], [], []])
    }
    for (const t of Object.values(THEMES)) for (const { w, h } of Object.values(SHAPES).map(s => s.units))
      expect(collisions(devicesPage(sized(w, h), t).scene, w, h)).toEqual([])
    expect(boxesOf(devicesPage(sized(480, 480), a).scene).map(x => x.uid))
      .toEqual(['vbhdr', 'vbdev', 'vbmsg', 'vbpg', 'vbprev', 'vbnext', 'vbscan', 'vbback', 'vbsave'])
  })
  it('draws each Button label, every fixed message and the page number whole, on every shape, on any wider page and in every theme', () => {
    const cuts = (t: typeof a, sizes: { w: number; h: number }[]) =>
      sizes.flatMap(({ w, h }) => { const d = devicesPage(sized(w, h), t); return cut(d.scene, d.cfg, w, h) })
    for (const t of Object.values(THEMES)) expect(cuts(t, Object.values(SHAPES).map(s => s.units))).toEqual([])
    // A custom page is 480 on its shorter side: every fourth width up to 1600, past where the Buttons go into one row.
    for (const t of Object.values(THEMES)) expect(cuts(t, Array.from({ length: 281 }, (_, k) => ({ w: 480 + 4 * k, h: 480 })))).toEqual([])
  })
  it('takes the start page\'s shape and the project\'s theme', () => {
    const p = newProject()
    p.pages[0].scene = { ...p.pages[0].scene, header: { w: 960, h: 480, fit: 'contain' } }
    const wide = devicesPage(p, a)
    expect(wide.scene.header).toEqual({ w: 960, h: 480, fit: 'contain' })
    expect(checkScene(wide.scene).errors).toEqual([])
    expect(printChecked(devicesPage(newProject(), a).scene)).not.toBe(printChecked(devicesPage(newProject(), b).scene))
  })
  it('pages by as many rows as its Repeater draws, on any page height', () => {
    const baseRows = devicesPage(sized(480, 480), a).cfg.rows
    for (const h of [480, 480 + 56 * 30000]) {
      const p = newProject()
      p.pages[0].scene = { ...p.pages[0].scene, header: { w: 480, h, fit: 'contain' } }
      const { scene, cfg } = devicesPage(p, a)
      expect(cfg.rows).toBe(baseRows + (h - 480) / 56)
      expect(printChecked(scene)).toContain(`RP n=${cfg.rows} `)
    }
  })
  it('never throws on a start page whose scene loadProject kept unread: it reads as a scene with no size', () => {
    for (const scene of [null, 5, {}, { header: null, defs: [], root: [] }]) {
      const p = newProject()
      p.pages[0] = { ...p.pages[0], scene: scene as unknown as Scene }
      const d = devicesPage(p, a)
      expect(d.scene.header).toEqual({ w: 100, h: 100, fit: 'contain' })
      expect(checkScene(d.scene).errors).toEqual([])
    }
  })
  it('names itself vb_devices, or the next free name when a page holds it', () => {
    const p = newProject()
    expect(devicesName(p)).toBe('vb_devices')
    p.pages.push({ ...newPage(p), id: 'vb_devices' })
    p.pages.push({ ...newPage(p), id: 'p9', surface: 'vb_devices2' })
    expect(devicesName(p)).toBe('vb_devices3')
    expect(devicesPage(p, a).cfg).toMatchObject({ id: 'vb_devices3', surface: 'vb_devices3' })
  })
})

it('keeps Devices controls in their left-to-right order on wide and narrow pages', () => {
  for (const w of [480, 960]) {
    const controls = boxesOf(devicesPage(sized(w, 480), THEMES.vanillaPlus ?? Object.values(THEMES)[0]).scene)
      .filter(b => ['vbprev', 'vbnext', 'vbscan', 'vbback', 'vbsave'].includes(b.uid))
      .sort((a, b) => a.y - b.y || a.x - b.x).map(b => b.uid)
    expect(controls).toEqual(['vbprev', 'vbnext', 'vbscan', 'vbback', 'vbsave'])
  }
})
