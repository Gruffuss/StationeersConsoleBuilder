// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Box } from '../editor/geometry'
import type { Scene, SrcNode } from '../model/scene'
import type { Selection } from '../model/store'
import { node } from '../model/testing'
import type { Checked } from '../srctext/check'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { expandRoot, putWidget, widgetOf } from '../widgets/core'
import { box, KEYS, oneLine } from '../widgets/paint'
import { WIDGETS } from '../widgets/registry'
import { clipProbe, instance } from '../widgets/testing'
import { rootBoxes } from './bounds'
import { membersOf } from './ctx'
import { nodeAt } from '../model/store'
import { moveUnits, unitsOf } from './units'
import { linksOf } from '../theme/links'
import { COMMANDS, commandsOf } from './registry'
import { cornersOf, handleAt } from './select'
import { harness } from './testing'

const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
const at = (...path: number[]): Selection => ({ pageId: 'p1', path })
const empty: Scene = { header: { w: 460, h: 460 }, defs: [], root: [] }   // one unit per px
const BAR = instance('bar', { x: 100, y: 100, w: 200, h: 30 })
const page = (scene: Scene, sel: Selection[] = [at(0)]) =>
  harness(scene, { sel: sel.at(-1) ?? null, also: sel.slice(0, -1), verdict: ok, pick: px => px.x < 400 ? at(0) : null })
const params = (n: SrcNode) => widgetOf(n, t)!.params
const run = (h: ReturnType<typeof harness>, id: string) => commandsOf(h.ctx).find(c => c.id === id)!.run(h.ctx)
beforeAll(() => { WIDGETS.clipprobe = clipProbe })
afterAll(() => { delete WIDGETS.clipprobe })

