// @vitest-environment happy-dom
import { forEachDiagnostic } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Scene } from '../model/scene'
import type { Action } from '../model/store'
import { checkScene, tooLarge, type Checked } from '../srctext/check'
import { SceneChecker } from '../srctext/checker'
import { parseSrc } from '../srctext/parse'
import { printSrc } from '../srctext/print'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { CodePane } from './CodePane'

const scene = (text: string) => parseSrc(text).scene!

let ui: ReturnType<typeof mount> | null = null
beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers() })

/** The pane on page p1 showing `first`, its checks answered as check.worker.ts does, or by `verdict`. */
function pane(first: Scene, verdict?: (s: Scene) => Checked, onDiagnostics?: (counts: { errors: number; warnings: number }) => void) {
  const workers = checkWorkers(verdict), checker = new SceneChecker(workers.make), actions: Action[] = []
  const draw = (s: Scene, pageId = 'p1') => <CodePane scene={s} pageId={pageId} selection={null} dispatch={a => { actions.push(a) }} checker={checker} onDiagnostics={onDiagnostics} />
  ui = mount(draw(first))
  const view = () => EditorView.findFromDOM(ui!.container.querySelector('.cm-editor') as HTMLElement)!
  return {
    actions, view, text: () => view().state.doc.toString(), worker: () => workers.made[0],
    notice: () => ui!.container.querySelector('.vb-code-draft'),
    rerender: (s: Scene, pageId?: string) => run(() => { ui!.rerender(draw(s, pageId)) }),
    type: (text: string) => run(() => { view().dispatch({ changes: { from: 0, to: view().state.doc.length, insert: text }, userEvent: 'input.type' }) }),
    quiet: () => run(async () => { await vi.advanceTimersByTimeAsync(350) }), // advance debounce and checker tasks explicitly
  }
}

describe('CodePane', () => {
  it('marks a filled P crossing as a warning and accepts its source', async () => {
    const p = pane(scene('SCENE w=460 h=460\nP d="M0 0 L100 100 L100 0 L0 100 Z" f=#fff'))
    await run(() => {})
    const said: [string, string][] = []
    forEachDiagnostic(p.view().state, d => { said.push([d.severity, d.message]) })
    expect(said).toContainEqual(['warning', 'this P crosses itself, which the mod cannot fill, shadow or clip: uncross the ring or split it'])
    await p.type('SCENE w=460 h=460\nP d="M0 0 L100 100 L100 0 L0 100 Z" f=#ffffff')
    await p.quiet()
    expect(p.actions.some(a => a.type === 'setScene')).toBe(true)
  })
  it.each([false, true])('restores the typed layout after a panel edit and model undo, whitespace-only=%s', async whitespaceOnly => {
    const first = scene('G { R x=1 }'), p = pane(first)
    await run(() => {})
    const text = whitespaceOnly ? 'G {\n  R x=1\n}\n' : 'G {\n  R x=5\n}\n'
    await p.type(text)
    await p.quiet()
    const set = p.actions.find(a => a.type === 'setScene')
    const typed = set?.type === 'setScene' ? set.scene : first
    await p.rerender(typed)
    await p.rerender(scene('G { R x=9 }'))
    await p.rerender(typed)   // the reducer restores the same scene object from history
    expect(p.text()).toBe(text)
    expect(p.notice()).toBeNull()
  })
  it('shows the scene printed once its check lands, and an outside change the same way', async () => {
    const p = pane(scene('R x=1'))
    await run(() => {})
    expect(p.text()).toBe('R x=1')
    await p.rerender(scene('R x=2'))
    expect(p.text()).toBe('R x=2')
    expect(p.notice()).toBeNull()
  })

  it('makes a valid text the scene', async () => {
    const p = pane(scene('R x=1'))
    await run(() => {})
    await p.type('R x=5\n')
    await p.quiet()
    expect(p.actions.filter(a => a.type === 'setScene')).toHaveLength(1)
  })

  it('keeps a draft over an outside change, says so, and reverts to the scene', async () => {
    const p = pane(scene('R x=1'))
    await run(() => {})
    await p.type('G {\n')   // does not parse
    await p.quiet()
    expect(p.actions.filter(a => a.type === 'setScene')).toHaveLength(0)
    await p.rerender(scene('R x=2'))
    expect(p.text()).toBe('G {\n')
    expect(p.notice()?.textContent).toContain('your text was kept')
    expect(p.notice()?.classList.contains('raised')).toBe(true)
    expect(p.notice()?.querySelector('.chip.warn')?.textContent).toBe('WARN')
    await run(() => { (p.notice()!.querySelector('button') as HTMLButtonElement).click() })
    expect(p.text()).toBe('R x=2')
    expect(p.notice()).toBeNull()
  })

  it('keeps typing not parsed yet over an outside change; a valid text then becomes the scene', async () => {
    const p = pane(scene('R x=1'))
    await run(() => {})
    await p.type('R x=7\n')
    await p.rerender(scene('R x=2'))
    expect(p.text()).toBe('R x=7\n')
    expect(p.notice()).not.toBeNull()
    await p.quiet()
    const set = p.actions.filter(a => a.type === 'setScene')
    expect(set).toHaveLength(1)
    expect(p.notice()).toBeNull()
  })

  it("keeps the last keystrokes when a page tab's click blurs the pane before the parse's check lands", async () => {
    const p = pane(scene('R x=1'))
    await run(() => {})
    await p.type('R x=9\n')
    p.worker().held = true
    await run(() => { p.view().contentDOM.dispatchEvent(new FocusEvent('blur')) })   // the parse starts, its check held
    expect(p.worker().waiting).toHaveLength(1)
    await p.rerender(scene('C cx=1'), 'p2')
    for (let k = 0; k < 3; k++) await run(() => p.worker().release())
    const set = p.actions.filter(a => a.type === 'setScene')
    expect(set.map(a => a.type === 'setScene' && [a.pageId, printSrc(a.scene)])).toEqual([['p1', 'R x=9\n']])
    expect(p.text()).toBe('C cx=1')
  })

  it('lints a text too large to check here as information, and makes it the scene all the same', async () => {
    const p = pane(scene('R x=1'), s => s.root.length > 1 ? tooLarge('x') : checkScene(s))
    await run(() => {})
    await p.type('R x=1\nR x=2\n')
    await p.quiet()
    expect(p.actions.flatMap(a => a.type === 'setScene' ? [printSrc(a.scene)] : [])).toEqual(['R x=1\nR x=2\n'])
    const said: [string, string][] = []
    forEachDiagnostic(p.view().state, d => { said.push([d.severity, d.message]) })
    expect(said).toEqual([['info', 'this scene is too large to check here (x); it is not sent to the preview']])
  })
})
it('reports diagnostics after every lint, clearing an unclosed group when fixed', async () => {
  const counts = vi.fn(), p = pane(scene('R w=10 h=10'), undefined, counts)
  await run(() => {})
  await p.type('G {'); await p.quiet()
  expect(counts).toHaveBeenLastCalledWith({ errors: 1, warnings: 0 })
  await p.type('G {}'); await p.quiet()
  expect(counts).toHaveBeenLastCalledWith({ errors: 0, warnings: 0 })
})
