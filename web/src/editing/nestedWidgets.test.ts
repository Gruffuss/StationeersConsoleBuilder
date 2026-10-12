// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { namesOf } from '../codegen/names'
import { clickTargets } from '../codegen/clicks'
import { previewData } from '../codegen/lua'
import { generate } from '../codegen/generate'
import { printChecked } from '../srctext/print'
import { newProject } from '../model/project'
import { nodeAt } from '../model/store'
import { node } from '../model/testing'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { expandRoot, widgetAt, widgetsIn } from '../widgets/core'
import { clipProbe, instance, sceneOf } from '../widgets/testing'
import { WIDGETS } from '../widgets/registry'
import { apply, bounds } from '../editor/geometry'
import { handleFrame } from './select'
import { allBoxes, worldOf } from './bounds'
import { widgetBoxes } from '../editor/Handles'
import { copyText, idsIn, pasteText, uidOn } from './clipboard'
import { reparent } from './reparent'
import { unitsOf, moveUnits } from './units'
import { commandsOf } from './registry'
import { harness } from './testing'

const at = (...path: number[]) => ({ pageId: 'p1', path })
const empty = { header: { w: 460, h: 460 }, defs: [], root: [] }
const nested = (type = 'bar') => { const s = sceneOf(instance(type, { x: 20, y: 30, w: 200, h: 54 })); return { ...s, header: empty.header, root: [node('G', { t: [100, 50], r: 30 }, s.root)] } }
const run = (h: ReturnType<typeof harness>, id: string) => commandsOf(h.ctx).find(c => c.id === id)!.run(h.ctx)
beforeAll(() => { WIDGETS.clipprobe = clipProbe })
afterAll(() => { delete WIDGETS.clipprobe })

