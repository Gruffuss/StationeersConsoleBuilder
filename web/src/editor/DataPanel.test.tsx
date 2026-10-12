// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogOf } from '../catalog'
import { newProject, type Project } from '../model/project'
import { AGGS, type Binding } from '../model/logic'
import { initialState, reducer, type Action } from '../model/store'
import { mount, run } from '../testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { DataPanel } from './DataPanel'
import { NamesList } from './logicUi'

it('shows data names as cards with counts and a segmented new-read aggregate', async () => {
  const p = newProject()
  p.pages[0].scene.root = [{ op: 'R', attrs: { x: '$bound', w: 10, h: 10 } }, { op: 'T', attrs: { text: '$unbound' } }]
  p.bindings = { bound: { from: 'const', value: 1 } }
  p.roles = [{ id: 'all', name: 'All', mode: 'all', prefabs: [] }]
  const ui = mount(<DataPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    expect(ui.container.querySelector('table')).toBeNull()
    expect(Array.from(ui.container.querySelectorAll('.raised[data-name]')).map(card => card.getAttribute('data-name'))).toEqual(['bound', 'unbound'])
    expect(ui.container.querySelector('h2')!.textContent).toBe('Data names')
    expect(ui.container.textContent).toContain('2 names · 1 unbound')
    expect(ui.container.querySelector('[data-name="bound"] .unit')!.textContent).toContain(p.pages[0].name + ' · raw · ')
    await run(() => setValue(ui.container.querySelector('[aria-label="source of unbound"]') as HTMLSelectElement, 'new'))
    const aggregate = ui.container.querySelector('[role="radiogroup"][aria-label="new read aggregate"]')!
    expect(Array.from(aggregate.querySelectorAll('input[type="radio"]')).map(radio => (radio as HTMLInputElement).value)).toEqual(AGGS)
    expect(ui.container.querySelector('section > :last-child')!.classList.contains('vb-recipes')).toBe(true)
  } finally { ui.unmount() }
})

type Field = HTMLInputElement | HTMLSelectElement
it('explains how to add a read when there are no roles', async () => {
  const p = newProject(); p.pages[0].scene.root = [{ op: 'T', attrs: { text: '$unbound' } }]
  const ui = mount(<DataPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    await run(() => setValue(ui.container.querySelector<HTMLSelectElement>('[aria-label="source of unbound"]')!, 'new'))
    expect(ui.container.textContent).toContain('Add a role in the Logic tab first')
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="add the read"]')!.disabled).toBe(true)
  } finally { ui.unmount() }
})

const setValue = (e: Field, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const cat = catalogOf(json('../catalog/devices.json'), json('../catalog/enums.json'))
const blur = (input: Field) => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }

function storedPanel(binding: Binding) {
  const p = newProject()
  p.pages[0].scene.root = [{ op: 'T', attrs: { text: '$value' } }]
  p.bindings = { value: binding }
  let state = initialState(p)
  const actions: Action[] = []
  const dispatch = (a: Action) => { actions.push(a); state = reducer(state, a); ui.rerender(render()) }
  const render = () => <DataPanel project={state.project} theme={vanillaPlus} dispatch={dispatch} catalog={cat} />
  const ui = mount(render())
  return { ui, actions, dispatch, get state() { return state }, field: (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field }
}

function setup(over: Partial<Project> = {}) {
  const p: Project = { ...newProject(), roles: [{ id: 'tank', name: 'O2 tank', prefabs: ['StructureGasSensor'], mode: 'one' }],
    simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'O2 tank', ref: 2, role: 'tank', values: {} }],
    state: [{ name: 'mode', type: 'number', init: 0 }], ...over }
  p.pages[0] = { ...p.pages[0], scene: putWidget(putWidget(p.pages[0].scene, instance('bar'), vanillaPlus), instance('header'), vanillaPlus) }
  const actions: Action[] = []
  const ui = mount(<><NamesList project={p} /><DataPanel project={p} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} /></>)
  const field = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field
  return { ui, actions, field, project: p }
}