describe('widget roots on the canvas', () => {
  it('moves and resizes an already rotated widget through the handles shown, retaining its rotation', () => {
    const w = { ...BAR, edit: { v: 1 as const, parts: {}, root: { r: 90, a: [200, 115] as [number, number] } } }
    const h = page(putWidget(empty, w, t))
    h.ctx.setSettings({ snap: false })
    const before = cornersOf(h.scene(), [0], { w: 460, h: 460 }, t)!
    h.drag({ x: 200, y: 150 }, { x: 210, y: 170 })
    const after = cornersOf(h.scene(), [0], { w: 460, h: 460 }, t)!
    expect(after[0][0] - before[0][0]).toBeCloseTo(10)
    expect(after[0][1] - before[0][1]).toBeCloseTo(20)
    expect(widgetOf(h.root()[0], t)?.edit?.root?.r).toBe(90)
    const se = after[2]
    h.drag({ x: se[0], y: se[1] }, { x: se[0] - 20, y: se[1] + 40 }, { ctrlKey: true })
    expect(params(h.root()[0])).toMatchObject({ w: 240, h: 50 })
    expect(cornersOf(h.scene(), [0], { w: 460, h: 460 }, t)![0][0]).toBeCloseTo(after[0][0])
    expect(cornersOf(h.scene(), [0], { w: 460, h: 460 }, t)![0][1]).toBeCloseTo(after[0][1])
  })
  it('hides a widget root, keeps hide through parameter edits and shows it again', async () => {
    const h = page(putWidget(empty, BAR, t))
    await run(h, 'hide')
    expect(widgetOf(h.root()[0], t)?.edit?.root?.v).toBe(0)
    h.ctx.dispatch({ type: 'setWidget', pageId: 'p1', ref: { ...BAR, params: { ...BAR.params, w: 220 } } })
    expect(h.root()[0].attrs.v).toBe(0)
    await run(h, 'hide')
    expect(h.root()[0].attrs.v).toBeUndefined()
  })
  it('copies and duplicates widget overrides with fresh uids', async () => {
    const over = { ...BAR, edit: { v: 1 as const, parts: { body: { attrs: { f: '#123456' } } } } }
    const h = page(putWidget(empty, over, t))
    await run(h, 'duplicate')
    expect(widgetOf(h.root()[1], t)?.edit).toEqual(over.edit)
    expect(widgetOf(h.root()[1], t)?.uid).not.toBe(BAR.uid)
    await run(h, 'copy'); await run(h, 'paste')
    expect(widgetOf(h.root()[2], t)?.edit).toEqual(over.edit)
    expect(widgetOf(h.root()[2], t)?.uid).not.toBe(widgetOf(h.root()[1], t)?.uid)
  })
  it('moves an entered title by 4, 2, follows a widget move and pastes styles as literals', async () => {
    const w = instance('panel'), scene = putWidget(empty, w, t), p = [0, ...expandRoot(w, t).exp.parts!.title]
    const h = page(scene), before = nodeAt(scene.root, p)!
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'select', selection: at(...p) })
    const moved = moveUnits(h.scene(), unitsOf(h.scene(), [at(...p)], t), [{ dx: 4, dy: 2 }], t)
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: moved.scene })
    expect(widgetOf(h.root()[0], t)?.edit?.parts.title).toMatchObject({ dx: 4, dy: 2 })
    await run(h, 'style.copy')
    h.ctx.clip.style!.attrs.f = '#123456'
    await run(h, 'style.paste')
    expect(widgetOf(h.root()[0], t)?.edit?.parts.title.attrs?.f).toBe('#123456')
    const fresh = widgetOf(h.root()[0], t)!
    h.ctx.dispatch({ type: 'setWidget', pageId: 'p1', ref: { ...fresh, params: { ...fresh.params, x: (fresh.params.x as number) + 10 } } })
    expect(nodeAt(h.root(), p)!.attrs.x).toBe((before.attrs.x as number) + 14)
    expect(nodeAt(h.root(), p)!.attrs.y).toBe((before.attrs.y as number) + 2)
    await run(h, 'style.text.panel-title')
    expect(linksOf(nodeAt(h.root(), p)!)).toEqual({})
    expect(widgetOf(h.root()[0], t)?.edit?.parts.title.attrs).toBeDefined()
  })
  it('never reselects an untagged plate inside an entered widget, including a restored deeper selection', () => {
    const w = instance('button'), s = putWidget(empty, w, t), h = harness(s, { pick: () => at(0, 0) })
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'select', selection: at(0, 0) })
    expect(h.ctx.pick({ x: 30, y: 30 })).toEqual({ target: at(0) })
  })
  it('a selection inside a widget snaps to its root, alone or in a set', () => {
    const h = page(putWidget({ ...empty, root: [node('R')] }, BAR, t), [])
    h.ctx.dispatch({ type: 'select', selection: at(1, 0), also: [at(0)] })
    expect(h.state()).toMatchObject({ selection: at(1), also: [at(0)] })
  })
  it('a drag moves a widget by its params in whole units; it stays a widget', () => {
    const h = page(putWidget(empty, BAR, t))
    h.drag({ x: 150, y: 110 }, { x: 160.4, y: 110 })
    expect(params(h.root()[0])).toMatchObject({ x: 110, y: 100, w: 200, h: 30 })
    expect(h.state().past).toHaveLength(1)
  })
  it('its module\'s handles resize its params in whole units; its root also has a knob; a light has no resize handles', () => {
    const h = page(putWidget(empty, BAR, t))
    h.drag({ x: 300, y: 115 }, { x: 320.4, y: 115 })
    expect(params(h.root()[0])).toMatchObject({ x: 100, w: 220 })
    expect(handleAt(putWidget(empty, BAR, t), at(0), { w: 460, h: 460 }, 1, { x: 200, y: 76 }, t)).toBe('rotate')
    const light = page(putWidget(empty, instance('light', { x: 100, y: 100 }), t))
    light.drag({ x: 109, y: 109 }, { x: 129, y: 109 })
    expect(params(light.root()[0])).toMatchObject({ x: 120, y: 100 })
  })
  it('nudges and aligns a widget by its params', async () => {
    const h = page(putWidget({ ...empty, root: [node('R', { x: 0, y: 0, w: 10, h: 10 })] }, BAR, t), [at(0), at(1)])
    await run(h, 'align.left')
    expect(params(h.root()[1]).x).toBe(0)
    await run(h, 'nudge.ArrowRight.big')
    await run(h, 'nudge.ArrowDown')
    expect(params(h.root()[1])).toMatchObject({ x: 10, y: 101 })
    expect(h.root()[1].attrs).toEqual({ id: 'bar1' })   // no t on the root: the marker holds the place
  })
  it('a resize moves only the dragged edge, to a whole unit: a fractional edge that stays stays', () => {
    const h = page(putWidget(empty, instance('bar', { x: 100.5, y: 100, w: 200, h: 30 }), t))
    h.drag({ x: 300.5, y: 115 }, { x: 320.9, y: 115 })   // e: the right edge to 321
    expect(params(h.root()[0])).toMatchObject({ x: 100.5, y: 100, w: 220.5, h: 30 })
  })
  it('Shift keeps the ratio only for a module with corners; a width-only one offers e and w alone', () => {
    const bar = page(putWidget(empty, BAR, t))
    bar.drag({ x: 300, y: 130 }, { x: 320, y: 130 }, { shiftKey: true })   // se, the ratio kept: 220 x 33
    expect(params(bar.root()[0])).toMatchObject({ x: 100, y: 100, w: 220, h: 33 })
    const ro = putWidget(empty, instance('readout', { x: 100, y: 100, w: 200 }), t), p = params(ro.root[0]) as { h: number }
    const mid = 100 + p.h / 2, rect = { w: 460, h: 460 }
    expect([handleAt(ro, at(0), rect, 1, { x: 300, y: mid }, t), handleAt(ro, at(0), rect, 1, { x: 200, y: 100 }, t),
      handleAt(ro, at(0), rect, 1, { x: 300, y: 100 + p.h }, t)]).toEqual(['e', null, null])
    const h = page(ro)
    h.drag({ x: 300, y: mid }, { x: 340, y: mid }, { shiftKey: true })
    expect(params(h.root()[0])).toMatchObject({ x: 100, y: 100, w: 240, h: p.h })
  })
  it('a locked widget root neither moves nor resizes, and says so', async () => {
    const h = page(putWidget(empty, BAR, t))
    await run(h, 'lock')
    const before = h.scene()
    h.drag({ x: 300, y: 115 }, { x: 320, y: 115 })
    expect([h.scene(), h.status()]).toEqual([before, 'locked'])
    h.drag({ x: 150, y: 110 }, { x: 170, y: 110 })
    expect([h.scene(), h.status()]).toEqual([before, '1 skipped: locked'])
  })
  it('outlines a widget root in a set by its params box', () => {
    const s = putWidget({ ...empty, root: [node('R', { x: 0, y: 0, w: 10, h: 10 })] }, BAR, t)
    expect(cornersOf(s, [1], { w: 460, h: 460 }, t)).toEqual([[100, 100], [300, 100], [300, 130], [100, 130]])
  })
  describe('a resize at the module\'s minimum (ported from M2b\'s Handles test)', () => {
    // A probe module as M2b's: the light, resizable both ways, at least 36 units each way.
    beforeAll(() => {
      WIDGETS.pa = { ...WIDGETS.light, type: 'pa', prefix: 'pa', resize: 'both',
        params: [...box().map(q => q.key === 'w' || q.key === 'h' ? { ...q, min: 36 } : q), KEYS] }
    })
    afterAll(() => { delete WIDGETS.pa })
    const handles = { w: { x: 100, y: 150 }, s: { x: 150, y: 200 }, ne: { x: 200, y: 100 } }
    const resized = (handle: keyof typeof handles, dx: number, dy: number) => {
      const h = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t)), p = handles[handle]
      h.drag(p, { x: p.x + dx, y: p.y + dy })
      return params(h.root()[0])
    }
    it('stops at the minimum size with the opposite edge where it was, never crossing over', () => {
      expect(resized('w', 90, 0)).toMatchObject({ x: 164, y: 100, w: 36, h: 100 })    // the east edge stays at 200
      expect(resized('s', 0, -80)).toMatchObject({ x: 100, y: 100, w: 100, h: 36 })   // the north edge stays at 100
      expect(resized('ne', -300, 300)).toMatchObject({ x: 100, y: 164, w: 36, h: 36 })
      expect(resized('w', 150, 0)).toMatchObject({ x: 164, y: 100, w: 36, h: 100 })   // past the east edge: no flip
      const alt = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      alt.drag({ x: 200, y: 150 }, { x: 110, y: 150 }, { altKey: true })   // Alt+e past the centre: about the centre, at 36
      expect(params(alt.root()[0])).toMatchObject({ x: 132, y: 100, w: 36, h: 100 })
      const bar = page(putWidget(empty, BAR, t))   // a Bar has no minimum: past the east edge it stops one unit wide
      bar.drag({ x: 100, y: 115 }, { x: 350, y: 115 })
      expect(params(bar.root()[0])).toMatchObject({ x: 299, y: 100, w: 1, h: 30 })
    })
    it('with Shift on a side handle dragged past the opposite edge, the lead stops at the minimum and the other axis follows it', () => {
      // Ruling (Wave 3): the ratio holds, the follower about its middle; it was [100, -300, 36, 900].
      const sq = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      sq.drag({ x: 200, y: 150 }, { x: -800, y: 150 }, { shiftKey: true })   // e, 1000 to the left
      expect(params(sq.root()[0])).toMatchObject({ x: 100, y: 132, w: 36, h: 36 })
      // 2:1: the follower's own minimum (36 tall) holds the lead at 72 wide.
      const wide = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 200, h: 100 }), t))
      wide.drag({ x: 300, y: 150 }, { x: -700, y: 150 }, { shiftKey: true })
      expect(params(wide.root()[0])).toMatchObject({ x: 100, y: 132, w: 72, h: 36 })
    })
    it('with Shift, each axis keeps its own minimum: the lead is held where the follower reaches its own (n, e and a corner)', () => {
      // A probe with unequal minimums: at least 40 wide and 20 tall.
      WIDGETS.pq = { ...WIDGETS.pa, type: 'pq', prefix: 'pq',
        params: [...box().map(q => q.key === 'w' ? { ...q, min: 40 } : q.key === 'h' ? { ...q, min: 20 } : q), KEYS] }
      try {
        const n = page(putWidget(empty, instance('pq', { x: 100, y: 100, w: 100, h: 100 }), t))
        n.drag({ x: 150, y: 100 }, { x: 150, y: 900 }, { shiftKey: true })   // n past the bottom: h leads, held at 40 by w's 40
        expect(params(n.root()[0])).toMatchObject({ x: 130, y: 160, w: 40, h: 40 })
        const e = page(putWidget(empty, instance('pq', { x: 100, y: 100, w: 200, h: 50 }), t))
        e.drag({ x: 300, y: 125 }, { x: -700, y: 125 }, { shiftKey: true })   // 4:1, e past the west edge: h's 20 holds w at 80
        expect(params(e.root()[0])).toMatchObject({ x: 100, y: 115, w: 80, h: 20 })
      } finally { delete WIDGETS.pq }
      // A corner dragged far past one side and a little out on the other: the far side leads (stopped at the minimum),
      // so the box shrinks to it instead of growing with the other side.
      const se = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      se.drag({ x: 200, y: 200 }, { x: -800, y: 350 }, { shiftKey: true })
      expect(params(se.root()[0])).toMatchObject({ x: 100, y: 100, w: 36, h: 36 })
    })
    it('with Shift and snap, the snap acts where the pointer is, not at the stopped edge; a lead that crossed snaps nowhere', () => {
      // An R's left edge at 139 is 3 units from where the stopped east edge (136) would be; the pointer is 900 away.
      const s = putWidget({ ...empty, root: [node('R', { x: 139, y: 400, w: 10, h: 10 })] }, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t)
      const h = page(s, [at(1)])
      h.drag({ x: 200, y: 150 }, { x: -800, y: 150 }, { shiftKey: true })
      expect(params(h.root()[1])).toMatchObject({ x: 100, y: 132, w: 36, h: 36 })
      // Short of the west edge too: the pointer at 120, 19 units from the R, holds the minimum.
      const near = page(s, [at(1)])
      near.drag({ x: 200, y: 150 }, { x: 120, y: 150 }, { shiftKey: true })
      expect(params(near.root()[1])).toMatchObject({ x: 100, y: 132, w: 36, h: 36 })
      // A corner whose lead crossed: an R's top 3 units below where the free box's bottom would be pulls nothing.
      const c = page({ ...s, root: [node('R', { x: 300, y: 143, w: 10, h: 10 }), s.root[1]] }, [at(1)])
      c.drag({ x: 200, y: 200 }, { x: 60, y: 250 }, { shiftKey: true })   // se: x 40 past the west edge, y 50 out
      expect(params(c.root()[1])).toMatchObject({ x: 100, y: 100, w: 36, h: 36 })
      // Above the minimum the snap works from the pointer's own box: an R at 143 is 11 from the pointer at 132 (out of
      // reach; it is 7 from the stopped edge at 136), and an R at 137 is 7 from the pointer at 130 (the offset goes onto
      // the pointer's travel, not the stopped box's).
      const far = page({ ...s, root: [node('R', { x: 143, y: 400, w: 10, h: 10 }), s.root[1]] }, [at(1)])
      far.drag({ x: 200, y: 150 }, { x: 132, y: 150 }, { shiftKey: true })
      expect(params(far.root()[1])).toMatchObject({ x: 100, y: 132, w: 36, h: 36 })
      const pull = page({ ...s, root: [node('R', { x: 137, y: 400, w: 10, h: 10 }), s.root[1]] }, [at(1)])
      pull.drag({ x: 200, y: 150 }, { x: 130, y: 150 }, { shiftKey: true })
      expect(params(pull.root()[1])).toMatchObject({ w: 37, h: 37 })
    })
    it('with Shift and snap, a corner whose follower is dragged past its anchor snaps as it did, never to the minimum', () => {
      // nw: x 158 out leads, y 130 in follows on its own side to 258. A follower flipped past the bottom would put its edge
      // 2 from the page's bottom (460); snapped there it led and collapsed the widget to 36 x 36.
      const nw = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      nw.drag({ x: 100, y: 100 }, { x: -58, y: 230 }, { shiftKey: true })
      // ne, an R's line near where the flipped follower's edge would be.
      const s = putWidget({ ...empty, root: [node('R', { x: 178, y: 382, w: 29, h: 20 })] }, instance('pa', { x: 200, y: 150, w: 150, h: 60 }), t)
      const ne = page(s, [at(1)])
      ne.drag({ x: 350, y: 150 }, { x: 628, y: 234 }, { shiftKey: true })
      expect([params(nw.root()[0]), params(ne.root()[1])])
        .toMatchObject([{ x: -58, y: -58, w: 258, h: 258 }, { x: 200, y: 39, w: 428, h: 171 }])
      // se: y 153 out leads, x 128 in follows on its own side to 253 wide, its east edge 2 short of an R's left edge (355).
      // The snap hands the lead to x and adds its 2 to the edges' travel taken from the box it snapped; taken from the
      // flipped box (x past its anchor) that travel collapsed the widget to 36 x 36.
      const se = page({ ...empty, root: [node('R', { x: 355, y: 400, w: 10, h: 10 }),
        ...putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t).root] }, [at(1)])
      se.drag({ x: 200, y: 200 }, { x: 72, y: 353 }, { shiftKey: true })
      expect(params(se.root()[1])).toMatchObject({ x: 100, y: 100, w: 255, h: 255 })
    })
    it('with Shift and snap at a low zoom, a lead dragged past the opposite edge snaps nowhere', () => {
      // At zoom 0.1 the snap reaches 80 units. e dragged 400 left: the lead crossed, so the box stays at the minimum about
      // the follower's middle, though an R's left edge (160) is within reach of the stopped east edge (snapped: 60 x 60).
      const h = page({ ...empty, root: [node('R', { x: 160, y: 400, w: 10, h: 10 }),
        ...putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t).root] }, [at(1)])
      h.ctx.setView({ zoom: 0.1, pan: { x: 0, y: 0 } })
      h.drag({ x: 200, y: 150 }, { x: -200, y: 158 }, { shiftKey: true })
      expect(params(h.root()[1])).toMatchObject({ x: 100, y: 132, w: 36, h: 36 })
    })
    it('with Shift and snap, the pointer picks the lead, not the travel of the box it snapped', () => {
      // se: x 300 out (3x), y 150 up past the top (1.5x): x leads and y follows it down from the top edge.
      const h = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      h.drag({ x: 200, y: 200 }, { x: 500, y: 50 }, { shiftKey: true })
      expect(params(h.root()[0])).toMatchObject({ x: 100, y: 100, w: 400, h: 400 })
      const off = page(putWidget(empty, instance('pa', { x: 100, y: 100, w: 100, h: 100 }), t))
      off.drag({ x: 200, y: 200 }, { x: 500, y: 50 }, { shiftKey: true, ctrlKey: true })
      expect(params(off.root()[0])).toMatchObject({ x: 100, y: 100, w: 400, h: 400 })
    })
    it('keeps the opposite edge where the module\'s fix holds the size (a Button: one line of its label)', () => {
      const h = page(putWidget(empty, instance('button', { x: 100, y: 100, w: 120, h: 60 }), t))
      h.drag({ x: 160, y: 100 }, { x: 160, y: 150 })   // n: 50 down asks for 10 tall
      const p = params(h.root()[0]) as Box
      expect(p.h).toBeCloseTo(oneLine(t, 'button-label'), 4)
      expect([p.x, p.w, p.y + p.h]).toEqual([100, 120, expect.closeTo(160, 4)])   // the bottom where it was
      const done = h.state().project, before = h.actions.length
      h.drag({ x: 160, y: p.y }, { x: 160, y: p.y + 25 })   // at its minimum already: nothing changes, nothing is written
      expect(h.state().project).toBe(done)
      expect(h.actions.slice(before).filter(a => a.type === 'editScene')).toEqual([])
    })
  })
  it('a resize snaps the dragged edge to another node\'s edge, never to the widget\'s own', () => {
    const s = putWidget(empty, BAR, t), h = page({ ...s, root: [...s.root, node('R', { x: 323, y: 100, w: 10, h: 10 })] })
    h.drag({ x: 300, y: 115 }, { x: 320.4, y: 115 })   // e: the right edge 2.6 short of the R's left edge
    expect(params(h.root()[0])).toMatchObject({ x: 100, y: 100, w: 223, h: 30 })
    const own = page(putWidget(empty, BAR, t))
    own.drag({ x: 300, y: 115 }, { x: 305, y: 115 })   // its own right edge (at 300 before the drag) is no target
    expect(params(own.root()[0])).toMatchObject({ x: 100, w: 205 })
  })
  it('with Shift, a snap on the axis that follows lands that edge on its line (the snap adds to the edges\' own travel)', () => {
    // Shift on se: the pointer drags x 24 right, so y follows to 33.6 tall (the bottom at 133.6); the R's bottom at 133 is
    // the nearest line, so y leads: the bottom lands on 133 and x follows to 220 wide. Added to the pointer's travel
    // instead, the snap's -0.6 would give 197 x 30.
    const s = putWidget(empty, BAR, t), h = page({ ...s, root: [...s.root, node('R', { x: 0, y: 0, w: 10, h: 133 })] })
    h.drag({ x: 300, y: 130 }, { x: 324, y: 130.2 }, { shiftKey: true })
    expect(params(h.root()[0])).toMatchObject({ x: 100, y: 100, w: 220, h: 33 })
  })
  it('Shift+click on a widget in the set takes it out, wherever inside it the press lands', () => {
    const s = putWidget(putWidget(empty, BAR, t), instance('bar', { x: 100, y: 200 }, 'bar2'), t)
    const h = harness(s, { sel: at(1), also: [at(0)], verdict: ok, pick: () => at(0, 0) })   // the node drawn: inside bar1
    h.click({ x: 150, y: 110 }, { shiftKey: true })
    expect([h.state().selection, h.state().also]).toEqual([at(1), []])
    h.click({ x: 150, y: 110 }, { shiftKey: true })
    expect([h.state().selection, h.state().also]).toEqual([at(0), [at(1)]])
  })
  it('the points tool on a widget hands over to select: a widget\'s nodes are its params\'', () => {
    const s = putWidget(empty, instance('glyph', { x: 100, y: 100, glyph: 'arrow' }), t)
    const y = s.root[0].c!.findIndex(n => n.op === 'Y')
    expect(y).toBeGreaterThanOrEqual(0)
    const h = harness(s, { verdict: ok, pick: () => at(0, y) })   // the arrow's Y, drawn under the pointer
    h.ctx.setTool('points')
    h.click({ x: 105, y: 105 })
    expect([h.state().selection, h.ctx.tool(), h.scene()]).toEqual([at(0), 'select', s])
  })
})

