// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { node } from '../model/testing'
import type { SrcNode } from '../model/scene'
import type { Selection } from '../model/store'
import type { NativeRef } from '../widgets/types'
import { instance } from '../widgets/testing'
import { COMMANDS } from './registry'
import { harness } from './testing'
import { putWidget } from '../widgets/core'
import { vanillaPlus } from '../theme/vanillaPlus'

afterEach(() => vi.useRealTimers())
const R = (x = 0, more = {}) => node('R', { x, y: 0, w: 10, h: 10, ...more })
const G = (id: string, kids = [R()]) => node('G', id ? { id } : {}, kids)
const ico = (uid = 'ico1', group?: string, more = {}): NativeRef => ({ ...instance('icon', { x: 20, y: 30, w: 10, h: 10 }, uid), ...(group && { group }), ...more })
const at = (path: number[]): Selection => ({ pageId: 'p1', path })
const nat = (uid = 'ico1'): Selection => ({ pageId: 'p1', path: [], native: uid })
const make = (root: SrcNode[], natives = [ico('ico1', 'card')], sels = [at([0])]) => harness({ header: { w: 460, h: 460 }, defs: [], root }, {
  natives, sel: sels.at(-1), also: sels.slice(0, -1), verdict: () => ({ errors: [], warnings: [], src: '', order: { ops: [], nodes: [] } }) })
const run = (h: ReturnType<typeof make>, id: string, arg?: string) => COMMANDS.find(c => c.id === id)!.run(h.ctx, arg)
const refs = (h: ReturnType<typeof make>) => h.ctx.page().natives ?? []

