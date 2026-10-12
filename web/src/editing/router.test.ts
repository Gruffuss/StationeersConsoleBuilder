// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newProject } from '../model/project'
import { node } from '../model/testing'
import { mount } from '../testing'
import history from './commands/history'
import { keyName } from './registry'
import { harness } from './testing'
import select from './tools/select'
import type { Gesture, Press } from './types'
import { toSurface } from './view'

const R = node('R', { x: 10, y: 10, w: 20, h: 20 })
const page = () => harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', {}, [R])] },
  { pick: () => ({ pageId: 'p1', path: [0, 0] }) })
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

/** A pointer event the harness does not make: another button, pointer or pointer type. */
const raw = (type: string, x: number, o: { pointerId?: number; button?: number; pointerType?: string; isPrimary?: boolean } = {}) =>
  ({ type, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: x, clientY: 15, timeStamp: 0, shiftKey: false,
    altKey: false, ctrlKey: false, metaKey: false, ...o }) as unknown as PointerEvent
/** The select tool's press, replaced by a gesture that records what it gets; open: its release keeps it open (a
 *  multi-click tool's). Every press the tool gets is in `presses`. */
function stubTool(open: boolean) {
  const presses: Press[] = [], got: string[] = []
  const g: Gesture = { move: () => { got.push('move') }, up: () => { got.push('up'); return open }, down: () => { got.push('down') },
    cancel: () => { got.push('cancel') } }
  vi.spyOn(select, 'down').mockImplementation(p => { presses.push(p); return g })
  return { presses, got }
}

describe('keyName', () => {
  it('names a key with Mod, Alt and Shift in that order; letters as typed; brackets by their key', () => {
    const k = (init: KeyboardEventInit) => keyName(new KeyboardEvent('keydown', init))
    expect(k({ key: 'z', ctrlKey: true })).toBe('Mod+Z')
    expect(k({ key: 'Z', metaKey: true, shiftKey: true })).toBe('Mod+Shift+Z')
    expect(k({ key: 'å', code: 'KeyA', altKey: true })).toBe('Alt+A')
    expect(k({ key: '{', code: 'BracketLeft', ctrlKey: true, shiftKey: true })).toBe('Mod+Shift+[')
    expect(k({ key: 'ArrowLeft', shiftKey: true })).toBe('Shift+ArrowLeft')
    expect(k({ key: 'Delete' })).toBe('Delete')
    expect(k({ key: ' ', code: 'Space', shiftKey: true })).toBe('Shift+Space')
  })
})