describe('widget roots in the commands', () => {
  it('Delete removes a widget with its own defs', async () => {
    const h = page(putWidget(empty, instance('clipprobe'), t))
    expect(h.scene().defs.map(d => d.attrs.id)).toContain('duct1_clip')
    await run(h, 'delete')
    expect(h.root()).toEqual([])
    expect(h.scene().defs.some(d => String(d.attrs.id).startsWith('duct1_'))).toBe(false)
  })
  it('Delete leaves a def a widget owns, and says so: it goes with its widget', async () => {
    const s = putWidget({ ...empty, defs: [node('CP', { id: 'mine' })] }, instance('clipprobe'), t)
    const k = s.defs.findIndex(d => d.attrs.id === 'duct1_clip'), mine = { pageId: 'p1', path: [0], inDefs: true }
    const h = page(s, [{ pageId: 'p1', path: [k], inDefs: true }])
    await run(h, 'delete')
    expect([h.scene(), h.status()]).toEqual([s, '1 skipped: a widget\'s own def goes with its widget'])
    const other = page(s, [mine])
    await run(other, 'delete')
    expect(other.scene().defs.map(d => d.attrs.id)).toEqual(['duct1_clip'])
  })
  it('Delete drops the preview values only its slots read, in the same undo step, as the store\'s deleteWidget does', async () => {
    const h = page(putWidget({ ...empty, root: [node('R', { x: 0, y: 0, w: 10, h: 10 })] }, instance('light'), t), [at(0), at(1)])
    h.ctx.dispatch({ type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 })
    h.ctx.dispatch({ type: 'setPreview', pageId: 'p1', key: 'other', value: 1 })
    const before = h.state().project
    await run(h, 'delete')
    expect([h.root(), h.ctx.page().preview]).toEqual([[], { other: 1 }])
    h.ctx.dispatch({ type: 'undo' })
    expect(h.state().project).toBe(before)
  })
  it('Duplicate and paste give a widget a new uid and its params +10, still a widget', async () => {
    const h = page(putWidget(empty, BAR, t))
    await run(h, 'duplicate')
    expect(widgetOf(h.root()[1], t)).toMatchObject({ uid: 'bar2', params: { x: 110, y: 110 } })
    await run(h, 'copy')
    await run(h, 'paste')
    expect(widgetOf(h.root()[2], t)).toMatchObject({ uid: 'bar3', params: { x: 120, y: 120 } })
    // The copy's text carries no def of the widget's own (its nodes do name bar2_ data: $bar2_lvl); the paste makes its own.
    const d = page(putWidget(empty, instance('duct'), t))
    await run(d, 'copy')
    await run(d, 'paste')
    expect(d.ctx.clip.text).not.toContain('CP id=duct1_clip')
    expect(d.scene().defs).toEqual([])
    expect(widgetOf(d.root()[1], t)?.uid).toBe('duct2')
  })
  it('Duplicate gives two copies two uids, on top in their originals\' order, each with what stands above its marker', async () => {
    const h = page(putWidget(putWidget(empty, BAR, t), instance('bar', { x: 0, y: 0 }, 'bar2'), t), [at(1), at(0)])
    await run(h, 'lock')
    await run(h, 'duplicate')
    expect(h.root().map(n => widgetOf(n, t)?.uid)).toEqual(['bar1', 'bar2', 'bar3', 'bar4'])
    expect(h.root().map(n => n.comments![0])).toEqual(['lock', 'lock', 'lock', 'lock'])   // a # lock rides with a copy (R7)
    expect(params(h.root()[3])).toMatchObject({ x: 10, y: 10 })
    expect([...h.state().also, h.state().selection].map(x => x!.path)).toEqual([[2], [3]])
  })
  it('Delete removes a selected native; arrange commands also act on it (R10)', async () => {
    const h = page(empty, [])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })   // selects it
    expect(h.state().selection).toMatchObject({ path: [], native: 'ico1' })
    expect(membersOf(h.ctx)).toEqual([])
    expect(COMMANDS.find(c => c.id === 'hide')!.when(h.ctx)).toBe(true)
    expect(COMMANDS.find(c => c.id === 'duplicate')!.when(h.ctx)).toBe(true)
    await run(h, 'delete')
    expect(h.ctx.page().natives ?? []).toHaveLength(0)
  })
  it('groups widgets and refuses ungrouping a widget root; hides and locks it with the marker kept last; style paste skips it', async () => {
    const h = page(putWidget({ ...empty, root: [node('R', { f: '#f00' })] }, BAR, t), [at(0), at(1)])
    await run(h, 'group')
    expect(widgetOf(h.root()[0].c![1], t)?.uid).toBe('bar1')
    await run(h, 'ungroup')
    await run(h, 'hide')
    expect(h.root()[1].attrs.v).toBe(0)
    await run(h, 'lock')
    expect(h.root()[1].comments!.at(-1)).toMatch(/^widget bar bar1 /)
    expect(widgetOf(h.root()[1], t)).not.toBeNull()
    h.ctx.dispatch({ type: 'select', selection: at(1) })
    await run(h, 'style.copy')
    expect([h.status(), h.ctx.clip.style]).toEqual(['a widget\'s look is its params', null])
    h.ctx.dispatch({ type: 'select', selection: at(0) })
    await run(h, 'style.copy')
    h.ctx.dispatch({ type: 'select', selection: at(1) })
    await run(h, 'style.paste')
    expect(h.notes).toContain('1 skipped: a widget\'s look is its params')
    const u = page(putWidget(empty, BAR, t))
    expect(COMMANDS.find(c => c.id === 'ungroup')!.when(u.ctx)).toBe(false)
  })
})

