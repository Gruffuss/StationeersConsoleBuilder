// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { newProject, type Page } from '../model/project'
import type { Scene } from '../model/scene'
import type { Action } from '../model/store'
import { node } from '../model/testing'
import { checkScene, tooLarge, type Checked } from '../srctext/check'
import { SceneChecker } from '../srctext/checker'
import { shortestFloat } from '../srctext/print'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import type { Theme } from '../theme'
import { neutral as light } from '../theme/neutral'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { detach, dropWidget, expandRoot, putWidget, reassociate, sanitize, widgetOf } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import { bracket, instance, widgetControl } from '../widgets/testing'
import type { Json, Params, Slot, WidgetRef } from '../widgets/types'
import { EXPR_NAME, LABEL_NAME, readParam, readSample, WIDGET_GONE, WidgetPanel } from './WidgetPanel'
import { WidgetPalette } from './WidgetPalette'
import { NATIVE_DESCRIPTION } from './nativeText'

const tick = () => new Promise(r => setTimeout(r, 0))

it('explains native draw order and the group changes it follows', () => {
  const p = newProject().pages[0], w = instance('icon'), checker = new SceneChecker(checkWorkers().make)
  p.natives = [w]
  const ui = mount(<WidgetPanel page={p} pages={[]} widget={w} native checker={checker} theme={t} dispatch={() => {}}
    sceneOf={() => p.scene} themeNow={() => t} pageNow={() => p} />)
  try { expect(ui.container.textContent).toContain(NATIVE_DESCRIPTION) }
  finally { ui.unmount(); checker.dispose() }
})

it('opens counted widget sections with a data-name anchor and top icon actions', () => {
  const h = setup(instance('gauge'))
  try {
    expect(h.ui.container.querySelector('h2')?.className).toBe('vh')
    const data = h.ui.container.querySelector<HTMLDetailsElement>('#vb-widget-data-names')
    expect(data?.open).toBe(true)
    expect(data?.querySelector('summary .unit')?.textContent).toBe('2')
    const transform = Array.from(h.ui.container.querySelectorAll('details.disc')).find(d => d.querySelector('summary .ptitle')?.textContent === 'Transform')!
    expect(transform.querySelectorAll('.grid2 input')).toHaveLength(4)
    const actions = h.ui.container.querySelector('.vb-widget-actions')!
    expect(actions.previousElementSibling?.tagName).toBe('H2')
    for (const label of ['Detach', 'Delete']) {
      const button = h.buttons(label)[0]
      expect(button.classList.contains('ibtn')).toBe(true)
      expect(button.querySelector('svg[aria-hidden=true]')).not.toBeNull()
      expect(button.querySelector('.vh')?.textContent).toBe(label)
    }
  } finally { h.ui.unmount() }
})