describe('the router', () => {
  it('leaves task bar buttons their Enter, letters and chords inside the canvas', () => {
    const h = page(), canvas = document.createElement('div'), bar = document.createElement('div'), button = document.createElement('button')
    canvas.className = 'vb-canvas'; bar.className = 'vb-taskbar'; bar.append(button); canvas.append(bar); document.body.append(canvas)
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0] } })
    for (const init of [{ key: 'Enter' }, { key: 'r' }, { key: 'd', ctrlKey: true }]) {
      const e = new KeyboardEvent('keydown', { ...init, cancelable: true })
      Object.defineProperty(e, 'target', { value: button })
      h.router.key(e)
      expect(e.defaultPrevented).toBe(false)
      expect(h.ctx.tool()).toBe('select')
      expect(h.state().entered).toBeNull()
      expect(h.root()).toHaveLength(1)
    }
  })
  it('pick after pan selects the node under the mapped press without an undo step for navigation', () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', {}, [R])] },
      { pick: p => p.x >= 10 && p.x <= 30 && p.y >= 10 && p.y <= 30 ? { pageId: 'p1', path: [0, 0] } : null }), state = h.state()
    h.ctx.setView({ zoom: 2, pan: { x: 100, y: 50 } })
    expect(h.ctx.view().pan).toEqual({ x: 100, y: 50 })
    h.router.overlay({ zoom: 2, pan: { x: 100, y: 50 }, frame: h.ctx.frame() })
    h.click({ x: 130, y: 80 })
    expect(h.state().selection).toBeNull()   // unmapped CSS coordinates miss the artwork
    // Canvas converted CSS (130,80) to surface (15,15); the router then uses the page's viewbox.
    h.click(toSurface(h.ctx.view(), { x: 130, y: 80 }))
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0] })
    expect(h.state().project).toBe(state.project)
    expect(h.state().past).toBe(state.past)
  })

  it('runs the command bound to a key whose when holds: Esc selects the parent, Mod+Z undoes', () => {
    const h = page()
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    expect(h.key({ key: 'Escape' }).defaultPrevented).toBe(true)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0] })
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    h.key({ key: 'z', ctrlKey: true })
    expect(h.root()).toHaveLength(1)
  })
  it('acts on a plain key only with the focus on the page or the canvas; Mod works with a button focused; a text field keeps all', () => {
    const h = page(), button = document.createElement('button'), input = document.createElement('input')
    document.body.append(button, input)
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    const onButton = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    button.addEventListener('keydown', e => h.router.key(e), { once: true })
    button.dispatchEvent(onButton)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    const typed = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    input.addEventListener('keydown', e => h.router.key(e), { once: true })
    input.dispatchEvent(typed)
    expect(h.root()).toHaveLength(0)
    const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    button.addEventListener('keydown', e => h.router.key(e), { once: true })
    button.dispatchEvent(undo)
    expect(h.root()).toHaveLength(1)
  })
  it('lets Delete through wherever M2b T8 lets it (ownsDelete): not in a button, a panel or with Shift; other plain keys stay gated', () => {
    const h = page(), at = (tag: string, cls = '') => { const e = document.createElement(tag); e.className = cls; e.tabIndex = 0; document.body.append(e); return e }
    const key = (el: Element, init: KeyboardEventInit) => {
      el.addEventListener('keydown', e => h.router.key(e as KeyboardEvent), { once: true })
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
    }
    const div = at('div', 'vb-somewhere')   // neither the page, the canvas, a form control nor a panel
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    key(div, { key: 'Escape' })
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
    for (const [el, init] of [[at('button'), { key: 'Delete' }], [at('div', 'vb-props'), { key: 'Delete' }], [div, { key: 'Delete', shiftKey: true }]] as const) key(el, init)
    expect(h.root()[0].c).toHaveLength(1)
    key(div, { key: 'Delete' })
    expect(h.root()[0].c).toEqual([])
  })
  it('gives Esc to the open gesture first: the drag is undone and the selection stays', () => {
    const h = page()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    h.down({ x: 15, y: 15 })
    h.move({ x: 25, y: 15 })
    expect(h.root()[0].c![0].attrs.x).toBe(20)
    h.key({ key: 'Escape' })
    expect(h.root()[0].c![0]).toBe(R)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
    h.up({ x: 25, y: 15 })
    expect(h.state().past).toHaveLength(0)
  })
  it('a plain key bound to no command picks the tool with that key', () => {
    const h = page()
    h.ctx.setTool('nothing-here')
    h.key({ key: 'v' })
    expect(h.ctx.tool()).toBe('select')
  })
  it('routes tool letters from a closed menubar trigger but keeps other controls and open menus gated', () => {
    const h = page(), bar = document.createElement('div'), trigger = document.createElement('button')
    bar.setAttribute('role', 'menubar'); trigger.setAttribute('aria-expanded', 'false'); bar.append(trigger); document.body.append(bar)
    const key = () => { trigger.addEventListener('keydown', e => h.router.key(e), { once: true }); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })) }
    h.ctx.setTool('select'); key(); expect(h.ctx.tool()).toBe('rect')
    h.ctx.setTool('select'); trigger.setAttribute('aria-expanded', 'true'); key(); expect(h.ctx.tool()).toBe('select')
    trigger.setAttribute('aria-expanded', 'false'); trigger.removeAttribute('aria-expanded'); key(); expect(h.ctx.tool()).toBe('select')
    bar.remove()
  })
  it('ignores the release of a press it ignored: a right click leaves an open multi-click gesture alone', () => {
    const h = page(), t = stubTool(true)
    h.click({ x: 15, y: 15 })
    expect(t.got).toEqual(['up'])
    h.router.pointer('down', 20, 15, raw('pointerdown', 20, { button: 2 }))
    h.router.pointer('up', 20, 15, raw('pointerup', 20, { button: 2 }))
    expect(t.got).toEqual(['up'])
    h.click({ x: 25, y: 15 })   // the next left click still reaches it
    expect(t.got).toEqual(['up', 'down', 'up'])
  })
  it('renders again on a release, so an overlay drawn from the gesture goes', () => {
    const h = page()
    stubTool(false)
    h.down({ x: 15, y: 15 })
    const before = h.redraws()
    h.up({ x: 15, y: 15 })
    expect(h.redraws()).toBe(before + 1)
  })
  it("ignores a second pointer's press while one is pressed; a new primary pointer of its type means the first ended unheard", () => {
    const h = page(), t = stubTool(false)
    h.router.pointer('down', 15, 15, raw('pointerdown', 15, { pointerType: 'touch' }))
    h.router.pointer('down', 40, 15, raw('pointerdown', 40, { pointerId: 2, pointerType: 'touch', isPrimary: false }))   // a second finger
    h.router.pointer('down', 40, 15, raw('pointerdown', 40, { pointerId: 3, pointerType: 'pen' }))   // a pen beside it
    expect(t.presses).toHaveLength(1)
    // The first touch's release never came (it went elsewhere): the next touch is primary again, and is a press.
    h.router.pointer('down', 50, 15, raw('pointerdown', 50, { pointerId: 4, pointerType: 'touch' }))
    expect(t.got).toEqual(['cancel'])
    expect(t.presses).toHaveLength(2)
    h.router.pointer('move', 60, 15, raw('pointermove', 60, { pointerId: 4, pointerType: 'touch' }))
    expect(t.got).toEqual(['cancel', 'move'])
  })
  it('counts a double click: a press within 500 ms and 4 CSS px of the last one', () => {
    const h = page(), t = stubTool(false)
    h.click({ x: 15, y: 15 })
    h.click({ x: 19, y: 15 }, { double: true })   // 4 px away
    h.click({ x: 19, y: 15 }, { double: true })
    h.click({ x: 24, y: 15 }, { double: true })   // 5 px away
    h.click({ x: 24, y: 15 })                     // a second later
    expect(t.presses.map(p => p.clicks)).toEqual([1, 2, 3, 1, 1])
  })
  it('clears the status line on a press, and closes a nudge burst still open as its own undo step', () => {
    const h = page()
    stubTool(false)
    h.ctx.note('locked')
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] }, transient: true })
    h.down({ x: 15, y: 15 })
    expect(h.status()).toBe('')
    expect(h.state().dragBase).toBeNull()
    expect(h.state().past).toHaveLength(1)
  })
  it("leaves a key some handler already took (a handle drag's Esc) alone", () => {
    const h = page()
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    e.preventDefault()
    h.router.key(e)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
  })
  it('Esc: a tool other than Select goes back to Select; a set clears; a selection on another page is not touched', () => {
    const h = page()
    h.ctx.setTool('rect')
    h.key({ key: 'Escape' })
    expect(h.ctx.tool()).toBe('select')
    // Nested, so a set that only selected its primary's parent (one node's Esc) would fail.
    const two = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('G', {}, [R, R])] },
      { sel: { pageId: 'p1', path: [0, 1] }, also: [{ pageId: 'p1', path: [0, 0] }] })
    two.key({ key: 'Escape' })
    expect(two.state()).toMatchObject({ selection: null, also: [] })
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [0, 0] } })
    h.ctx.dispatch({ type: 'addPage' })   // the new page is the active one; the selection stays on p1, not shown
    expect(h.key({ key: 'Escape' }).defaultPrevented).toBe(false)
    expect(h.state().selection).toEqual({ pageId: 'p1', path: [0, 0] })
  })
  it('undoes an open nudge burst with nothing before it (undo applies while a drag is open)', () => {
    const h = page()
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] }, transient: true })
    h.key({ key: 'z', ctrlKey: true })
    expect(h.root()).toHaveLength(1)
  })
  it('says on the status line why a command failed, thrown or rejected, instead of a dead key', async () => {
    const h = page(), errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    vi.spyOn(history[0], 'run').mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => h.key({ key: 'z', ctrlKey: true })).not.toThrow()
    expect(h.status()).toBe('Undo failed: boom')
    vi.spyOn(history[0], 'run').mockImplementationOnce(() => Promise.reject(new Error('later')))
    h.key({ key: 'z', ctrlKey: true })
    await h.settle()
    expect(h.status()).toBe('Undo failed: later')
    expect(errors).toHaveBeenCalledTimes(2)
  })
  it('draws the grid only while its lines are at least 4 CSS px apart', () => {
    const h = page()   // one unit per px at zoom 1
    const grid = (step: number) => {
      h.ctx.setSettings({ grid: step })
      const ui = mount(h.router.overlay({ zoom: 1, frame: null }))
      const shown = ui.container.querySelector('.vb-grid') !== null
      ui.unmount()
      return shown
    }
    expect([grid(0), grid(3), grid(4), grid(40)]).toEqual([false, false, true, true])
  })
  it('ignores every pointer but the one that pressed (M1)', () => {
    const h = page()
    h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    const other = (type: string, x: number) => ({ type, pointerId: 2, button: 0, clientX: x, clientY: 15, timeStamp: 0,
      shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }) as unknown as PointerEvent
    h.down({ x: 15, y: 15 })
    h.router.pointer('move', 40, 15, other('pointermove', 40))
    h.router.pointer('up', 40, 15, other('pointerup', 40))
    expect(h.root()[0].c![0]).toBe(R)
    h.move({ x: 25, y: 15 })
    expect(h.root()[0].c![0].attrs.x).toBe(20)
  })
  it('takes no point the canvas cannot place (a canvas of no size divides by a zoom of 0): nothing is drawn or moved', () => {
    const draw = page()
    draw.ctx.setTool('rect')
    draw.drag({ x: NaN, y: NaN }, { x: NaN, y: NaN })
    draw.drag({ x: 0, y: 0 }, { x: Infinity, y: -Infinity })
    expect(draw.root()).toEqual([node('G', {}, [R])])
    // A drag begun where the canvas could place it and released where it cannot is cancelled: the node goes back.
    const move = page()
    move.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
    move.down({ x: 15, y: 15 })
    move.move({ x: 25, y: 15 })
    move.move({ x: NaN, y: NaN })
    expect(move.root()[0].c![0].attrs.x).toBe(20)
    move.up({ x: NaN, y: NaN })
    expect(move.root()[0].c![0]).toBe(R)
    expect(move.state().past).toEqual([])
  })
})