describe('a widget root is boxed by its params for the marquee too, as its outline and handles are', () => {
  it('a marquee that touches its drawn geometry but not its params box leaves it out', () => {
    const scene = putWidget(empty, instance('toggle', { x: 100, y: 100 }), t), p = params(scene.root[0]) as Box, g = rootBoxes(scene)[0]!
    expect(g.x).toBeLessThan(p.x)   // the toggle draws outside its params box
    const h = harness(scene, { verdict: ok, pick: () => null }), y = p.y + p.h / 2
    h.drag({ x: g.x - 30, y }, { x: (g.x + p.x) / 2, y: y + 1 })
    expect(h.state().selection).toBeNull()
    h.drag({ x: g.x - 30, y }, { x: p.x + 1, y: y + 1 })
    expect(h.state().selection).toEqual(at(0))
  })
})

describe('show all and unlock all leave the nodes of a widget to its module', () => {
  it('touch only the root of a widget: what is under it is its expansion, and an edit there detaches it at the next load', async () => {
    const w = putWidget(empty, BAR, t), root = w.root[0], kid = root.c![0]
    const odd = { ...root, comments: ['lock', ...root.comments!], c: [{ ...kid, attrs: { ...kid.attrs, v: 0 }, comments: ['lock'] }, ...root.c!.slice(1)] }
    const h = page({ ...w, root: [odd, node('R', { v: 0 })] }, [])
    await run(h, 'showAll')
    await run(h, 'unlockAll')
    expect(h.root()[0].c![0]).toBe(odd.c![0])
    expect([h.root()[0].comments![0], h.root()[1].attrs.v]).toEqual([odd.comments!.at(-1), undefined])
  })
})

