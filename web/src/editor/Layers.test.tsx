// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Window } from 'happy-dom'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { harness } from '../editing/testing'
import { worldBox } from '../editing/bounds'
import { mount, run } from '../testing'
import { expandRoot, putWidget, widgetAt } from '../widgets/core'
import { instance } from '../widgets/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { Layers } from './Layers'

let ui: ReturnType<typeof mount> | null = null
afterEach(() => { ui?.unmount(); ui = null })
const at = (path: number[], inDefs?: boolean) => ({ pageId: 'p1', path, ...(inDefs && { inDefs }) })
function panel(root: SrcNode[], defs: SrcNode[] = []) {
  const h = harness({ header: { w: 460, h: 460 }, root, defs })
  const draw = () => <Layers page={h.ctx.page()} selection={h.state().selection} also={h.state().also}
    entered={h.state().entered} dispatch={h.ctx.dispatch} ctx={h.ctx} />
  ui?.unmount()
  ui = mount(draw())
  const row = (path: number[], inDefs = false) => {
    const found = ui!.container.querySelector<HTMLElement>(`[data-layer="${inDefs ? 'defs' : 'root'}:${path.join('.')}"]`)
    expect(found).not.toBeNull()
    return found!
  }
  const event = async (f: () => void) => run(async () => { f(); await h.settle(); ui!.rerender(draw()) })
  return { h, row, box: ui.container, event,
    click: (path: number[], mods: MouseEventInit = {}, inDefs = false) => event(() => row(path, inDefs).dispatchEvent(new MouseEvent('click', { bubbles: true, ...mods }))),
    key: (path: number[], key: string, inDefs = false) => event(() => row(path, inDefs).dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))),
    button: (path: number[], label: string, inDefs = false) => event(() => row(path, inDefs).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()),
  }
}
const R = (id: string, x = 0) => node('R', { id, x, y: 10, w: 20, h: 20 })
const ids = (nodes: SrcNode[]) => nodes.map(n => n.attrs.id)