describe('commands carry held natives in one edit', () => {
  it.each(['delete', 'cut'])('%s removes nested held natives and bindings; undo restores both', async id => {
    const h = make([G('outer', [G('card')])])
    h.state().project.bindings['@ico1.name'] = { from: 'x' } as never
    const before = h.state().past.length
    await run(h, id)
    expect(refs(h)).toEqual([]); expect(h.root()).toEqual([])
    expect(h.state().past.length).toBe(before + 1)
    expect(h.state().project.bindings['@ico1.name']).toBeUndefined()
    if (id === 'cut') expect(h.ctx.clip.natives?.[0].ref.uid).toBe('ico1')
    await run(h, 'undo'); expect(refs(h)[0].group).toBe('card'); expect(h.state().project.bindings['@ico1.name']).toBeDefined()
  })
  it('duplicates two holders, including a nested holder, with fresh ids/uids, offsets and flags', async () => {
    const h = make([G('outer', [G('card')]), G('other')], [ico('ico1', 'card', { hidden: true, lock: true }), ico('ico2', 'other')], [at([0]), at([1])])
    await run(h, 'duplicate')
    const copies = refs(h).filter(n => !['ico1', 'ico2'].includes(n.uid))
    expect(new Set(copies.map(n => n.uid)).size).toBe(2)
    expect(copies.map(n => n.group).sort()).toEqual(['card2', 'other2'])
    expect(copies.every(n => n.params.x === 30 && n.params.y === 40)).toBe(true)
    expect(copies.find(n => n.group === 'card2')).toMatchObject({ hidden: true, lock: true })
    expect(h.state().past).toHaveLength(1)
  })
  it('copies/pastes a scaled nested holder using its copied frame, same and other page', async () => {
    const h = make([node('G', { s: [2, 2] }, [G('card')])], [ico('ico1', 'card')], [at([0, 0])])
    await run(h, 'copy'); await run(h, 'paste')
    expect(refs(h)[1]).toMatchObject({ uid: 'ico2', group: 'card2', params: { x: 20, y: 25, w: 5, h: 5 } })
    h.ctx.dispatch({ type: 'addPage' }); await run(h, 'paste')
    expect(refs(h)[0]).toMatchObject({ group: 'card3', params: { x: 10, y: 15, w: 5, h: 5 } })
  })
  it('system text pastes no natives', async () => {
    const h = make([G('card')]); h.ctx.clip.text = 'R x=0 y=0 w=10 h=10'
    await run(h, 'paste'); expect(refs(h)).toHaveLength(1)
  })
  it('drops a missing pasted holder without attaching to an existing holder of that name', async () => {
    const h = make([G('card')])
    h.ctx.clip.text = 'R x=0 y=0 w=10 h=10'
    h.ctx.clip.page = 'p1'
    h.ctx.clip.natives = [{ ref: ico('ico1', 'card'), frame: [1, 0, 0, 1, 0, 0] }]
    await run(h, 'paste')
    expect(refs(h)[1]).toMatchObject({ uid: 'ico2', params: { x: 30, y: 40 } })
    expect(refs(h)[1]).not.toHaveProperty('group')
    expect(refs(h)[0].group).toBe('card')
    expect(h.state().past).toHaveLength(1)
  })
  it.each(['duplicate', 'paste'])('%s gives a numeric-id holder a fresh id and carries its native to the copy', async id => {
    const h = make([node('G', { id: 5 }, [R()])], [ico('ico1', '5')])
    if (id === 'paste') await run(h, 'copy')
    await run(h, id)
    const copied = h.root()[1], ref = refs(h)[1]
    expect(String(copied.attrs.id)).not.toBe('5')
    expect(ref.group).toBe(String(copied.attrs.id)); expect(ref.params).toMatchObject({ x: 30, y: 40 })
    expect(ref.uid).toBe('ico2'); expect(h.state().past).toHaveLength(1)
  })
  it.each(['parent', '', null])('ungroup sends directly held natives to %s without moving them', async id => {
    const nested = id !== null, h = make(nested ? [G(id!, [G('card')])] : [G('card')], undefined, [at(nested ? [0, 0] : [0])])
    await run(h, 'ungroup')
    expect(refs(h)[0]).toMatchObject({ params: { x: 20, y: 30 } })
    expect(refs(h)[0].group).toBe(id === null ? undefined : id || 'group_1')
    expect(h.status()).toContain(id === null ? 'page' : id || 'group_1')
    expect(h.state().past).toHaveLength(1)
  })
  it('group wraps a holder and detach leaves its native unchanged', async () => {
    const ref = ico('ico1', 'card'), h = make([G('card')], [ref])
    await run(h, 'group'); expect(refs(h)[0]).toBe(ref)
    h.ctx.dispatch({ type: 'updateNode', pageId: 'p1', path: [0], node: { ...h.root()[0], attrs: { t: [5, 0] } } })
    expect(refs(h)[0].params.x).toBe(25)
    const w = putWidget({ header: {}, defs: [], root: [] }, instance('panel'), vanillaPlus)
    const d = make([G('card', w.root)], [ref], [at([0, 0])])
    d.ctx.dispatch({ type: 'detachWidget', pageId: 'p1', uid: 'panel1' }); expect(refs(d)[0]).toBe(ref)
  })
})