describe('widgets in ordinary groups: codegen and editing', () => {
  it('resizes a nested widget through its rotated parent, using local whole units', () => {
    const s = nested(), h = harness(s, { sel: at(0,0) }), W = worldOf(s, [0,0])!
    const from = apply(W, 220, 57), to = apply(W, 230, 57)
    h.drag({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }, { ctrlKey: true })
    expect(widgetAt(h.scene(), [0,0], t)?.params).toMatchObject({ x: 20, y: 30, w: 210, h: 54 })
    expect(h.state().past).toHaveLength(1)
  })
  it('nested widget snap targets include its transformed params box', () => {
    const s = nested('panel'), box = unitsOf(s, [at(0,0)], t)[0].box
    expect(allBoxes(s, new Set(), widgetBoxes(s, t))).toContainEqual(box)
  })
  it('groups a shape and widget with its marker, owned defs, slots, plates and preview samples kept', async () => {
    const s = sceneOf(instance('clipprobe')), h = harness({ ...s, root: [node('R', { id: 'raw', w: 10, h: 10 }), ...s.root] }, { sel: at(1), also: [at(0)] })
    await run(h, 'group')
    expect(widgetAt(h.scene(), [0, 1], t)?.uid).toBe('duct1')
    expect(h.scene().defs.map(n => n.attrs.id)).toContain('duct1_clip')
    expect(previewData(h.ctx.page(), t).duct1_run).toBe(1)
    expect(namesOf(h.ctx.page(), t).find(n => n.name === 'duct1_run')).toMatchObject({ widget: 'duct1', slot: 'run' })
    const b = nested('toggle'), p = { ...h.ctx.page(), scene: b }
    expect(clickTargets(p, t)).toContainEqual(expect.objectContaining({ id: 'tg1_hit', widget: 'tg1', step: 'toggle' }))
  })
  it('exports nested widgets as slots with samples and retains the parent transform', () => {
    const h = harness(nested()), page = h.ctx.page()
    expect(namesOf(page, t).find(n => n.name === 'bar1_lvl')).toMatchObject({ kind: 'number', snap: false, widget: 'bar1', travel: 200 })
    expect(previewData(page, t).bar1_lvl).toBe(0.62)
    const g = generate(h.state().project, p => printChecked(p.scene))
    expect(g.problems.filter(p => p.level === 'error')).toEqual([])
    expect(g.lua).toContain('G t=[100,50] r=30 {')
    expect(g.lua).toContain('bar1_lvl')
  })
  it('moves a nested widget by whole params in its parent frame, and uses transformed params bounds', () => {
    const s = nested(), u = unitsOf(s, [at(0, 0)], t)[0], w = widgetAt(s, [0, 0], t)!, W = worldOf(s, [0, 0])!
    const p = w.params as { x: number; y: number; w: number; h: number }
    const want = bounds([[p.x,p.y], [p.x+p.w,p.y], [p.x+p.w,p.y+p.h], [p.x,p.y+p.h]].flatMap(([x,y]) => apply(W,x,y)))!
    expect(u.box).toEqual(want)
    const moved = moveUnits(s, [u], [{ dx: W[0] * 10, dy: W[1] * 10 }], t)
    expect(widgetAt(moved.scene, [0, 0], t)?.params).toMatchObject({ x: 30, y: 30 })
    expect(moved.skipped).toEqual([])
    const singular = { ...s, root: [node('G', { s: [0, 1] }, s.root[0].c)] }
    expect(moveUnits(singular, unitsOf(singular, [at(0,0)], t), [{ dx: 10, dy: 10 }], t).skipped.join()).toContain('singular')
  })
  it('moves at very large parent scales and keeps a fractional axis still through a rotated parent', () => {
    const base = sceneOf(instance('bar', { x: 100.5, y: 30.5 }))
    const scaled = { ...base, root: [node('G', { s: [1e12, 1e12] }, base.root)] }
    const moved = moveUnits(scaled, unitsOf(scaled, [at(0,0)], t), [{ dx: 100, dy: 0 }], t).scene
    expect(widgetAt(moved, [0,0], t)?.params).toMatchObject({ x: 101, y: 30.5 })
    const turned = { ...base, root: [node('G', { r: 30 }, base.root)] }, W = worldOf(turned, [0,0])!
    const across = moveUnits(turned, unitsOf(turned, [at(0,0)], t), [{ dx: W[0] * 10, dy: W[1] * 10 }], t).scene
    expect(widgetAt(across, [0,0], t)?.params).toMatchObject({ x: 111, y: 30.5 })
  })
  it('ungroups a translated ordinary parent without changing the widget or its world frame', async () => {
    const s = nested('toggle'); delete s.root[0].attrs.r
    s.root[0].c!.push(node('R', { w: 10, h: 10 }))
    const h = harness(s, { sel: at(0) }), before = handleFrame(s, [0,0], { w: 460, h: 460 }, t)!
    await run(h, 'ungroup')
    expect(h.state().past).toHaveLength(1)
    const widget = widgetsIn(h.scene(), t)[0]
    expect(widget.ref).toEqual(widgetAt(s, [0,0], t))
    const after = handleFrame(h.scene(), widget.path, { w: 460, h: 460 }, t)!
    after.chain.forEach((v, i) => expect(v).toBeCloseTo(before.chain[i], 5))
  })
  it('copies and pastes a group with a fresh widget uid, overrides, comments and owned defs', () => {
    const s = nested('clipprobe'), child = s.root[0].c![0]
    child.comments!.unshift('lock')
    const p = newProject(); p.theme = t.id; p.pages[0].scene = s
    const out = pasteText(s, copyText(s, s.root, t), idsIn(p, t), 10, 10, t, uidOn(p, 'p1'))
    expect(typeof out).not.toBe('string'); if (typeof out === 'string') return
    const copied = widgetAt(out.scene, [1,0], t)!
    expect(copied).not.toBeNull(); expect(copied.uid).not.toBe('duct1')
    expect(nodeAt(out.scene.root, [1,0])?.comments?.[0]).toBe('lock')
    expect(out.scene.defs.map(n => n.attrs.id)).toContain(`${copied.uid}_clip`)
    expect(nodeAt(out.scene.root, [1,0,0])?.attrs.clip).toBe(`${copied.uid}_clip`)
  })
  it('duplicates a group and a nested widget in their parent, with fresh uids and overrides', async () => {
    const w = { ...instance('panel'), edit: { v: 1 as const, parts: { body: { attrs: { f: '#123456' } } } } }, s = sceneOf(w)
    const h = harness({ ...s, root: [node('G', {}, s.root)] }, { sel: at(0) })
    await run(h, 'duplicate')
    expect(widgetsIn(h.scene(), t).map(w => w.ref.uid)).toEqual(['pnl1', 'pnl2'])
    expect(widgetAt(h.scene(), [1,0], t)?.edit).toEqual(w.edit)
    h.ctx.dispatch({ type: 'select', selection: at(0,0) })
    await run(h, 'duplicate')
    expect(widgetAt(h.scene(), [0,1], t)?.uid).toBe('pnl3')
  })
  it('deleting a group cleans its widgets owned defs and protects a nested widget owned def', async () => {
    const h = harness(nested('clipprobe'), { sel: at(0) })
    await run(h, 'delete')
    expect(h.scene().root).toEqual([]); expect(h.scene().defs).toEqual([])
    const keep = harness(nested('clipprobe'), { sel: { ...at(0), inDefs: true } })
    await run(keep, 'delete')
    expect(keep.scene().defs).toHaveLength(1); expect(keep.notes.join()).toContain('own def')
  })
  it('reparents a widget into an ordinary group, keeps its world bounds, and refuses a widget destination', () => {
    const s = nested(), f = handleFrame(s, [0,0], { w: 460, h: 460 }, t)!
    const out = reparent(s, [[0,0]], { parent: [], index: 1 })
    expect(typeof out).not.toBe('string'); if (typeof out === 'string') return
    const w = widgetsIn(out.scene, t)[0], after = handleFrame(out.scene, w.path, { w: 460, h: 460 }, t)!
    after.chain.forEach((v, i) => expect(v).toBeCloseTo(f.chain[i], 5)); expect(after.box).toEqual(f.box)
    const back = reparent(out.scene, [out.paths[0]], { parent: [0], index: 0 })
    expect(typeof back).not.toBe('string')
    expect(reparent(s, [[0]], { parent: [0,0], index: 0 })).toMatch(/cycle|widget/)
    const other = { ...s, root: [...s.root, node('R', {})] }
    expect(reparent(other, [[1]], { parent: [0,0], index: 0 })).toMatch(/widget/)
    const plain = sceneOf(instance('bar')), direct = { ...plain, root: [node('G', {}, [node('R', {})]), ...plain.root] }
    const into = reparent(direct, [[1]], { parent: [0], index: 1 })
    expect(typeof into).not.toBe('string')
    if (typeof into !== 'string') expect(widgetAt(into.scene, [0,1], t)?.uid).toBe('bar1')
  })
  it('hides nested roots and pastes a literal style into an entered named part', async () => {
    const s = nested('panel'), h = harness(s, { sel: at(0,0) })
    await run(h, 'hide')
    expect(widgetAt(h.scene(), [0,0], t)?.edit?.root?.v).toBe(0)
    await run(h, 'showAll')
    h.ctx.clip.style = { op: 'G', attrs: { f: '#123456' }, links: {} }
    await run(h, 'style.paste')
    expect(h.notes.join()).toContain("a widget's look")
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0,0] })
    const part = [0,0,...expandRoot(widgetAt(h.scene(), [0,0], t)!, t).exp.parts!.body]
    h.ctx.dispatch({ type: 'select', selection: at(...part) })
    h.ctx.clip.style = { op: 'R', attrs: { f: '#123456' }, links: {} }
    await run(h, 'style.paste')
    expect(widgetAt(h.scene(), [0,0], t)?.edit?.parts.body.attrs?.f).toBe('#123456')
  })
})
