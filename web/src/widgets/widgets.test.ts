import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generate } from '../codegen/generate'
import { hostOf } from '../codegen/hostOf'
import { el } from './paint'
import type { SrcNode } from '../model/scene'
import { newPage, newProject } from '../model/project'
import { projectText } from '../project/codec'
import { parseSrc } from '../srctext/parse'
import { printChecked, printSrc } from '../srctext/print'
import { groundOf } from '../theme'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { expandRoot, putWidget, reassociate, sanitize, widgetOf } from './core'
import { WIDGETS } from './registry'
import { bracket, holds, instance, sceneOf, variants } from './testing'
import type { Params } from './types'

// Append the new widget so the frozen fixtures keep existing variant uids.
const scene = Object.values(WIDGETS).filter(m => !m.native).sort((a, b) => Number(a.type === 'gauge') - Number(b.type === 'gauge'))

describe('every widget', () => {
  it('writes the anatomy fixture: every widget and every variant under bracket', async () => {
    const p = newProject(), page2 = newPage(p)
    let s = { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] } as typeof p.pages[0]['scene']
    for (const m of scene) s = putWidget(s, instance(m.type, m.type === 'repeater' ? { click: true } : {}), bracket)
    p.pages[0] = { ...p.pages[0], size: { w: 460, h: 460 }, scene: s, natives: [instance('icon'), instance('textinput')] }
    const extra: Record<string, Params[]> = { bar: [{ cells: 4, h: 40 }, { cells: 4, h: 40, target: true }], repeater: [{ layout: 'grid', cols: 2, click: true }] }
    let v = { ...s, root: [], defs: [] } as typeof s, k = 100
    for (const m of scene) for (const over of [...variants(m.type), ...extra[m.type] ?? []]) {
      const w = instance(m.type, over, `${m.prefix}${k++}`)
      if (m.type === 'glyph') w.params = sanitize(m, w.params, bracket)
      v = putWidget(v, w, bracket)
    }
    p.pages.push({ ...page2, size: { w: 460, h: 460 }, scene: v })
    const lua = generate(p, pg => printSrc(pg.scene)).lua
    await expect(lua).toMatchFileSnapshot('../../test/fixtures/codegen/anatomy.lua')
    await expect(JSON.stringify(hostOf(p, null, null).host, null, 1) + '\n').toMatchFileSnapshot('../../test/fixtures/codegen/anatomy.host.json')
  })
  it('that hides all it draws at rest holds its box with an unpainted R, so the mod draws no empty-scene marker', () => {
    // An Alert at state 0, an Event log with no entry, a Repeater at n 0: hidden, the page would draw the magenta marker.
    for (const type of ['alert', 'eventlog', 'repeater']) {
      const w = instance(type), p = w.params as { x: number; y: number; w: number; h: number }
      expect([type, expandRoot(w, t).root.c![0]]).toEqual([type, { op: 'R', attrs: { x: p.x, y: p.y, w: p.w, h: p.h } }])
    }
    // A Status light's state out of 0..3 shows the idle light, as the ink beside one paints it idle.
    expect(expandRoot(instance('light'), t).root.c![0].attrs.v).toBe('=1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3)')
  })
  it('takes any size the mod draws, and holds a height only where a fit=ellipsis label needs one, by the theme’s sizes', () => {
    expect(instance('duct', { h: 0.5, period: 0.5 }).params).toMatchObject({ h: 0.5, period: 0.5 })   // a hairline duct
    expect(instance('bar', { w: 0.5, h: 0.5 }).params).toMatchObject({ w: 0.5, h: 0.5 })
    expect(instance('readoutrow', { w1: 0, w2: 0 }).params).toMatchObject({ w1: 0, w2: 0 })
    expect(instance('kvtable', { valueW: 0 }).params.valueW).toBe(0)
    // A Header holds its title's line, else its clock's, else nothing.
    expect([instance('header', { h: 10 }), instance('header', { title: '', clock: true, h: 10 }), instance('header', { title: '', h: 10 })]
      .map(w => w.params.h)).toEqual([Math.fround(62.4), Math.fround(51.2), 10])
    // A preset with larger labels holds a larger height (E9 kept for any theme, M5's imports among them).
    const big = { ...t, type: { ...t.type, 'button-label': { ...t.type['button-label'], size: 40 } } }
    expect(sanitize(WIDGETS.button, { ...instance('button').params, h: 10 }, big).h).toBe(56)
    holds('duct', { h: 0.5, period: 0.5 })
  })
  it('has a unique type and uid prefix, x y w h first, and a palette group', () => {
    expect(scene.length + Object.values(WIDGETS).filter(m => m.native).length).toBe(21)
    expect(new Set(Object.values(WIDGETS).map(m => m.prefix)).size).toBe(21)
    for (const m of Object.values(WIDGETS)) {
      expect(m.prefix).toMatch(/^[a-z]+$/)
      expect(m.params.slice(0, 4).map(p => p.key)).toEqual(['x', 'y', 'w', 'h'])
      expect(['chrome', 'values', 'controls', 'icons']).toContain(m.group)
    }
  })
  it('expands its defaults with no rule broken and nothing from the checker', () => {
    for (const m of scene) holds(m.type)
  })
  it('prints, parses and re-associates with no detach, its params read back exactly (brief 2.4, R1)', () => {
    for (const m of scene) {
      const w = instance(m.type), s = sceneOf(w), back = parseSrc(printChecked(s)).scene!
      expect({ type: m.type, detached: reassociate({ ...s, root: [] }, back, t).detached }).toEqual({ type: m.type, detached: [] })
      expect(widgetOf(back.root[0], t)).toEqual(w)
      expect(back.defs.map(d => d.attrs.id)).toEqual(s.defs.map(d => d.attrs.id))
    }
  })
  // Since vector 0.11.93 a T with an id and click=1 records a hit region of its own, so a label laid over a plate would take
  // the plate's click. Every widget's labels carry neither click nor press (and no id), in every variant its params name.
  it('keeps click and press off its labels: only its unpainted R plates take the pointer', () => {
    const labelled: string[] = []
    for (const m of scene) for (const v of variants(m.type)) {
      const { root } = expandRoot(instance(m.type, v), t)
      for (const stack: SrcNode[] = [root]; stack.length;) {
        const n = stack.pop()!
        if (n.op.toUpperCase() === 'T' && ['click', 'press', 'id'].some(k => Object.keys(n.attrs).some(a => a.toLowerCase() === k)))
          labelled.push(`${m.type} ${JSON.stringify(v)}: T ${JSON.stringify(n.attrs)}`)
        stack.push(...n.c ?? [])
      }
    }
    expect(labelled).toEqual([])
  })
  it('the controls have plates: the Button, Toggle, Stepper, Option group and Page tabs each take clicks', () => {
    for (const type of ['button', 'toggle', 'stepper', 'options', 'tabs'])
      expect({ type, clicks: (expandRoot(instance(type), t).exp.clicks ?? []).length > 0 }).toEqual({ type, clicks: true })
  })
  it('writes the widgets fixture: every widget on one page, with its samples; every variant on a second', async () => {
    const p = newProject()
    p.theme = 'vanilla-plus'
    p.pages[0].background = groundOf(t)
    const page2 = newPage(p)
    let s = { header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] } as typeof p.pages[0]['scene']
    for (const m of scene) s = putWidget(s, instance(m.type, m.type === 'repeater' ? { click: true } : {}), t)
    s.root.push(el('R', { x: 350, y: 350, w: 80, h: 80, f: '#123456' }))
    s = putWidget(s, instance('glyph', { x: 360, y: 360, w: 60 }, 'gl900'), t)
    p.pages[0] = { ...p.pages[0], size: { w: 460, h: 460 }, scene: s, natives: [instance('icon'), instance('textinput')] }
    // Page 2: each module's variants (each enum value, each flag on, three items of each list: variants()), plus a Bar in
    // cells and a Repeater grid with plates, each its own uid, so the core draws what only the rules checked before.
    const extra: Record<string, Params[]> = { bar: [{ cells: 4, h: 40 }, { cells: 4, h: 40, target: true }], repeater: [{ layout: 'grid', cols: 2, click: true }] }
    let v = { ...s, root: [], defs: [] } as typeof s, k = 100
    for (const m of scene) for (const over of [...variants(m.type), ...extra[m.type] ?? []]) {
      const w = instance(m.type, over, `${m.prefix}${k++}`)
      // Keep the fixture's legacy gas inks even though they are no longer required UI roles.
      if (m.type === 'glyph' && over.ink) w.params.ink = over.ink
      v = putWidget(v, w, t)
    }
    p.pages.push({ ...page2, size: { w: 460, h: 460 }, scene: v })
    const lua = generate(p, pg => printSrc(pg.scene)).lua
    await expect(lua).toMatchFileSnapshot('../../test/fixtures/codegen/widgets.lua')
    const file = new URL('../../test/fixtures/codegen/widgets.lua', import.meta.url)
    if (existsSync(file)) expect(readFileSync(file, 'utf8').includes('\r')).toBe(false)
    expect(lua.includes('\r')).toBe(false)
    await expect(JSON.stringify(hostOf(p, null, null).host, null, 1) + '\n').toMatchFileSnapshot('../../test/fixtures/codegen/widgets.host.json')
    const model = new URL('../../../.test-artifacts/m4-artifacts/corpus-widgets.project.json', import.meta.url)
    mkdirSync(new URL('.', model), { recursive: true })
    writeFileSync(model, projectText(p))
    expect(JSON.parse(readFileSync(model, 'utf8'))).toEqual(JSON.parse(projectText(p)))
  })
})

// Owner, 2026-10-13: the widget panel's rows "should read as what they are": every param, a list's item params too, and
// every data-name slot any variant makes, has a plain name that is not its key.
it.each(Object.keys(WIDGETS))('names every %s param and data name in plain words', type => {
  const m = WIDGETS[type], unnamed: string[] = []
  for (const p of m.params) for (const q of [p, ...(p.type === 'list' ? p.item : [])])
    if (!q.name?.trim() || q.name === q.key) unnamed.push(q.key)
  for (const over of variants(type)) {
    const w = instance(type, over)
    for (const s of m.expand(w.params, t, w.uid).slots) {
      const name = m.slotName?.(s.slot, w.params)
      if (!name?.trim() || name === s.slot) unnamed.push(s.slot)
    }
  }
  expect([...new Set(unnamed)]).toEqual([])
})