describe('natives selected themselves and in mixed sets', () => {
  it.each(['front', 'back', 'forward', 'backward'])('%s crosses holder boundaries within the same z band in one undo step', async id => {
    const upward = id === 'front' || id === 'forward'
    const h = make([G('a')], [ico('ico1', 'a'), instance('textinput', {}, 'input1'), ico('ico2')], [nat(upward ? 'ico1' : 'ico2')])
    const before = refs(h)
    await run(h, id)
    expect(refs(h).map(n => n.uid)).toEqual(['ico2', 'input1', 'ico1'])
    expect(refs(h)[2]).toBe(before[0]); expect(refs(h)[0]).toBe(before[2])
    expect(h.state().past).toHaveLength(1)
    await run(h, 'undo'); expect(refs(h)).toEqual(before)
  })
  it.each(['front', 'back', 'forward', 'backward'])('%s reports a native already at the end without making an edit', async id => {
    const upward = id === 'front' || id === 'forward'
    const h = make([G('a')], [ico('ico1', 'a'), ico('ico2')], [nat(upward ? 'ico2' : 'ico1')])
    const before = h.state().project
    await run(h, id)
    expect(h.status()).toContain('nothing moved')
    expect(h.state().project).toBe(before); expect(h.state().past).toHaveLength(0)
  })
  it('deletes a mixed set in one history entry', async () => {
    const h = make([R()], [ico()], [at([0]), nat()]); await run(h, 'delete')
    expect([h.root(), refs(h), h.state().past.length]).toEqual([[], [], 1])
  })
  it('duplicates a native right after its original, retains membership and selects it with copied nodes', async () => {
    const h = make([R(), G('card')], [ico('ico1', 'card'), ico('ico9')], [at([0]), nat()])
    await run(h, 'duplicate')
    expect(refs(h).map(n => n.uid)).toEqual(['ico1', 'ico2', 'ico9'])
    expect(refs(h)[1]).toMatchObject({ group: 'card', params: { x: 30, y: 40 } })
    expect(h.state().selection?.native).toBe('ico2'); expect(h.state().also[0].path).toEqual([1])
    expect(h.state().past).toHaveLength(1)
  })
  it.each([false, true])('copy/paste supports a native clip (mixed=%s), page level and fresh uid', async mixed => {
    const h = make([R(), G('card')], [ico('ico1', 'card')], [...mixed ? [at([0])] : [], nat()])
    await run(h, 'copy'); await run(h, 'paste')
    expect(refs(h)[1]).toMatchObject({ uid: 'ico2', params: { x: 30, y: 40 } }); expect(refs(h)[1].group).toBeUndefined()
    h.ctx.dispatch({ type: 'addPage' }); await run(h, 'paste')
    expect(refs(h)[0]).toMatchObject({ uid: 'ico3', params: { x: 20, y: 30 } }); expect(refs(h)[0].group).toBeUndefined()
  })
  it('advances native-only paste offsets and resumes the count after undo', async () => {
    const h = make([], [ico()], [nat()]); await run(h, 'copy')
    await run(h, 'paste'); await run(h, 'paste'); await run(h, 'paste')
    expect(refs(h).map(n => n.params.x)).toEqual([20, 30, 40, 50])
    await run(h, 'undo'); await run(h, 'undo'); await run(h, 'paste')
    expect(refs(h).map(n => n.params.x)).toEqual([20, 30, 40])
  })
  it('groups shapes with a native, allocating a holder id; refuses no shapes and pointer scope changes', async () => {
    const h = make([R(), R(10)], [ico()], [at([0]), at([1]), nat()]); await run(h, 'group')
    expect(h.root()[0].attrs.id).toBe('group_1'); expect(refs(h)[0].group).toBe('group_1'); expect(h.state().past).toHaveLength(1)
    const only = make([], [ico()], [nat()]); await run(only, 'group'); expect(only.status()).toContain('a group needs a shape')
    const reader = make([R(0, { fo: '=hover' })], [ico()], [at([0]), nat()]); await run(reader, 'group')
    expect(reader.root()).toHaveLength(1); expect(reader.root()[0].op).toBe('R'); expect(reader.state().past).toHaveLength(0)
    expect(reader.status()).toContain('giving it one would change')
  })
  it('hide flips each mixed member; lock sets all one way; show/unlock all clear flags', async () => {
    const h = make([R(0, { v: 0 })], [ico()], [at([0]), nat()])
    await run(h, 'hide'); expect(h.root()[0].attrs.v).toBeUndefined(); expect(refs(h)[0].hidden).toBe(true)
    await run(h, 'hide'); expect(refs(h)[0].hidden).toBeUndefined()
    await run(h, 'lock'); expect(refs(h)[0].lock).toBe(true); expect(h.root()[0].comments).toContain('lock')
    await run(h, 'lock'); expect(refs(h)[0].lock).toBeUndefined()
    await run(h, 'hide'); await run(h, 'lock'); await run(h, 'showAll'); await run(h, 'unlockAll')
    expect(refs(h)[0].hidden).toBeUndefined(); expect(refs(h)[0].lock).toBeUndefined(); expect(h.state().past).toHaveLength(8)
  })
  it('escape selects the holder, exits when entered there, and clears a page native', async () => {
    const h = make([G('card')], undefined, [nat()]); await run(h, 'select.parent'); expect(h.state().selection).toEqual(at([0]))
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] }); h.ctx.dispatch({ type: 'select', selection: nat() })
    await run(h, 'select.parent'); expect(h.state().entered).toBeNull(); expect(h.state().selection).toEqual(at([0]))
    const p = make([], [ico()], [nat()]); await run(p, 'select.parent'); expect(p.state().selection).toBeNull()
  })
  it('orders selected natives only within holder and z band, together with nodes', async () => {
    const input: NativeRef = instance('textinput', {}, 'input1')
    const h = make([R(), R(20)], [ico(), input, ico('ico2'), ico('ico3')], [at([0]), nat()])
    await run(h, 'forward'); expect(refs(h).map(n => n.uid)).toEqual(['ico2', 'input1', 'ico1', 'ico3'])
    await run(h, 'front'); expect(refs(h).map(n => n.uid)).toEqual(['ico2', 'input1', 'ico3', 'ico1'])
    await run(h, 'back'); expect(refs(h).map(n => n.uid)).toEqual(['ico1', 'input1', 'ico2', 'ico3'])
    h.ctx.dispatch({ type: 'select', selection: nat('ico3') }); await run(h, 'backward')
    expect(refs(h).map(n => n.uid)).toEqual(['ico1', 'input1', 'ico3', 'ico2'])
  })
  it('aligns a mixed set and one native to the page; distributes and gaps native boxes', async () => {
    const h = make([R()], [ico()], [at([0]), nat()]); await run(h, 'align.left'); expect(refs(h)[0].params.x).toBe(0)
    h.ctx.dispatch({ type: 'select', selection: nat() }); await run(h, 'align.right'); expect(refs(h)[0].params.x).toBe(450)
    const d = make([R(), R(100)], [ico()], [at([0]), nat(), at([1])]); await run(d, 'distribute.x'); expect(refs(d)[0].params.x).toBe(50)
    await run(d, 'gap.x', '5'); expect(refs(d)[0].params.x).toBe(15); expect(d.root()[1].attrs.x).toBe(30)
    const l = make([R(), R(100)], [ico('ico1', undefined, { lock: true })], [at([0]), nat(), at([1])]); await run(l, 'distribute.x')
    expect(l.status()).toContain('nothing moved'); expect(l.state().past).toHaveLength(0)
  })
  it('nudges a mixed set in one burst while another group carries its held native', async () => {
    vi.useFakeTimers()
    const h = make([G('card')], [ico('ico1', 'card'), ico('ico2')], [at([0]), nat('ico2')])
    await run(h, 'nudge.ArrowRight'); await run(h, 'nudge.ArrowRight'); await run(h, 'nudge.ArrowRight')
    expect(refs(h).map(n => n.params.x)).toEqual([23, 23]); expect(h.state().past).toHaveLength(0)
    vi.advanceTimersByTime(500); expect(h.state().past).toHaveLength(1)
  })
  it('select all includes only shown unlocked page natives; style paste names skipped natives', async () => {
    const h = make([R(0, { f: '#fff' }), G('card')], [ico(), ico('ico2', 'card'), ico('ico3', undefined, { hidden: true }), ico('ico4', undefined, { lock: true })])
    await run(h, 'selectAll'); expect(h.state().selection?.native).toBe('ico1'); expect(h.state().also).toHaveLength(2)
    h.ctx.clip.style = { op: 'R', attrs: { f: '#000' } }; await run(h, 'style.paste'); expect(h.status()).toContain('1 skipped: natives take no style')
  })
})