// Q14: a uid is one in the project. An id a copy gives (a node's, a def's, a CP copied with it) never takes a native's uid,
// and one whose stem is a widget's or a native's uid goes to <uid>copy<k>_, as reassociate names a copy's defs: otherwise
// the next load drops the native, or takes the copy for the widget's own and detaches the widget.
describe('ids a copy gives (Q14)', () => {
  const ids = (s: Scene) => [...s.defs, ...s.root].map(n => n.attrs.id).filter(id => typeof id === 'string' && /^(ico|duct)/.test(id))
  const reload = (h: ReturnType<typeof harness>) => { h.ctx.dispatch({ type: 'loadProject', project: h.state().project }); return h.state().notice }
  const plainIco = { ...empty, root: [node('R', { id: 'ico1', x: 0, y: 0, w: 5, h: 5 })] }
  const hand = node('G', { clip: 'duct1_clip' }, [node('R', { x: 0, y: 0, w: 5, h: 5 })])   // a node written by hand clipped to the widget's def
  it('Duplicate takes no native\'s uid: the next load keeps the native', async () => {
    const h = page(plainIco, [])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    expect(h.ctx.page().natives!.map(n => n.uid)).toEqual(['ico2'])   // allocUid passes over the plain ico1
    h.ctx.dispatch({ type: 'select', selection: at(0) })
    await run(h, 'duplicate')
    expect(ids(h.scene())).toEqual(['ico1', 'ico3'])
    expect([reload(h), h.ctx.page().natives!.map(n => n.uid)]).toEqual(['', ['ico2']])
  })
  it('Paste takes no native\'s uid', async () => {
    const h = page(plainIco, [])
    h.ctx.dispatch({ type: 'insertWidget', pageId: 'p1', widget: 'icon' })
    h.ctx.dispatch({ type: 'select', selection: at(0) })
    await run(h, 'copy')
    await run(h, 'paste')
    expect(ids(h.scene())).toEqual(['ico1', 'ico3'])
    expect([reload(h), h.ctx.page().natives!.map(n => n.uid)]).toEqual(['', ['ico2']])
  })
  it('Duplicate copies a clip the widget owns under <uid>copy<k>_: the widget stays one, and the copy deletes', async () => {
    const h = page(putWidget({ ...empty, root: [hand] }, instance('clipprobe'), t), [at(0)])
    await run(h, 'duplicate')
    expect(ids(h.scene())).toEqual(['duct1_clip', 'duct1copy1_clip', 'duct1'])
    expect(h.root()[1].attrs.clip).toBe('duct1copy1_clip')
    expect(reload(h)).toBe('')
    expect(widgetOf(h.root()[2], t)?.uid).toBe('duct1')
    const k = h.scene().defs.findIndex(d => d.attrs.id === 'duct1copy1_clip')
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [k], inDefs: true } })
    await run(h, 'delete')
    expect(ids(h.scene())).toEqual(['duct1_clip', 'duct1'])
  })
  it('Paste onto an earlier page renames a def the widget owns to <uid>copy<k>_: the widget stays one at the next load', async () => {
    const h = page(empty, [])
    h.ctx.dispatch({ type: 'addPage' })   // p2, now active
    h.ctx.dispatch({ type: 'setScene', pageId: 'p2', scene: putWidget({ ...empty, root: [hand] }, instance('clipprobe'), t) })
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p2', path: [0] } })
    await run(h, 'copy')
    h.ctx.dispatch({ type: 'setActivePage', pageId: 'p1' })
    await run(h, 'paste')
    expect(ids(h.scene())).toEqual(['duct1copy1_clip'])
    expect(h.root()[0].attrs.clip).toBe('duct1copy1_clip')
    expect(reload(h)).toBe('')
    expect(widgetOf(h.state().project.pages[1].scene.root[1], t)?.uid).toBe('duct1')
  })
})