it('keeps runtime row flags sampled but offers no rename field', () => {
  const h = setup(instance('repeater'))
  expect(h.field('hasv data name')).toBeNull()
  expect(h.field('ready data name')).toBeNull()
  expect(h.field('rep1_hasv preview value')).not.toBeNull()
  h.ui.unmount()
})
it('uses neutral list examples in preview errors', () => {
  for (const kind of ['strings', 'texts'] as const) {
    const r = readSample('invalid', { slot: 'items', key: 'items', kind, snap: true, sample: [] })
    expect(r).toEqual({ error: expect.stringContaining('["Item 1", "Item 2"]') })
  }
})
type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
const setValue = (e: Field, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
/** The panel for `w` on page p1. Its dispatch sets the page's scene as the store does (sceneOf reads it); the panel shows
 *  the store's scene on `rerender`. */
function setup(w: WidgetRef, preview?: Record<string, Json>, verdict?: (s: Scene) => Checked) {
  const p = newProject()
  let current = putWidget({ header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] }, w, t)
  const actions: Action[] = [], workers = checkWorkers(verdict), checker = new SceneChecker(workers.make)
  let theme: Theme = t
  const page = (): Page => ({ ...p.pages[0], scene: current, preview })
  const panel = () => <WidgetPanel page={page()} pages={[{ id: 'p1', name: 'Main' }, { id: 'p2', name: 'Power' }]} widget={w}
    checker={checker} theme={theme} sceneOf={id => id === 'p1' ? current : undefined} themeNow={() => theme}
    pageNow={id => id === 'p1' ? page() : undefined} dispatch={a => { actions.push(a); if (a.type === 'setScene') current = a.scene }} />
  const ui = mount(panel())
  const field = (label: string) => widgetControl(ui.container, label) as Field   // by key, through the row's hover hint
  const type = (label: string, text: string) => run(async () => {
    setValue(field(label), text)
    field(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await tick()
  })
  const pick = (label: string, value: string) => run(async () => { setValue(field(label), value); await tick() })
  const toggle = (label: string) => run(async () => { (field(label) as HTMLInputElement).click(); await tick() })
  const blur = (label: string) => run(async () => { (field(label) as HTMLInputElement).focus(); (field(label) as HTMLInputElement).blur(); await tick() })
  const buttons = (text: string) => Array.from(ui.container.querySelectorAll('button')).filter(b => b.textContent === text)
  const click = (text: string, k = 0) => run(async () => { buttons(text)[k].click(); await tick() })
  const sets = () => actions.flatMap(a => a.type === 'setScene' ? [a.scene] : [])
  const paramsOf = (s: Scene) => widgetOf(s.root.find(n => n.attrs.id === w.uid)!, t)!.params
  return { ui, actions, field, type, pick, toggle, blur, buttons, click, sets, workers,
    scene: () => current,
    /** Sets the store's scene from outside (the code pane, undo, a delete), and shows it unless the panel is gone. */
    move: (s: Scene, show = true) => run(() => { current = s; if (show) ui.rerender(panel()) }),
    /** Switches the store's theme as setTheme does for this one widget: re-expanded in `to`, then shown. */
    retheme: (to: Theme) => run(() => {
      const was = widgetOf(current.root.find(n => n.attrs.id === w.uid)!, theme)!
      current = putWidget(current, { ...was, params: sanitize(WIDGETS[w.type], was.params, to) }, to)
      theme = to
      ui.rerender(panel())
    }),
    release: () => run(async () => { for (let k = 0; k < 3; k++) { workers.made[0].release(); await tick() } }),
    alerts: () => Array.from(ui.container.querySelectorAll('[role=alert]'), e => e.textContent),
    params: () => paramsOf(sets().at(-1)!), paramsOf }
}

it('lists live and dormant part overrides and resets one without losing another', async () => {
  const w = { ...instance('button'), edit: { v: 1 as const, parts: { 'state.0.body': { attrs: { f: '#123456' } }, 'state.8.body': { dx: 4 } } } }
  const h = setup(w)
  expect(h.ui.container.textContent).toContain('Parts')
  expect(h.ui.container.textContent).toContain('state.8.body (dormant)')
  expect(h.ui.container.textContent).toContain('f')
  await h.click('Reset part')
  expect(widgetOf(h.scene().root[0], t)?.edit?.parts).toEqual({ 'state.8.body': { dx: 4 } })
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

it('explains dormant geometry deltas in Parts', async () => {
  const h = setup({ ...instance('bar', { cells: 4 }), edit: { v: 1 as const, parts: { fill: { dx: 3, dy: 2 }, track: { dw: 5 } } } })
  for (const k of ['dx', 'dy', 'dw']) expect(h.ui.container.textContent).toMatch(new RegExp(`${k} \\(not applied: .*expression`))
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

it('lists a key not applied in this theme and applies it after switching back', async () => {
  const w = { ...instance('button', { states: [{ key: 8, label: 'A', variant: 'primary' }] }),
    edit: { v: 1 as const, parts: { 'state.8.body': { attrs: { rx: 9, f: '#123456' } } } } }
  const h = setup(w)
  await h.retheme(bracket)
  expect(h.ui.container.textContent).toContain('rx (not applied in this theme)')
  expect(h.ui.container.textContent).not.toContain('f (not applied in this theme)')
  await h.retheme(light)
  expect(h.ui.container.textContent).not.toContain('not applied in this theme')
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

it('edits the parameters of a widget nested in an ordinary group', async () => {
  const w = instance('bar'), h = setup(w), s = h.scene()
  await h.move({ ...s, root: [node('G', { t: [100, 50] }, s.root)] })
  expect(h.ui.container.textContent).toContain('bar1_lvl')
  await h.type('Width', '330')
  expect(widgetOf(h.scene().root[0].c![0], t)?.params.w).toBe(330)
  expect(h.alerts()).toEqual([])
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

it('adding after removing the last state never reuses a dormant override key', async () => {
  const w = { ...instance('button', { states: [{ label: 'A', variant: 'secondary', key: 0 }, { label: 'B', variant: 'primary', key: 1 }] }),
    edit: { v: 1 as const, parts: { 'state.1.body': { attrs: { f: '#123456' } } } } }
  const h = setup(w)
  await h.click('Remove', 1)
  await h.click('Add')
  const next = widgetOf(h.scene().root[0], t)!
  expect((next.params.states as import('../widgets/types').Params[]).map(s => s.key)).toEqual([0, 2])
  expect(expandRoot(next, t).exp.dormant).toEqual(['state.1.body'])
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

it('large float32 list keys cannot fall back to a key reserved by a dormant override', async () => {
  const w = { ...instance('button', { states: [{ label: 'A', variant: 'secondary', key: 16777216 }] }),
    edit: { v: 1 as const, parts: { 'state.0.body': { attrs: { f: '#123456' } } } } }
  const h = setup(w)
  await h.click('Add')
  const next = widgetOf(h.scene().root[0], t)!
  expect((next.params.states as Params[]).map(s => s.key)).toEqual([16777216, 1])
  expect(expandRoot(next, t).exp.dormant).toEqual(['state.0.body'])
  h.ui.unmount(); h.workers.made.forEach(w => w.terminate())
})

describe('WidgetPanel', () => {
  it('re-expands the widget from a typed param, checks it, and dispatches one setScene', async () => {
    const s = setup(instance('bar', { x: 24, y: 300 }))
    expect(s.ui.container.querySelector('h2')!.textContent).toBe('Bar bar1')
    await s.type('Width', '300')
    expect(s.params()).toMatchObject({ w: 300 })
    expect(s.sets()[0].root.at(-1)!.c![1].attrs.w).toBe('=clamp($bar1_lvl,0,1)*290')
  })
  it('dispatches nothing for a field left as it was: a blur, Enter again, a blur after Enter', async () => {
    const s = setup(instance('bar'), { bar1_st: 2 })
    await s.blur('Width')
    await s.type('Width', String(s.field('Width').value))
    await s.blur('bar1_lvl preview value')   // the sample stays followed, not pinned
    await s.blur('bar1_st preview value')
    await s.blur('lvl data name')
    await s.type('marks', String(s.field('marks').value))
    expect(s.actions).toEqual([])
    await s.type('Width', '300')
    await s.blur('Width')
    expect(s.actions).toHaveLength(1)
  })
  it('dispatches nothing for an unchanged data name that is not the last renamed', async () => {
    const s = setup(instance('bar', { keys: { lvl: 'o2', st: 'o3' } }))
    await s.blur('lvl data name')
    await s.type('lvl data name', 'o2')
    expect(s.actions).toEqual([])
  })
  it('lands an edit whose scene is too large to check here, saying so as information (final-wave ruling 1)', async () => {
    const s = setup(instance('bar'), undefined, x => x.root[0].comments?.at(-1)?.includes('"w":300') ? tooLarge('x') : checkScene(x))
    await s.type('Width', '300')
    expect(s.params()).toMatchObject({ w: 300 })
    expect(s.alerts()).toEqual([])
    expect(Array.from(s.ui.container.querySelectorAll('[role=status]'), e => e.textContent))
      .toEqual(['this scene is too large to check here (x); it is not sent to the preview'])
  })
  it('refuses what a param cannot hold, with the reason, and dispatches nothing', async () => {
    const s = setup(instance('bar'))
    await s.type('Width', 'abc')
    expect(s.ui.container.textContent).toContain('a number is expected')
    await s.type('Width', '3.5e38')
    expect(s.ui.container.textContent).toContain('too large: a float32 holds at most 3.4e38 either way')
    await s.type('cells', '-1')
    expect(s.ui.container.textContent).toContain('at least 0')
    expect(s.actions).toEqual([])
  })
  it('says a derived param follows the others: kept when it does not change, set when it does', async () => {
    const kv = setup(instance('kvtable'))
    const h = kv.field('Height').value
    await kv.type('Height', '100')   // the table's height follows its rows
    expect(kv.alerts()).toEqual([`kept at ${h}: the widget sets it from its other parameters`])
    expect(kv.actions).toEqual([])
    const text = setup(instance('text', { h: 100 }))
    await text.type('Height', '1')   // at least 1.4 x its style's size
    expect(text.params().h).toBeGreaterThan(1)
    expect(text.alerts()).toEqual([`set to ${shortestFloat(text.params().h as number)}: the widget sets it from its other parameters`])
  })
  it('edits a checkbox, a choice and a page by their controls', async () => {
    const s = setup(instance('bar'))
    await s.toggle('target')
    expect(s.params().target).toBe(true)
    await s.pick('stateMode', 'auto')
    expect(s.params()).toMatchObject({ target: true, stateMode: 'auto' })
    const tabs = setup(instance('tabs', { active: 'p9' }))
    expect(Array.from((tabs.field('active') as HTMLSelectElement).options, o => o.textContent)).toEqual(['Main', 'Power', 'p9 (no such page)'])
    await tabs.pick('active', 'p2')
    await tabs.pick('tabs 1 page', 'p2')
    expect(tabs.params()).toMatchObject({ active: 'p2', tabs: [{ page: 'p2' }, { page: 'p2' }] })
  })
  it('names each control by its row label', () => {
    const s = setup(instance('kvtable'))
    for (const label of Array.from(s.ui.container.querySelectorAll('.vb-prop > label'))) {
      expect(s.ui.container.querySelector(`#${label.getAttribute('for')}`)).not.toBeNull()
    }
  })
  it('shows a number as the marker writes it, and notes real rich-text faces and unavailable styles in any label', () => {
    expect(setup(instance('text', { h: 39.2 })).field('Height').value).toBe('39.2')
    expect(setup(instance('text', { text: '<b>Hi</b>' })).ui.container.textContent).toContain('missing styles use faux bold')
    expect(setup(instance('panel', { title: '<b>Hi</b>' })).ui.container.textContent).toContain('missing styles use faux bold')
    expect(setup(instance('kvtable', { rows: [{ caption: '<i>a</i>', fmt: '%.1f', state: false }] })).ui.container.textContent)
      .toContain('missing styles use faux bold')
    expect(setup(instance('panel')).field('title')).toBeInstanceOf(HTMLTextAreaElement)   // a label may break its line
  })
  it('shows the checker’s error for an edit that would make the scene invalid', async () => {
    // Every param the light takes is a float32, but its centre x + w/2 then overflows one: the checker refuses Infinity.
    const s = setup(instance('light', { x: 3.4e38 }))
    await s.type('Width', '3.4e38')
    expect(s.actions).toEqual([])
    expect(s.alerts()[0]).toContain('cannot be written')
  })
  it('takes any template, and lists every name it reads for a preview value (final-wave ruling 2)', async () => {
    const s = setup(instance('text'))
    await s.type('text', '$room kPa')
    expect(s.params().text).toBe('$room kPa')
    await s.move(s.sets()[0])
    expect(s.field('room kPa preview value').value).toBe('Text')
    await s.type('text', '{$constructor} of {$a b:%.1f}')
    await s.move(s.sets()[1])
    expect(['constructor', 'a b'].map(k => s.field(`${k} preview value`).value)).toEqual(['12.5', '12.5'])
    expect(s.alerts()).toEqual([])
  })
  it('renames a slot’s data name, and refuses one an expression cannot read', async () => {
    const s = setup(instance('bar'))
    await s.type('lvl data name', 'o2_lvl')
    expect(s.params().keys).toEqual({ lvl: 'o2_lvl' })
    await s.type('st data name', 'o2 st')
    expect(s.alerts()).toEqual([EXPR_NAME])
    expect(s.actions).toHaveLength(1)
    await s.type('st data name', 'constructor')   // a name like any other (final-wave ruling 2)
    expect(s.alerts()).toEqual([])
    expect(s.params().keys).toEqual({ lvl: 'o2_lvl', st: 'constructor' })
    await s.type('st data name', 'x\u{1D49C}')   // an expression reads a supplementary-plane character since vector 0.11.98
    expect(s.alerts()).toEqual([])
    expect(s.params().keys).toEqual({ lvl: 'o2_lvl', st: 'x\u{1D49C}' })
    // A label alone reads the Alert's message: any name its binding reads back whole.
    const a = setup(instance('alert'))
    await a.type('msg data name', 'bay 2 message')
    expect(a.params().keys).toEqual({ msg: 'bay 2 message' })
    await a.type('msg data name', 'rows[0]')
    expect(a.alerts()).toEqual([LABEL_NAME])
    expect(a.actions).toHaveLength(1)
  })
  it('shows one preview value for two slots renamed to one data name', () => {
    const s = setup(instance('bar', { keys: { lvl: 'o2', st: 'o2' } }))
    expect(Array.from(s.ui.container.querySelectorAll('[aria-label$="preview value"]'), e => e.getAttribute('aria-label'))).toEqual(['o2 preview value'])
  })
  it('makes an edit again on the newer scene when the page changed while it was checked', async () => {
    const s = setup(instance('bar'))
    s.workers.made[0].held = true
    await s.type('Width', '300')
    const other = node('R', { x: 0, y: 0, w: 1, h: 1 })
    await s.move({ ...s.scene(), root: [other, ...s.scene().root] })   // the code pane, meanwhile
    await s.release()
    expect(s.sets()).toHaveLength(1)
    expect(s.sets()[0].root[0]).toBe(other)
    expect(s.params()).toMatchObject({ w: 300 })
  })
  it('makes an edit again in the new theme when the theme switched while it was checked', async () => {
    const s = setup(instance('bar'))
    s.workers.made[0].held = true
    await s.type('Width', '300')
    await s.retheme(light)
    const switched = s.scene()
    await s.release()
    expect(s.sets()).toHaveLength(1)
    expect(s.params()).toMatchObject({ w: 300 })
    // Expanded in the old theme, the store's setScene would see a widget edited by hand and detach it.
    expect(reassociate(switched, s.sets()[0], light).detached).toEqual([])
  })
  it('makes an Add clicked while a field’s commit is checked on the scene that commit makes', async () => {
    const s = setup(instance('kvtable'))
    s.workers.made[0].held = true
    await s.type('rows 1 caption', 'Flow')
    await s.click('Add')
    await s.release()
    expect(s.sets()).toHaveLength(2)
    expect((s.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['Flow', 'Label 2', 'Label 3', 'Label 3'])
    expect(s.alerts()).toEqual([])
  })
  it('does not apply an edit to a widget deleted or detached while it was checked, even once the panel is gone', async () => {
    const d = setup(instance('bar'))
    d.workers.made[0].held = true
    await d.type('Width', '333')
    await run(() => d.ui.unmount())
    await d.move(dropWidget(d.scene(), 'bar1', t), false)
    await d.release()
    expect(d.actions).toEqual([])
    const x = setup(instance('bar'))
    x.workers.made[0].held = true
    await x.type('Width', '333')
    await x.move(detach(x.scene(), 'bar1', t))
    await x.release()
    expect(x.actions).toEqual([])
    expect(x.alerts()).toEqual([WIDGET_GONE])
  })
  it('applies an edit whose check lands after the panel is gone (another node selected), once', async () => {
    const s = setup(instance('bar'))
    s.workers.made[0].held = true
    await s.type('Width', '333')
    await run(() => s.ui.unmount())   // its text goes in again on unmount: the same edit
    await s.release()
    expect(s.sets()).toHaveLength(1)
    expect(s.params()).toMatchObject({ w: 333 })
  })
  it('edits a list: Add copies the last row, numbers counted up; Remove stops at the minimum; an item field is read by its type', async () => {
    const s = setup(instance('kvtable', { rows: [{ caption: 'Only', fmt: '%.1f', state: false }] }))
    expect(s.buttons('Remove')[0].disabled).toBe(true)
    await s.click('Add')
    expect(s.params().rows).toHaveLength(2)
    await s.type('rows 1 caption', '$x')
    expect(s.ui.container.textContent).toContain('a label cannot start with $')
    const og = setup(instance('options'))
    await og.click('Add')
    expect((og.params().options as { value: number }[]).map(o => o.value)).toEqual([0, 1, 2, 3])
  })
  it('removes a list row, and the messages of the rows it moves up', async () => {
    const s = setup(instance('kvtable'))
    await s.type('rows 3 caption', '$x')
    expect(s.alerts()).toHaveLength(1)
    await s.click('Remove', 0)
    expect((s.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['Label 2', 'Label 3'])
    expect(s.alerts()).toEqual([])
    const two = setup(instance('kvtable', { rows: [{ caption: 'A', fmt: '', state: false }, { caption: 'B', fmt: '', state: false }] }))
    two.workers.made[0].held = true
    await two.click('Remove', 0)
    await two.click('Remove', 0)   // before the first lands: made again on its scene, it stops at the minimum
    await two.release()
    expect(two.sets()).toHaveLength(1)
    expect((two.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['B'])
  })
  it('removes a Key–value row with its own data name: every other row keeps its rename (the final review)', async () => {
    const s = setup(instance('kvtable', { keys: { v0: 'pressure', v1: 'temp', v2: 'mode', s0: 'press_st' } }))
    await s.click('Remove', 1)   // Label 2
    const w = { ...instance('kvtable'), params: s.params() }
    expect((w.params.rows as { caption: string }[]).map(r => r.caption)).toEqual(['Label 1', 'Label 3'])
    expect(w.params.keys).toEqual({ v0: 'pressure', v2: 'mode', s0: 'press_st' })
    expect(expandRoot(w, t).exp.slots.map(x => x.key)).toEqual(['pressure', 'press_st', 'mode'])
    await s.move(s.sets()[0])
    await s.click('Add')   // a new row takes a key no row holds, and no old name with it
    expect(expandRoot({ ...w, params: s.params() }, t).exp.slots.map(x => x.key)).toEqual(['pressure', 'press_st', 'mode', 'kv1_v3'])
    // The review's probe: the second row renamed, the first removed; Temperature keeps `temp`, Mode its own name.
    const p = setup(instance('kvtable', { keys: { v1: 'temp' } }))
    await p.click('Remove', 0)
    expect(expandRoot({ ...w, params: p.params() }, t).exp.slots.map(x => x.key)).toEqual(['temp', 'kv1_v2'])
  })
  it('removes the row clicked when a second Remove is clicked before the first lands', async () => {
    const s = setup(instance('kvtable'))
    s.workers.made[0].held = true
    await s.click('Remove', 0)   // Label 1
    await s.click('Remove', 1)   // Label 2, not Mode (which moves up to row 2 once the first lands)
    await s.release()
    expect((s.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['Label 3'])
  })
  it('removes the row clicked when a field of that row was typed and left by pressing its Remove', async () => {
    const s = setup(instance('kvtable'))
    await run(async () => {
      const f = s.field('rows 2 caption') as HTMLInputElement
      f.focus()
      setValue(f, 'Temp')
      f.blur()   // the edit lands first: the row no longer reads as it did when Remove was clicked
      s.buttons('Remove')[1].click()
      await tick()
    })
    await s.release()
    expect((s.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['Label 1', 'Label 3'])
  })
  it('keeps the messages of the rows before a removed one; those of the rows that move up go', async () => {
    const s = setup(instance('kvtable'))
    await s.type('rows 1 fmt', '{')
    await s.type('rows 3 fmt', '{')
    expect(s.alerts()).toHaveLength(2)
    await s.click('Remove', 1)
    expect((s.params().rows as { caption: string }[]).map(r => r.caption)).toEqual(['Label 1', 'Label 3'])
    expect(s.alerts()).toHaveLength(1)
    expect(s.field('rows 1 fmt')!.closest('.vb-prop')!.querySelector('[role=alert]')).not.toBeNull()
  })
  it('lands a field typed and left by pressing Detach or Delete before the widget goes', async () => {
    for (const button of ['Detach', 'Delete']) {
      const s = setup(instance('bar'))
      await run(async () => {
        const w = s.field('Width') as HTMLInputElement
        w.focus()
        setValue(w, '321')
        w.blur()   // pressing the button takes the focus: the field commits on its blur
        s.buttons(button)[0].click()
        await tick()
      })
      await s.release()
      expect(s.actions.map(a => a.type)).toEqual(['setScene', button === 'Detach' ? 'detachWidget' : 'deleteWidget'])
      expect(s.params()).toMatchObject({ w: 321 })
    }
  })
  it('detaches, deletes, and edits a preview value: empty text clears it, Reset too', async () => {
    const s = setup(instance('light'))
    await s.click('Detach')
    await s.click('Delete')
    await s.type('lt1_st preview value', '3')
    await s.type('lt1_st preview value', '')
    await s.type('lt1_st preview value', 'x')
    expect(s.actions).toEqual([{ type: 'detachWidget', pageId: 'p1', uid: 'lt1' }, { type: 'deleteWidget', pageId: 'p1', uid: 'lt1' },
      { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: 3 }, { type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: undefined }])
    expect(s.ui.container.textContent).toContain('a number is expected')
    const r = setup(instance('light'), { lt1_st: 3 })
    expect(r.field('lt1_st preview value').value).toBe('3')
    await r.click('Reset')
    expect(r.actions).toEqual([{ type: 'setPreview', pageId: 'p1', key: 'lt1_st', value: undefined }])
    expect(setup(instance('light')).buttons('Reset')).toEqual([])
  })
  it('reads params and preview values by type', () => {
    expect(readParam('1.5', { key: 'n', type: 'num', int: true })).toEqual({ error: 'a whole number is expected' })
    expect(readParam('0.2, 0.8', { key: 'marks', type: 'numbers', min: 0, max: 1 })).toEqual({ value: [0.2, 0.8] })
    expect(readParam('0.2, 0.8,', { key: 'marks', type: 'numbers', min: 0, max: 1 })).toEqual({ value: [0.2, 0.8] })
    expect(readParam(',1', { key: 'marks', type: 'numbers', min: 0, max: 1 })).toEqual({ value: [1] })
    expect(readParam(' , ', { key: 'marks', type: 'numbers', min: 0, max: 1 })).toEqual({ value: [] })
    expect(readParam('%5.1f kPa', { key: 'fmt', type: 'fmt' })).toEqual({ value: '%5.1f kPa' })
    expect(readParam(' %.1f ', { key: 'fmt', type: 'fmt' })).toEqual({ value: ' %.1f ' })
    expect(readParam('%1.2.3f', { key: 'fmt', type: 'fmt' })).toEqual({ value: '%1.2.3f' })   // Printf.Translate passes it on
    for (const fmt of ['%.1f}', '{0:F1}'])
      expect(readParam(fmt, { key: 'fmt', type: 'fmt' })).toEqual({ error: 'a format cannot hold { or }: a placeholder ends at its first }' })
    expect(readParam('%.1f [kPa]', { key: 'fmt', type: 'fmt' })).toEqual({ value: '%.1f [kPa]' })   // literal since vector 0.11.97
    // A slot labels alone read takes a number or a string: a decimal a float32 holds is a number, any other text a string.
    const text: Slot = { slot: 'v', key: 'v', kind: 'text', snap: true, sample: 1 }
    expect(['12', ' -1.5e2 ', 'Kitchen', '0x10', '1e39', 'Infinity', ''].map(x => readSample(x, text)))
      .toEqual([{ value: 12 }, { value: -150 }, { value: 'Kitchen' }, { value: '0x10' }, { value: '1e39' }, { value: 'Infinity' }, { value: '' }])
    const texts: Slot = { slot: 'm', key: 'm', kind: 'texts', snap: true, sample: [] }
    expect(['["a", "b"]', '[1, 2]', '["a", 2]', ''].map(x => readSample(x, texts))).toEqual([{ value: ['a', 'b'] }, { value: [1, 2] },
      { error: 'a list of strings or a list of numbers, such as ["Item 1", "Item 2"] or [1, 2, 0]' }, { value: undefined }])
    expect(readSample('[1, 2]', { slot: 'st', key: 'a', kind: 'states', snap: true, sample: [] })).toEqual({ value: [1, 2] })
    expect(readSample('["a", 2]', { slot: 'm', key: 'b', kind: 'strings', snap: true, sample: [] })).toEqual({ error: 'a list of strings, such as ["Item 1", "Item 2"]' })
    expect(readSample('', { slot: 'm', key: 'b', kind: 'string', snap: true, sample: 'x' })).toEqual({ value: '' })   // a value: it draws nothing
    expect(readSample('', { slot: 'v', key: 'b', kind: 'number', snap: false, sample: 1 })).toEqual({ value: undefined })
  })
})

describe('WidgetPalette', () => {
  it('lists every widget by group and inserts the one clicked', async () => {
    const got: string[] = []
    const ui = mount(<WidgetPalette onInsert={type => got.push(type)} />)
    expect(Array.from(ui.container.querySelectorAll('.vb-palette > details > summary > .ptitle'), h => h.textContent)).toEqual(['Chrome', 'Values', 'Controls', 'Icons'])
    expect(ui.container.querySelectorAll('button')).toHaveLength(Object.keys(WIDGETS).length)
    await run(() => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === 'Bar')!.click())
    expect(got).toEqual(['bar'])
  })
})