describe('Layers', () => {
  it('opens Definitions and its ancestors for a selection sent from elsewhere', async () => {
    const p = panel([R('shape')], [node('G', { id: 'paint' }, [node('GL', { id: 'stop' })])])
    const details = p.box.querySelector<HTMLDetailsElement>('details.disc')!
    await p.event(() => p.h.ctx.dispatch({ type: 'select', selection: at([0, 0], true) }))
    expect(details.open).toBe(true)
    expect(p.row([0, 0], true).getAttribute('aria-selected')).toBe('true')
  })
  it('keeps the Definition tree mounted inside a closed disclosure', () => {
    const p = panel([R('shape')], [node('GL', { id: 'paint' })])
    const details = p.box.querySelector<HTMLDetailsElement>('details.disc')!
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toBe('Definitions1')
    expect(details.querySelector('[aria-label="Definition layers"]')).not.toBeNull()
    expect(p.row([0], true).textContent).toContain('GL#paint')
  })
  it('draws node-kind icons and keeps the old Hide, Show, Lock and Unlock text', () => {
    const p = panel([node('G'), R('rect'), node('C'), node('Y'), node('L'), node('P'), node('T'), node('IMG'),
      node('R', { v: 0 }), { ...R('locked'), comments: ['lock'] }], [node('FONT', { src: 'url' })])
    const icons = Array.from(p.box.querySelectorAll('.vb-layer-kind svg'))
    expect(icons).toHaveLength(11)
    expect(icons.every(svg => svg.getAttribute('aria-hidden') === 'true')).toBe(true)
    expect(p.row([0]).querySelector('.vb-layer-kind [stroke-dasharray]')).not.toBeNull()
    expect(p.row([1]).querySelector('.vb-layer-kind rect')).not.toBeNull()
    expect(p.row([2]).querySelector('.vb-layer-kind ellipse')).not.toBeNull()
    expect(new Set(icons.slice(0, 8).map(icon => icon.innerHTML)).size).toBe(8)
    expect(p.row([1]).querySelector('[aria-label="Hide / show"]')?.textContent).toBe('Hide')
    expect(p.row([8]).querySelector('[aria-label="Hide / show"]')?.textContent).toBe('Show')
    expect(p.row([9]).querySelector('[aria-label="Lock / unlock"]')?.textContent).toBe('Unlock')
    expect(p.row([1]).querySelector('[aria-label="Lock / unlock"]')?.textContent).toBe('Lock')
  })
  it('bounds the phone list to the viewport and keeps row controls on one line', async () => {
    const size = { width: window.innerWidth, height: window.innerHeight }
    const browser = window as unknown as Window
    browser.happyDOM.setWindowSize({ width: 375, height: 812 })
    const style = document.createElement('style')
    style.textContent = readFileSync(`${import.meta.dirname}/../app.css`, 'utf8') + readFileSync(`${import.meta.dirname}/sidebar.css`, 'utf8')
    document.head.append(style)
    try {
      const p = panel(Array.from({ length: 40 }, (_, i) => R(`row${i}`)))
      const list = getComputedStyle(p.box.querySelector('.vb-layers')!)
      // This DOM does not lay out pixels; check the viewport bound and scroll rules it applies.
      expect(parseFloat(list.maxHeight)).toBeCloseTo(812 * 0.7)
      expect(list.overflowY).toBe('auto')
      expect(getComputedStyle(p.row([39])).flexWrap).toBe('nowrap')
      for (const control of Array.from(p.row([39]).querySelectorAll('button'))) {
        expect(getComputedStyle(control).flexShrink).toBe('0')
        expect(getComputedStyle(control).whiteSpace).toBe('nowrap')
      }
      await p.button([39], 'Hide / show')
      expect(p.h.root()[39].attrs.v).toBe(0)
      await p.button([39], 'Lock / unlock')
      expect(p.h.root()[39].comments).toContain('lock')
    } finally { style.remove(); browser.happyDOM.setWindowSize(size) }
  })
  it('keeps expansion on the moved node rather than the layer position', async () => {
    const p = panel([node('G', { id: 'open' }, [R('a')]), node('G', { id: 'closed' }, [R('b')])])
    await p.button([0], 'Expand')
    await p.key([0], 'ArrowDown')
    expect(p.row([1]).getAttribute('aria-expanded')).toBe('true')
    expect(p.row([0]).getAttribute('aria-expanded')).toBe('false')
    expect(p.box.textContent).toContain('R#a'); expect(p.box.textContent).not.toContain('R#b')
  })
  it('refuses an id rename that collides with a page native uid', async () => {
    const p = panel([R('shape')])
    p.h.ctx.page().natives = [instance('textinput', {}, 'input1')]
    await p.event(() => {
      const input = p.row([0]).querySelector<HTMLInputElement>('[aria-label="id"]')!
      input.value = 'input1'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(p.h.root()[0].attrs.id).toBe('shape')
    expect(p.h.status()).toContain('already in use')
    expect(p.h.state().past).toHaveLength(0)
  })
  it('enters a nested widget before selecting its flat parts, including Shift ranges and Hide', async () => {
    const w = instance('panel'), s = putWidget({ header: {}, defs: [], root: [] }, w, vanillaPlus), parts = expandRoot(w, vanillaPlus).exp.parts!
    const p = panel([node('G', {}, s.root)], s.defs)
    await p.button([0], 'Expand'); await p.button([0,0], 'Expand')
    const body = [0,0,...parts.body], title = [0,0,...parts.title]
    expect(p.row(body).getAttribute('aria-level')).toBe('3')
    await p.click(body)
    expect(p.h.state().entered?.path).toEqual([0,0]); expect(p.h.state().selection?.path).toEqual(body)
    await p.click(title, { shiftKey: true })
    expect([...p.h.state().also, p.h.state().selection].map(x => x!.path)).toEqual([body,title])
    await p.button(body, 'Hide / show')
    expect(widgetAt(p.h.scene(), [0,0], vanillaPlus)?.edit?.parts.body.attrs?.v).toBe(0)
    await p.key(body, 'ArrowLeft')
    expect(p.h.status()).toContain('Detach')
  })
  it('reparents a widget into a group and refuses an ordinary node inside a nested widget', async () => {
    const s = putWidget({ header: {}, defs: [], root: [node('G', {}, [R('plain')])] }, instance('panel'), vanillaPlus)
    const p = panel(s.root, s.defs)
    await p.key([1], 'ArrowRight')
    expect(widgetAt(p.h.scene(), [0,1], vanillaPlus)?.type).toBe('panel')
    if (p.row([0]).querySelector('[aria-label="Expand"]')) await p.button([0], 'Expand')
    const before = p.h.scene()
    await p.event(() => {
      const source = p.row([0,0]), target = p.row([0,1]), transfer = { setData() {} }
      const start = new Event('dragstart', { bubbles: true }); Object.defineProperty(start, 'dataTransfer', { value: transfer }); source.dispatchEvent(start)
      target.dispatchEvent(new MouseEvent('drop', { bubbles: true }))
    })
    expect(p.h.scene()).toBe(before); expect(p.h.status()).toMatch(/widget|Detach/)
  })
  it.each(['GL', 'CP', 'SYM'])('refuses renaming a %s definition onto another definition id without merging references', async op => {
    const defs = [node(op, { id: 'a' }, op === 'GL' ? undefined : [R('insideA')]), node(op, { id: 'b' }, op === 'GL' ? undefined : [R('insideB')])]
    const p = panel([node('R', { f: '@a', clip: 'a', hoverev: 'one' }), node('USE', { ref: 'a' }), node('R', { f: '@b', clip: 'b' }), node('USE', { ref: 'b' })], defs)
    const before = p.h.scene()
    await p.event(() => {
      const input = p.row([0], true).querySelector<HTMLInputElement>('input[aria-label="id"]')!
      input.value = 'b'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(p.h.scene()).toBe(before); expect(p.h.state().past).toHaveLength(0)
    expect(p.h.status()).toContain('already in use on this page')
    expect(p.h.root().map(n => n.attrs)).toEqual(before.root.map(n => n.attrs))
  })
  it.each(['node', 'nested node', 'gradient', 'clip', 'symbol'])('refuses renaming a shape onto an id used by a %s', async kind => {
    const root = [node('R', { id: 'a', click: 1, hoverev: 1 }), ...(kind === 'node' ? [R('b')] : kind === 'nested node' ? [node('G', {}, [R('b')])] : [])]
    const defs = kind === 'gradient' ? [node('GL', { id: 'b' })] : kind === 'clip' ? [node('CP', { id: 'b' }, [R('shape')])] : kind === 'symbol' ? [node('SYM', { id: 'b' }, [R('shape')])] : []
    const p = panel(root, defs), before = p.h.scene()
    await p.event(() => {
      const input = p.row([0]).querySelector<HTMLInputElement>('input[aria-label="id"]')!
      input.value = 'b'; input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(p.h.scene()).toBe(before); expect(p.h.state().past).toHaveLength(0)
    expect(p.h.status()).toContain('already in use on this page')
    expect(p.h.root()[0].attrs).toEqual({ id: 'a', click: 1, hoverev: 1 })
  })
  it('a named part Hide button enters its widget and changes only that part', async () => {
    const w = instance('panel'), s = putWidget({ header: {}, defs: [], root: [] }, w, vanillaPlus)
    const path = [0, ...expandRoot(w, vanillaPlus).exp.parts!.body], p = panel(s.root)
    await p.button([0], 'Expand')
    await p.button(path, 'Hide / show')
    expect(p.h.root()[0].attrs.v).toBeUndefined()
    expect(p.h.root()[0].c![path[1]].attrs.v).toBe(0)
  })
  it('expands widgets into flat named parts, enters before selecting, and refuses part reparenting', async () => {
    const w = instance('button', { states: [{ label: 'A', variant: 'secondary', key: 3 }, { label: 'B', variant: 'primary', key: 8 }] })
    const s = putWidget({ header: {}, defs: [], root: [] }, w, vanillaPlus), parts = expandRoot(w, vanillaPlus).exp.parts!
    const p = panel(s.root)
    await p.button([0], 'Expand')
    expect(p.box.querySelectorAll('[role="treeitem"]')).toHaveLength(Object.keys(parts).length + 1)
    const path = [0, ...parts['state.8.body']]
    expect(p.row(path).textContent).toContain('state.8.body')
    expect(p.row(path).getAttribute('aria-level')).toBe('2')
    await p.click(path)
    expect(p.h.state().entered).toEqual(at([0])); expect(p.h.state().selection).toEqual(at(path))
    const before = p.h.scene()
    await p.key(path, 'ArrowLeft')
    expect(p.h.scene()).toBe(before); expect(p.h.status()).toContain('Detach')
  })
  it('Shift selects a flat range of named parts across state groups without selecting structure', async () => {
    const w = instance('button', { states: [{ label: 'A', variant: 'secondary', key: 3 }, { label: 'B', variant: 'primary', key: 8 }] })
    const s = putWidget({ header: {}, defs: [], root: [] }, w, vanillaPlus), parts = expandRoot(w, vanillaPlus).exp.parts!, p = panel(s.root)
    await p.button([0], 'Expand')
    await p.click([0, ...parts['state.3.body']])
    await p.click([0, ...parts['state.8.label']], { shiftKey: true })
    expect([...p.h.state().also, p.h.state().selection].map(x => x!.path)).toEqual(Object.values(parts).map(path => [0, ...path]))
  })
  it('shows root and defs, expands only requested rows and selects hidden or locked nodes', async () => {
    const p = panel([node('G', { id: 'group' }, [{ ...R('child'), comments: ['lock'] }]), node('R', { id: 'hidden', v: 0 })], [node('CP', { id: 'clip' }, [])])
    expect(p.box.textContent).toContain('Layers')
    expect(p.box.textContent).toContain('Definitions')
    expect(p.box.querySelector('[data-layer="root:0.0"]')).toBeNull()
    await p.button([0], 'Expand')
    expect(p.row([0, 0]).textContent).toContain('locked')
    expect(p.row([1]).textContent).toContain('hidden')
    await p.click([0, 0])
    expect(p.h.state().selection).toEqual(at([0, 0]))
    await p.click([0], {}, true)
    expect(p.h.state().selection).toEqual(at([0], true))
  })
  it('Ctrl/Cmd toggles and Shift selects a sibling range', async () => {
    const p = panel([R('a'), R('b'), R('c')])
    await p.click([0])
    await p.click([2], { ctrlKey: true })
    expect(p.h.state()).toMatchObject({ selection: at([2]), also: [at([0])] })
    await p.click([0], { metaKey: true })
    expect(p.h.state()).toMatchObject({ selection: at([2]), also: [] })
    await p.click([0], { shiftKey: true })
    expect([...p.h.state().also, p.h.state().selection].map(x => x?.path[0]).sort()).toEqual([0, 1, 2])
  })
  it('double click enters an ordinary group and shows the entered state without history', async () => {
    const p = panel([node('G', { id: 'g' }, [R('a')])])
    await p.event(() => p.row([0]).dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(p.h.state().entered).toEqual(at([0]))
    expect(p.h.state().past).toHaveLength(0)
    expect(p.row([0]).textContent).toContain('entered')
  })
  it('a double click on a row control does not enter its group', async () => {
    const p = panel([node('G', {}, [R('a')])])
    await p.event(() => p.row([0]).querySelector('button[aria-label="Expand"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
    expect(p.h.state().entered).toBeNull()
  })
  it('hides and locks only the button row, using one undo step each', async () => {
    const p = panel([R('a'), R('b')])
    await p.click([0])
    await p.button([1], 'Hide / show')
    expect(p.h.root()[1].attrs.v).toBe(0)
    expect(p.h.root()[0].attrs.v).toBeUndefined()
    await p.button([1], 'Lock / unlock')
    expect(p.h.root()[1].comments).toContain('lock')
    expect(p.h.state().past).toHaveLength(2)
  })
  it('also hides and locks a definition row without changing the root list', async () => {
    const p = panel([R('a')], [node('SYM', { id: 's' }, [R('part')])])
    await p.button([0], 'Hide / show', true)
    await p.button([0], 'Lock / unlock', true)
    expect(p.h.scene().defs[0].attrs.v).toBe(0)
    expect(p.h.scene().defs[0].comments).toContain('lock')
    expect(p.h.root()[0].attrs.v).toBeUndefined()
    expect(p.h.root()[0].comments).toBeUndefined()
    expect(p.h.state().past).toHaveLength(2)
  })
  it('selects a row with the keyboard and enters a group with Enter', async () => {
    const p = panel([R('a'), node('G', {}, [R('b')])])
    await p.event(() => p.row([0]).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })))
    expect(p.h.state().selection).toEqual(at([0]))
    await p.event(() => p.row([1]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(p.h.state().entered).toEqual(at([1]))
    expect(p.h.state().past).toHaveLength(0)
  })
  it('definition rows stay definitions when dropped on root rows', async () => {
    const p = panel([R('a')], [node('GR', { id: 'g', c: ['#000', '#fff'] })])
    const transfer = new DataTransfer()
    await p.event(() => {
      p.row([0], true).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      p.row([0]).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    })
    expect(p.h.scene().defs).toHaveLength(1)
    expect(p.h.root()).toHaveLength(1)
    expect(p.h.state().past).toHaveLength(0)
    expect(p.h.notes.join(' ')).toMatch(/defs|definitions/i)
  })
  it('drag and drop reparents into a group and keeps placement in one checked edit', async () => {
    const p = panel([R('a', 40), node('G', { t: [10, 0], s: [2, 2] }, [])])
    const before = worldBox(p.h.scene(), [0]), transfer = new DataTransfer()
    await p.event(() => {
      p.row([0]).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      p.row([1]).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    })
    expect(p.h.state().selection?.path).toEqual([0, 0])
    expect(worldBox(p.h.scene(), [0, 0])).toEqual(before)
    expect(p.h.state().past).toHaveLength(1)
    expect(p.h.checker.get(p.h.scene())?.src).toBeDefined()
  })
  it('Alt+Up and Alt+Down move among siblings, one checked undo step per move', async () => {
    const p = panel([R('a'), R('b'), R('c')])
    await p.key([1], 'ArrowUp')
    expect(ids(p.h.root())).toEqual(['b', 'a', 'c'])
    expect(p.h.state().selection).toEqual(at([0]))
    expect(p.h.state().past).toHaveLength(1)
    await p.key([0], 'ArrowDown')
    expect(ids(p.h.root())).toEqual(['a', 'b', 'c'])
    expect(p.h.state().selection).toEqual(at([1]))
    expect(p.h.state().past).toHaveLength(2)
    expect(p.h.checker.get(p.h.scene())?.src).toBeDefined()
  })
  it('keyboard focus follows the moved row so repeated moves act on the same node', async () => {
    const p = panel([R('a'), R('b'), R('c')])
    await p.event(() => p.row([1]).focus())
    await p.key([1], 'ArrowUp')
    expect(document.activeElement).toBe(p.row([0]))
    await p.event(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true })))
    expect(ids(p.h.root())).toEqual(['a', 'b', 'c'])
    expect(document.activeElement).toBe(p.row([1]))
  })
  it('keeps the entered group when reordering another group ahead of it', async () => {
    const p = panel([node('G', { id: 'a' }, [R('partA')]), node('G', { id: 'b' }, [R('partB')])])
    await p.event(() => p.h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] }))
    await p.key([1], 'ArrowUp')
    expect(ids(p.h.root())).toEqual(['b', 'a'])
    expect(p.h.state().entered).toEqual(at([1]))
    expect(p.h.state().selection).toEqual(at([0]))
  })
  it('keeps entry on the original group inside a placement-preserving wrapper', async () => {
    const p = panel([node('G', { id: 'a' }, [R('part')]), node('G', { s: [2, 2] }, [])])
    await p.event(() => p.h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] }))
    const transfer = new DataTransfer()
    await p.event(() => {
      p.row([0]).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
      p.row([1]).dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
    })
    expect(p.h.state().entered).toEqual(at([0, 0, 0]))
    expect(p.h.state().selection).toEqual(at([0, 0]))
  })
  it('Alt+Right enters the group above; Alt+Left moves out without moving artwork', async () => {
    const p = panel([node('G', { id: 'g', t: [10, 0] }, []), R('a', 40)])
    const before = worldBox(p.h.scene(), [1])
    await p.key([1], 'ArrowRight')
    expect(p.h.state().selection).toEqual(at([0, 0]))
    expect(worldBox(p.h.scene(), [0, 0])).toEqual(before)
    await p.key([0, 0], 'ArrowLeft')
    expect(p.h.state().selection).toEqual(at([1]))
    expect(worldBox(p.h.scene(), [1])).toEqual(before)
    expect(p.h.state().past).toHaveLength(2)
  })
  it('renames #a to #b throughout this page references and notes custom Lua', async () => {
    const p = panel([node('R', { clip: 'a', f: '@a', w: 20, h: 20 })], [node('CP', { id: 'a' }, [node('R', { w: 20, h: 20 })])])
    await p.event(() => {
      const input = p.row([0], true).querySelector<HTMLInputElement>('input[aria-label="id"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'b')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(p.h.scene().defs[0].attrs.id).toBe('b')
    expect(p.h.root()[0].attrs).toMatchObject({ clip: 'b', f: '@b' })
    expect(p.h.notes).toContain('custom Lua may still name the old id')
    expect(p.h.state().past).toHaveLength(1)
  })
  it('does not replace a node changed before its id field commits', async () => {
    const p = panel([node('R', { x: 0, w: 20, h: 20 })])
    await p.event(() => {
      p.h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...p.h.scene(), root: [node('R', { x: 99, w: 20, h: 20 })] } })
      const input = p.row([0]).querySelector<HTMLInputElement>('input[aria-label="id"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'named')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(p.h.root()[0].attrs).toEqual({ x: 99, w: 20, h: 20 })
    expect(p.h.state().past).toHaveLength(1)
    expect(p.h.notes.join(' ')).toMatch(/changed/)
  })
  it('shows a widget type and uid with parts collapsed and keeps it when moved into a group', async () => {
    const s: Scene = putWidget({ header: { w: 460, h: 460 }, root: [node('G', {}, [])], defs: [] }, instance('panel', {}, 'pan1'), vanillaPlus)
    const p = panel(s.root, s.defs)
    expect(p.row([1]).textContent).toContain('panel')
    expect(p.row([1]).textContent).toContain('pan1')
    expect(p.row([1]).querySelector('[aria-label="Expand"]')).not.toBeNull()
    await p.key([1], 'ArrowRight')
    expect(p.h.state().past).toHaveLength(1)
    expect(widgetAt(p.h.scene(), [0,0], vanillaPlus)?.uid).toBe('pan1')
  })
  it('10,000 nested groups initially render only the first level and open on demand', async () => {
    let n = R('leaf')
    for (let i = 0; i < 10000; i++) n = node('G', { id: `g${i}` }, [n])
    const p = panel([n])
    expect(p.box.querySelectorAll('[role="treeitem"]')).toHaveLength(1)
    for (let depth = 0; depth < 4; depth++) {
      await p.button(Array(depth + 1).fill(0), 'Expand')
      expect(p.box.querySelectorAll('[role="treeitem"]')).toHaveLength(depth + 2)
    }
    expect(p.h.state().past).toHaveLength(0)
  })
})