describe('DataPanel', () => {
  it('does not offer runtime-owned repeater row flags for binding', () => {
    const p = newProject()
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('repeater'), vanillaPlus)
    const ui = mount(<DataPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={cat} />)
    expect(ui.container.querySelector('[data-name="rep1_hasv"]')).toBeNull()
    expect(ui.container.querySelector('[data-name="rep1_ready"]')).toBeNull()
    expect(ui.container.querySelector('[data-name="rep1_v"]')).not.toBeNull()
    ui.unmount()
  })
  it('shows label-only data as snapped even when its stored binding requests easing', () => {
    const panel = storedPanel({ from: 'const', value: 1, ease: true })
    expect(panel.field('ease value')).toBeNull()
    expect(panel.ui.container.querySelector('[data-name="value"]')?.textContent).toContain('snap')
    panel.ui.unmount()
  })
  it('shows histories on geometry slots as snapped', () => {
    const { ui } = setup({ bindings: { bar1_lvl: { from: 'read', read: 'pressure', part: 'history' } } })
    expect(ui.container.querySelector('[data-name="bar1_lvl"]')?.textContent).toContain('snap')
    ui.unmount()
  })
  it('a required binding expression retains empty-expression validation', () => {
    const panel = storedPanel({ from: 'expr', expr: '' })
    try {
      const input = panel.field('expression for value')
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.closest('.vb-expr')!.querySelector('.vb-expr-why')?.textContent).toBe('an expression is empty')
    } finally { panel.ui.unmount() }
  })
  it.each(['', 'up time', 'up-time', 'end'])('keeps the last valid export name while drafting %j and explains why', async text => {
    const panel = storedPanel({ from: 'export', name: 'uptime' })
    const input = panel.field('export for value')
    await run(() => setValue(input, text))
    expect(panel.state.project.bindings.value).toEqual({ from: 'export', name: 'uptime' })
    expect(input.value).toBe(text)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(panel.ui.container.textContent).toContain('Lua name')
    await run(() => blur(input))
    expect(panel.actions).toEqual([])
    await run(() => setValue(input, 'upTime'))
    await run(() => blur(input))
    expect(panel.state.project.bindings.value).toEqual({ from: 'export', name: 'upTime' })
    expect(panel.state.past).toHaveLength(1)
    await run(() => panel.dispatch({ type: 'undo' }))
    expect(panel.state.project.bindings.value).toEqual({ from: 'export', name: 'uptime' })
    panel.ui.unmount()
  })
  it.each(['expr', 'const', 'export'] as const)('a %s typing burst is one undo step, committed on blur or Enter', async kind => {
    const binding: Binding = kind === 'expr' ? { from: 'expr', expr: '0' } : kind === 'const' ? { from: 'const', value: 0 } : { from: 'export', name: 'uptime' }
    const panel = storedPanel(binding)
    const label = kind === 'expr' ? 'expression' : kind === 'const' ? 'constant' : 'export'
    const input = panel.field(`${label} for value`)
    const text = kind === 'expr' ? '1'.repeat(100) : kind === 'const' ? '123456' : 'newName'
    for (let i = 1; i <= text.length; i++) await run(() => setValue(input, text.slice(0, i)))
    expect(panel.state.past).toHaveLength(0)
    expect(panel.actions.every(a => a.type === 'setLogic' && a.transient === true)).toBe(true)
    await run(() => blur(input))
    expect(panel.state.past).toHaveLength(1)
    await run(() => panel.dispatch({ type: 'undo' }))
    expect(panel.state.project.bindings.value).toEqual(binding)
    await run(() => panel.dispatch({ type: 'redo' }))
    expect(input.value).toBe(text)
    await run(() => setValue(input, kind === 'export' ? 'anotherName' : '2'))
    await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(panel.state.past).toHaveLength(2)
    await run(() => blur(input))
    expect(panel.state.past).toHaveLength(2)
    panel.ui.unmount()
  })
  it('an invalid draft after valid typing commits only the last valid name', async () => {
    const panel = storedPanel({ from: 'export', name: 'uptime' })
    const input = panel.field('export for value')
    await run(() => setValue(input, 'newName'))
    await run(() => setValue(input, 'new-name'))
    await run(() => blur(input))
    expect(panel.state.project.bindings.value).toEqual({ from: 'export', name: 'newName' })
    expect(input.value).toBe('new-name')
    expect(panel.state.past).toHaveLength(1)
    await run(() => panel.dispatch({ type: 'undo' }))
    expect(input.value).toBe('uptime')
    panel.ui.unmount()
  })
  it('a long expression preserves earlier canvas history', async () => {
    const panel = storedPanel({ from: 'expr', expr: '0' })
    const page = panel.state.project.pages[0]
    await run(() => panel.dispatch({ type: 'setScene', pageId: page.id, scene: { ...page.scene, root: [{ op: 'T', attrs: { text: '$value', x: 10 } }] } }))
    const canvas = panel.state.project.pages[0].scene
    const input = panel.field('expression for value'), text = '1'.repeat(100)
    for (let i = 1; i <= text.length; i++) await run(() => setValue(input, text.slice(0, i)))
    expect(panel.state.past).toHaveLength(1)
    await run(() => blur(input))
    expect(panel.state.past).toHaveLength(2)
    await run(() => panel.dispatch({ type: 'undo' }))
    expect(panel.state.project.bindings.value).toEqual({ from: 'expr', expr: '0' })
    expect(panel.state.project.pages[0].scene).toEqual(canvas)
    await run(() => panel.dispatch({ type: 'undo' }))
    expect(panel.state.project.pages[0].scene).toEqual(page.scene)
    panel.ui.unmount()
  })
  it('lists every name the pages send, unbound ones saying they send their sample', () => {
    const { ui } = setup()
    const names = Array.from(ui.container.querySelectorAll('[data-name]'), e => e.getAttribute('data-name'))
    expect(names).toEqual(expect.arrayContaining(['bar1_lvl', 'bar1_st', 'hdr1_crit', 'hdr1_warn']))
    expect(ui.container.textContent).toContain('sends its sample')
    ui.unmount()
  })
  it('binds a slot to a state in one setLogic; unbinding removes the binding', async () => {
    const { ui, actions, field } = setup({ bindings: { bar1_st: { from: 'state', state: 'mode' } } })
    await run(() => setValue(field('source of bar1_lvl'), 'state:mode'))
    expect(actions.at(-1)).toEqual({ type: 'setLogic', patch: { bindings: { bar1_st: { from: 'state', state: 'mode' }, bar1_lvl: { from: 'state', state: 'mode' } } } })
    await run(() => setValue(field('source of bar1_st'), ''))
    expect(actions.at(-1)).toEqual({ type: 'setLogic', patch: { bindings: {} } })
    ui.unmount()
  })
  it('makes a new read of the role and binds the name to it, with a starting simulated value, in one undo step', async () => {
    const { ui, actions, field } = setup()
    await run(() => setValue(field('source of bar1_lvl'), 'new'))
    await run(() => setValue(field('new read role'), 'tank'))
    await run(() => setValue(field('new read type'), 'Pressure'))
    await run(() => (ui.container.querySelector('[aria-label="add the read"]') as HTMLButtonElement).click())
    const a = actions.at(-1) as Extract<Action, { type: 'setLogic' }>
    expect(a.patch.reads).toEqual([{ id: 'tankPressure', role: 'tank', of: { lt: { name: 'Pressure' } } }])
    expect(a.patch.bindings).toEqual({ bar1_lvl: { from: 'read', read: 'tankPressure' } })
    expect(a.patch.simDevices![0].values.Pressure).toEqual({ kind: 'slider', v: 101.3, min: 0, max: 200 })
    expect(actions.filter(x => x.type === 'setLogic')).toHaveLength(1)
    ui.unmount()
  })
  it('offers the Header presets and shows an expression\'s guard message', async () => {
    const { ui, actions, field } = setup()
    await run(() => (ui.container.querySelector('[aria-label="preset for hdr1_crit"]') as HTMLButtonElement).click())
    expect(actions.at(-1)).toEqual({ type: 'setLogic', patch: { bindings: { hdr1_crit: { from: 'expr', expr: 'alarms(3)' } } } })
    ui.rerender(<DataPanel project={{ ...newProject(), bindings: { w: { from: 'expr', expr: 'x = 1' } }, pages: [{ ...newProject().pages[0], scene: { header: { w: 480, h: 480 }, defs: [], root: [{ op: 'R', attrs: { w: '$w' } }] } }] }}
      theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />)
    expect(ui.container.textContent).toContain('an expression cannot assign ("=")')
    expect(field('ease w')).toBeTruthy()
    ui.unmount()
  })
  it('writes the recipes down: a weighted fraction, the first device, a count, names, unbound roles', () => {
    const { ui } = setup()
    for (const s of ['x / P.cap', 'P.<list read>[1]', 'R.<role>.n', 'R.<role>.names', 'VB.unbound()']) expect(ui.container.textContent).toContain(s)
    expect(Array.from(ui.container.querySelectorAll('#vb-data-names option'), o => o.getAttribute('value'))).toEqual(expect.arrayContaining(['R.tank.names', 'VB.unbound()']))
    ui.unmount()
  })
  it.each<[string, Binding]>([
    ['read:pressure', { from: 'read', read: 'pressure' }],
    ['read-state:pressure', { from: 'read', read: 'pressure', part: 'state' }],
    ['read-history:pressure', { from: 'read', read: 'pressure', part: 'history' }],
    ['expr', { from: 'expr', expr: '0' }], ['export', { from: 'export', name: 'value' }],
    ['log:k', { from: 'log', part: 'k' }], ['log:m', { from: 'log', part: 'm' }], ['log:t', { from: 'log', part: 't' }],
  ])('binds %s in one action while retaining unrelated bindings', async (value, binding) => {
    const other: Binding = { from: 'state', state: 'mode' }
    const { ui, actions, field } = setup({ reads: [{ id: 'pressure', role: 'tank', of: { lt: { name: 'Pressure' } }, history: { n: 10 } }], bindings: { bar1_st: other } })
    await run(() => setValue(field('source of bar1_lvl'), value))
    expect(actions).toEqual([{ type: 'setLogic', patch: { bindings: { bar1_st: other, bar1_lvl: binding } } }])
    ui.unmount()
  })
  it('merges names across pages and includes raw Unicode and native props', () => {
    const page = newProject().pages[0]
    const { ui } = setup({ pages: [page, { ...page, id: 'p2', name: 'Second', surface: 'second' }], })
    const project = newProject()
    project.pages = [
      { ...page, scene: { header: { w: 480, h: 480 }, defs: [], root: [{ op: 'T', attrs: { text: '$測定' } }] } },
      { ...page, id: 'p2', name: 'Second', surface: 'second', scene: { header: { w: 480, h: 480 }, defs: [], root: [{ op: 'T', attrs: { text: '$測定' } }] }, natives: [instance('textinput')] },
    ]
    ui.rerender(<DataPanel project={project} theme={vanillaPlus} dispatch={() => {}} catalog={cat} />)
    const row = ui.container.querySelector('[data-name="測定"]')!
    expect(row.textContent).toContain('Main, Second')
    expect(ui.container.querySelectorAll('[data-name="測定"]')).toHaveLength(1)
    expect(Array.from(ui.container.querySelectorAll('[data-name]'), e => e.getAttribute('data-name'))).toContain('@ti1.value')
    ui.unmount()
  })
  it('retains raw ease when binding a newly created read', async () => {
    const { ui, project, actions, field } = setup()
    project.pages = [{ ...project.pages[0], scene: { header: { w: 480, h: 480 }, defs: [], root: [{ op: 'R', attrs: { w: '$w' } }] } }]
    project.bindings = { w: { from: 'const', value: 1, ease: true } }
    ui.rerender(<DataPanel project={project} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />)
    await run(() => setValue(field('source of w'), 'new'))
    await run(() => setValue(field('new read type'), 'Pressure'))
    await run(() => (ui.container.querySelector('[aria-label="add the read"]') as HTMLButtonElement).click())
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.w).toEqual({ from: 'read', read: 'tankPressure', ease: true })
    ui.unmount()
  })
  it('creates an aggregate extension read with a unique id and preserves existing sources', async () => {
    const { ui, actions, field } = setup({ roles: [{ id: 'tank', name: 'Tanks', mode: 'all', prefabs: [] }],
      reads: [{ id: 'tankx1224', role: 'tank', of: { lt: { id: 1224 } } }],
      simDevices: [{ id: 's1', ref: 2, prefab: 'StructureGasSensor', role: 'tank', label: 'Tank', values: { '#1224': { kind: 'const', v: 7 } } }] })
    await run(() => setValue(field('source of bar1_lvl'), 'new'))
    await run(() => setValue(field('new read type'), ' #1224 '))
    await run(() => field('new read aggregate').querySelector<HTMLInputElement>('[value="list"]')!.click())
    await run(() => (ui.container.querySelector('[aria-label="add the read"]') as HTMLButtonElement).click())
    const patch = (actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch
    expect(patch.reads?.at(-1)).toEqual({ id: 'tankx12242', role: 'tank', of: { lt: { id: 1224 } }, agg: 'list' })
    expect(patch.simDevices?.[0].values['#1224']).toEqual({ kind: 'const', v: 7 })
    ui.unmount()
  })
  it('edits constants as numbers or text and retains custom export names', async () => {
    const { ui, project, actions, field } = setup({ bindings: { bar1_lvl: { from: 'const', value: 1 }, hdr1_warn: { from: 'export', name: 'warning' } } })
    await run(() => setValue(field('constant for bar1_lvl'), '12.5'))
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.bar1_lvl).toEqual({ from: 'const', value: 12.5 })
    await run(() => setValue(field('constant for bar1_lvl'), 'offline'))
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.bar1_lvl).toEqual({ from: 'const', value: 'offline' })
    await run(() => setValue(field('export for hdr1_warn'), 'customWarning'))
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings).toEqual({ ...project.bindings, hdr1_warn: { from: 'export', name: 'customWarning' } })
    ui.unmount()
  })
  it('warns when a state slot reads a value, clearing the hint for read state', () => {
    const { ui, project } = setup({ reads: [{ id: 'pressure', role: 'tank', of: { lt: { name: 'Pressure' } } }], bindings: { bar1_st: { from: 'read', read: 'pressure' } } })
    expect(ui.container.textContent).toContain("a state slot reads 0..3: bind the read's state")
    ui.rerender(<DataPanel project={{ ...project, bindings: { bar1_st: { from: 'read', read: 'pressure', part: 'state' } } }} theme={vanillaPlus} dispatch={() => {}} catalog={cat} />)
    expect(ui.container.textContent).not.toContain('a state slot reads 0..3')
    ui.unmount()
  })
  it('toggles raw ease in one action and preserves it when changing a source', async () => {
    const { ui, project, actions, field } = setup()
    const raw: Project = { ...project, pages: [{ ...project.pages[0], scene: { header: { w: 480, h: 480 }, defs: [], root: [{ op: 'R', attrs: { w: '$w' } }] } }], bindings: { w: { from: 'const', value: 1 } } }
    const render = (p: Project) => <DataPanel project={p} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />
    ui.rerender(render(raw))
    await run(() => (field('ease w') as HTMLInputElement).click())
    expect(actions).toEqual([{ type: 'setLogic', patch: { bindings: { w: { from: 'const', value: 1, ease: true } } } }])
    ui.rerender(render({ ...raw, bindings: { w: { from: 'const', value: 1, ease: true } } }))
    await run(() => setValue(field('source of w'), 'state:mode'))
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.w).toEqual({ from: 'state', state: 'mode', ease: true })
    await run(() => (field('ease w') as HTMLInputElement).click())
    expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.w).toEqual({ from: 'const', value: 1 })
    ui.unmount()
  })
  it('offers all three Header presets when the clock is visible', async () => {
    const { ui, project, actions } = setup()
    const page = newProject().pages[0]
    const wide = { ...page.scene, header: { w: 960, h: 480 } }
    ui.rerender(<DataPanel project={{ ...project, pages: [{ ...page, scene: putWidget(wide, instance('header', { clock: true }), vanillaPlus) }] }} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />)
    for (const [slot, expr] of [['clock', 'util.clock_time("HH:MM")'], ['crit', 'alarms(3)'], ['warn', 'alarms(2)']]) {
      await run(() => (ui.container.querySelector(`[aria-label="preset for hdr1_${slot}"]`) as HTMLButtonElement).click())
      expect((actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.bindings?.[`hdr1_${slot}`]).toEqual({ from: 'expr', expr })
    }
    ui.unmount()
  })
})