describe('fix round 1: keys the browser or a held key should not reach a command with', () => {
  it('passes over the repeats of a held key while its command is in flight: a held Mod+D never says the scene changed', async () => {
    const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 0, y: 0, w: 5, h: 5 })] }, { sel: { pageId: 'p1', path: [0] } })
    h.key({ key: 'd', ctrlKey: true })
    h.key({ key: 'd', ctrlKey: true, repeat: true })
    await h.settle()
    expect([h.root().length, h.notes]).toEqual([2, []])
    h.key({ key: 'd', ctrlKey: true, repeat: true })   // the first has landed: the held key duplicates again
    await h.settle()
    expect(h.root().length).toBe(3)
  })
  const one = () => harness({ header: { w: 460, h: 460 }, defs: [], root: [R] }, { sel: { pageId: 'p1', path: [0] } })
  it('leaves Mod+C and Mod+X to the browser while page text outside the canvas is selected', () => {
    const h = one(), p = document.createElement('p'), canvas = document.createElement('div')
    p.textContent = 'an error on the status line'
    canvas.className = 'vb-canvas'
    canvas.textContent = 'canvas'
    document.body.append(p, canvas)
    const pick = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); getSelection()!.removeAllRanges(); getSelection()!.addRange(r) }
    pick(p)
    expect(h.key({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(false)
    expect(h.key({ key: 'x', ctrlKey: true }).defaultPrevented).toBe(false)
    expect([h.ctx.clip.text, h.root()]).toEqual([null, [R]])
    pick(canvas)
    expect(h.key({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(true)
    const pane = document.createElement('div')
    pane.contentEditable = 'true'
    pane.textContent = 'R x=10'
    document.body.append(pane)
    pick(pane)   // left selected in the code pane, the focus gone
    expect(h.key({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(true)
    getSelection()!.removeAllRanges()
    expect(h.key({ key: 'c', ctrlKey: true }).defaultPrevented).toBe(true)
    expect(h.ctx.clip.text).toContain('R x=10')
  })
  it('runs a toggle or a nesting once for a held key, and still keeps the key from the browser', async () => {
    const h = one()
    h.key({ key: 'h', ctrlKey: true, shiftKey: true })
    expect(h.key({ key: 'h', ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented).toBe(true)
    await h.settle()
    expect(h.root()[0].attrs.v).toBe(0)
  })
})

// A page tab, the example picker and the Commands menu change the store without the router: it hears of the change at
// the next render (overlay) or the next pointer or key, whichever comes first.
describe('an open multi-click gesture whose page or history changed under it', () => {
  it('is cancelled when another page becomes the active one, at the render that shows it', async () => {
    const h = page(), t = stubTool(true)
    h.ctx.dispatch({ type: 'addPage' })
    h.ctx.dispatch({ type: 'setActivePage', pageId: 'p1' })
    h.click({ x: 15, y: 15 })
    h.router.overlay({ zoom: 1, frame: null })
    expect(t.got).toEqual(['up'])   // nothing changed: still open
    h.ctx.dispatch({ type: 'setActivePage', pageId: h.state().project.pages[1].id })
    h.router.overlay({ zoom: 1, frame: null })
    expect(t.got).toEqual(['up'])   // its own store write waits for the render to end
    await h.settle()
    expect(t.got).toEqual(['up', 'cancel'])
    h.click({ x: 15, y: 15 })   // a new press for the active tool, not the gesture's next click
    expect(t.presses).toHaveLength(2)
    expect(t.got).toEqual(['up', 'cancel', 'up'])
  })
  it('is cancelled by a project load (even one whose page has the same id), an undo or a redo, at the next pointer or key', () => {
    const load = page(), l = stubTool(true)
    load.click({ x: 15, y: 15 })
    load.ctx.dispatch({ type: 'loadProject', project: newProject() })
    load.move({ x: 20, y: 15 })
    expect(l.got).toEqual(['up', 'cancel'])
    vi.restoreAllMocks()
    const undo = page(), u = stubTool(true)
    undo.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...undo.scene(), root: [] } })
    undo.click({ x: 15, y: 15 })
    undo.ctx.dispatch({ type: 'undo' })
    undo.key({ key: 'Enter' })
    expect(u.got).toEqual(['up', 'cancel'])
    vi.restoreAllMocks()
    const redo = page(), r = stubTool(true)
    redo.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...redo.scene(), root: [] } })
    redo.ctx.dispatch({ type: 'undo' })
    redo.click({ x: 15, y: 15 })
    redo.ctx.dispatch({ type: 'redo' })
    redo.click({ x: 15, y: 15 })
    expect(r.got).toEqual(['up', 'cancel', 'up'])
    expect(r.presses).toHaveLength(2)
  })
  it('lets a Ctrl/Cmd chord it does not use go on to its command; one that moves the history ends the gesture', () => {
    const h = page(), t = stubTool(true)
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [] } })
    h.ctx.dispatch({ type: 'undo' })
    h.click({ x: 15, y: 15 })
    expect(h.key({ key: 'y', ctrlKey: true }).defaultPrevented).toBe(true)   // Redo
    expect(h.root()).toEqual([])
    expect(t.got).toEqual(['up', 'cancel'])
  })
  it('keeps a plain key for an open gesture, and every key but Esc for a press still held, a Ctrl/Cmd chord included', () => {
    const h = page(), t = stubTool(true)
    h.click({ x: 15, y: 15 })
    h.key({ key: 'r' })   // the Rectangle tool's key
    expect(h.ctx.tool()).toBe('select')
    expect(t.got).toEqual(['up'])
    vi.restoreAllMocks()
    const held = page()
    stubTool(false)
    held.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...held.scene(), root: [] } })
    held.down({ x: 15, y: 15 })
    held.key({ key: 'z', ctrlKey: true })
    expect(held.root()).toEqual([])   // not undone
  })
  it('is not cancelled by its own steps, a committed one included', () => {
    const h = page(), got: string[] = []
    vi.spyOn(select, 'down').mockImplementation((_, ctx) => ({
      move: () => { got.push('move') }, up: () => { got.push('up'); return true }, cancel: () => { got.push('cancel') },
      down: () => { got.push('down'); ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...ctx.page().scene, root: [] } }) },
    }))
    h.click({ x: 15, y: 15 })
    h.click({ x: 20, y: 15 })   // its next click commits an edit (one undo step)
    h.router.overlay({ zoom: 1, frame: null })
    h.move({ x: 25, y: 15 })
    expect(got).toEqual(['up', 'down', 'up', 'move'])
    expect(h.state().past).toHaveLength(1)
  })
})
