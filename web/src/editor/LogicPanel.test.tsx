// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogOf } from '../catalog'
import { clickTargets } from '../codegen/clicks'
import { logicFrom } from '../model/logic'
import { newPage, newProject, type Project } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { parseSrc } from '../srctext/parse'
import { mount, run } from '../testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { addRole, LogicPanel, wire } from './LogicPanel'

it('renders optional role device content beside Advanced and nothing when undefined', () => {
  const p = newProject(); p.roles = [{ id: 'scan', name: 'Tank', mode: 'one', prefabs: [] }]
  const props = { project: p, theme: vanillaPlus, dispatch: () => {}, catalog: null }
  const ui = mount(<LogicPanel {...props} roleDevice={roleId => <span data-role-device>{roleId}</span>} />)
  try {
    const advanced = ui.container.querySelector('.vb-role-device')!
    expect(advanced.nextElementSibling?.textContent).toBe('scan')
    ui.rerender(<LogicPanel {...props} />)
    expect(ui.container.querySelector('[data-role-device]')).toBeNull()
  } finally { ui.unmount() }
})

it('keeps the specific-device reference behind collapsed Advanced without changing its value', async () => {
  const p = newProject(); p.roles = [{ id: 'scan', name: 'Tank', mode: 'one', prefabs: [], ref: 987654 }]
  const actions: Action[] = [], ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={null} />)
  try {
    const field = ui.container.querySelector<HTMLInputElement>('[aria-label="role ref scan"]')!
    const advanced = field.closest<HTMLDetailsElement>('details.vb-role-device')
    expect(advanced).not.toBeNull(); expect(advanced!.open).toBe(false)
    expect(advanced!.querySelector('summary')!.textContent).toContain('Pin to one specific device')
    expect(advanced!.querySelector('summary')!.textContent).toContain('Advanced')
    expect(field.value).toBe('987654')
    await run(() => setValue(field, '987655'))
    expect(actions.at(-1)).toMatchObject({ type: 'setLogic', patch: { roles: [{ ref: 987655 }] } })
  } finally { ui.unmount() }
})

it('opens five counted sections and named cards with the fixed choices segmented', () => {
  const p = newProject()
  p.roles = [{ id: 'one', name: 'One', mode: 'one', prefabs: [] }, { id: 'all', name: 'All', mode: 'all', prefabs: [], pin: 2 }]
  p.reads = [{ id: 'pressure', role: 'all', of: { lt: { name: 'Pressure' } } }]
  p.state = [{ name: 'n', type: 'number', init: 0 }, { name: 'b', type: 'bool', init: false }, { name: 'e', type: 'enum', init: 0, options: ['a'] }, { name: 's', type: 'string', init: '' }]
  p.actions = [{ id: 'action', on: 'hit', do: [{ op: 'log', text: '"hi"', level: 2 }] }]
  p.rules = [{ id: 'rule', role: 'one', lt: { name: 'On' }, value: '1' }]
  const ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    const sections = Array.from(ui.container.querySelectorAll<HTMLDetailsElement>('details.disc'))
    expect(sections.map(s => [s.querySelector('summary .ptitle')!.textContent, s.querySelector('summary .unit')!.textContent, s.open])).toEqual([
      ['Roles', '2', true], ['Reads', '1', true], ['State', '4', true], ['Actions', '1', true], ['Rules', '1', true],
    ])
    const cards = Array.from(ui.container.querySelectorAll<HTMLDetailsElement>('details.raised'))
    expect(cards).toHaveLength(9)
    expect(cards.every(card => card.open && card.querySelector(':scope > summary') && card.querySelector('.grid2'))).toBe(true)
    expect(cards[0].querySelector('summary')!.textContent).toContain('One')
    expect(cards[0].querySelector('summary')!.textContent).toContain('one · Scan')
    expect(cards[1].querySelector('summary')!.textContent).toContain('all · d2')
    for (const name of ['role mode one', 'role pin one', 'role mode all', 'role pin all', 'read aggregate pressure', 'state type n', 'state type b', 'state type e', 'state type s', 'step 0 of action level']) {
      expect(ui.container.querySelector(`[role="radiogroup"][aria-label="${name}"]`), name).not.toBeNull()
    }
    expect(ui.container.querySelector('[aria-label="read unit pressure"]')!.tagName).toBe('SELECT')
  } finally { ui.unmount() }
})

type Field = HTMLInputElement | HTMLSelectElement
it('offers aggregation only for all-device reads', () => {
  const p = newProject()
  p.roles = [{ id: 'one', name: 'One', mode: 'one', prefabs: [] }, { id: 'all', name: 'All', mode: 'all', prefabs: [] }]
  p.reads = p.roles.map(r => ({ id: r.id, role: r.id, of: { lt: { name: 'Pressure' } } }))
  const ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    expect(ui.container.querySelector('[aria-label="read aggregate one"]')).toBeNull()
    expect(ui.container.querySelector('[aria-label="read aggregate all"]')).not.toBeNull()
  } finally { ui.unmount() }
})

it('retains the applied map range after the model updates', async () => {
  let state = initialState(newProject())
  state.project.roles = [{ id: 'one', name: 'One', mode: 'one', prefabs: [] }]
  state.project.reads = [{ id: 'p', role: 'one', of: { lt: { name: 'Pressure' } } }]
  const render = () => <LogicPanel project={state.project} theme={vanillaPlus} catalog={null} dispatch={a => { state = reducer(state, a); ui.rerender(render()) }} />
  const ui = mount(render())
  try {
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="read map p"]')!
    await run(() => setValue(input, '200..400'))
    await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(state.project.reads[0]).toMatchObject({ scale: 0.005, offset: -1, clamp: [0, 1] })
    expect(input.value).toBe('200..400')
    ui.rerender(<LogicPanel key="reopened" project={state.project} theme={vanillaPlus} catalog={null} dispatch={() => {}} />)
    expect(ui.container.querySelector<HTMLInputElement>('[aria-label="read map p"]')!.value).toBe('200..400')
  } finally { ui.unmount() }
})

it('names page destinations while keeping page ids as values', () => {
  const p = newProject(); p.pages[0].name = 'Overview'
  p.actions = [{ id: 'go', on: 'hit', do: [{ op: 'page', page: p.pages[0].id }] }]
  const ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    const select = ui.container.querySelector<HTMLSelectElement>('[aria-label="step 0 of go page"]')!
    expect(select.selectedOptions[0].textContent).toBe('Overview')
    expect(select.value).toBe(p.pages[0].id)
  } finally { ui.unmount() }
})

const setValue = (e: Field, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const cat = catalogOf(json('../catalog/devices.json'), json('../catalog/enums.json'))
const withWidgets = (...types: string[]): Project => {
  const p = newProject()
  p.pages[0] = { ...p.pages[0], scene: types.reduce((s, type) => putWidget(s, instance(type), vanillaPlus), p.pages[0].scene) }
  return p
}

describe('wire', () => {
  it('wires a nested multi-state button through its renamed slot and parameter range', () => {
    const p = newProject(), w = instance('button', { states: [{ label: 'A', variant: 'secondary' }, { label: 'B', variant: 'primary' }, { label: 'C', variant: 'danger' }], keys: { state: 'mode' } })
    const s = putWidget(p.pages[0].scene, w, vanillaPlus)
    p.pages[0].scene = { ...s, root: [{ op: 'G', attrs: {}, c: s.root }] }
    const target = clickTargets(p.pages[0], vanillaPlus)[0], patch = wire(p, target, vanillaPlus)!
    expect(patch.bindings).toEqual({ mode: { from: 'state', state: 'btn1_state' } })
    expect(patch.state![0]).toMatchObject({ max: 2 })
  })
  it('turns a Toggle plate into a bool state, a toggle action and the slot\'s binding', () => {
    const p = withWidgets('toggle'), [target] = clickTargets(p.pages[0], vanillaPlus)
    expect(wire(p, target, vanillaPlus)).toEqual({ state: [{ name: 'tg1_on', type: 'bool', init: false }],
      actions: [{ id: 'a_tg1_hit', on: 'tg1_hit', do: [{ op: 'toggle', state: 'tg1_on' }] }], bindings: { tg1_on: { from: 'state', state: 'tg1_on' } } })
  })
  it('wires both Stepper plates to one number state in its range', () => {
    let p = withWidgets('stepper')
    const [dec, inc] = clickTargets(p.pages[0], vanillaPlus)
    p = { ...p, ...wire(p, dec, vanillaPlus) }
    const second = wire(p, inc, vanillaPlus)!
    expect(second.state).toEqual(p.state)
    expect(second.actions!.map(a => a.do[0])).toEqual([expect.objectContaining({ op: 'step', state: 'stp1_v' }), expect.objectContaining({ op: 'step', state: 'stp1_v' })])
  })
  it('wires a page tab as an action alone, and nothing for a repeat plate', () => {
    const p = withWidgets('tabs', 'repeater')
    const t = clickTargets({ ...p.pages[0], scene: putWidget(p.pages[0].scene, instance('repeater', { click: true }, 'rep9'), vanillaPlus) }, vanillaPlus)
    expect(wire(p, t[0], vanillaPlus)).toEqual({ actions: [{ id: 'a_nav1_t0', on: 'nav1_t0', do: [{ op: 'page', page: 'p1' }] }] })
    expect(wire(p, t.find(x => x.id === 'rep9_r')!, vanillaPlus)).toBeNull()
  })
  it('wires a text input: a string state, a set step with E.v, the native\'s value binding (native value binding)', () => {
    const p = newProject()
    p.pages[0] = { ...p.pages[0], natives: [instance('textinput')] }
    const [ti] = clickTargets(p.pages[0], vanillaPlus)
    expect(wire(p, ti, vanillaPlus)).toEqual({ state: [{ name: 'ti1_value', type: 'string', init: '' }],
      actions: [{ id: 'a_ti1', on: 'ti1', do: [{ op: 'set', state: 'ti1_value', value: 'E.v' }] }], bindings: { '@ti1.value': { from: 'state', state: 'ti1_value' } } })
  })
  it('wires cycle states and option plates with their suggested steps', () => {
    const p = withWidgets('toggle')
    const [target] = clickTargets(p.pages[0], vanillaPlus)
    const cycle = wire(p, { ...target, step: 'cycle' }, vanillaPlus)!
    expect(cycle.state).toEqual([{ name: 'tg1_state', type: 'number', init: 0, min: 0, max: 1 }])
    expect(cycle.actions![0].do).toEqual([{ op: 'cycle', state: 'tg1_state' }])
    const select = wire(p, { ...target, step: 'set(2)' }, vanillaPlus)!
    expect(select.state).toEqual([{ name: 'tg1_sel', type: 'number', init: 0 }])
    expect(select.actions![0].do).toEqual([{ op: 'set', state: 'tg1_sel', value: '2' }])
    expect(wire(p, { ...target, step: '' }, vanillaPlus)).toBeNull()
  })
})

describe('LogicPanel validation and typing', () => {
  const role = { id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' as const }
  const read = { id: 'p', role: 'tank', of: { lt: { name: 'Temperature' } }, history: { n: 10 }, smooth: 1, th: { hyst: 1 } }
  const project = (): Project => ({ ...newProject(), roles: [role], reads: [read],
    state: [{ name: 'n', type: 'number', init: 0, min: 0, max: 10 }, { name: 'mode', type: 'enum', init: 2, options: ['a', 'b', 'c'] },
      { name: 'text', type: 'string', init: '' }],
    actions: [{ id: 'a', on: 'x', do: [{ op: 'command', flag: 'go' }, { op: 'call', fn: 'f' },
      { op: 'step', state: 'n', by: 1, min: 0, max: 10 }] }], rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: '0' }],
    simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: {} }] })
  const setup = (p = project()) => {
    let state = initialState(p)
    const actions: Action[] = []
    const dispatch = (a: Action) => { actions.push(a); state = reducer(state, a) }
    const render = () => <LogicPanel project={state.project} theme={vanillaPlus} dispatch={dispatch} catalog={cat} />
    const ui = mount(render())
    const field = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field
    const change = async (label: string, text: string) => {
      await run(() => setValue(field(label), text))
      ui.rerender(render())
    }
    const blur = async (label: string) => {
      await run(() => { field(label).dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      ui.rerender(render())
    }
    const enter = async (label: string) => {
      await run(() => { field(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      ui.rerender(render())
    }
    const type = async (label: string, text: string) => {
      await change(label, '')
      for (let i = 1; i <= text.length; i++) {
        await change(label, text.slice(0, i))
        expect(field(label).value).toBe(text.slice(0, i))
      }
    }
    return { ui, field, change, blur, enter, type, actions, state: () => state }
  }

  it.each([
    ['read history p', '-1'], ['read history p', '0'], ['read history p', '1.5'],
    ['read history every p', '0'], ['read history every p', '2.5'],
    ['read smooth p', '-1'], ['read smooth p', '0'], ['read hyst p', '0'], ['read hyst p', '-1'],
    ['state min n', '11'], ['state max n', '-1'], ['state options mode', 'a, b'], ['state options mode', ''],
    ['role ref tank', '1.5'], ['state units text', '-1'],
    ['step 0 of a flag', 'end'], ['step 1 of a fn', 'bad name'],
    ['read valid p', '0..1e13'], ['read clamp p', 'bad range'],
    ['read map p', '0..1e-320'], ['read map p', '1..1.0000000000001'],
    ['read type p', `#${'9'.repeat(400)}`], ['rule r type', `#${'9'.repeat(400)}`],
  ])('refuses invalid %s = %s with an explanation and keeps the model intact', async (label, text) => {
    const p = project(), h = setup(p)
    await h.change(label, text)
    await h.blur(label)
    expect(h.state().project).toEqual(p)
    expect(h.state().past).toHaveLength(0)
    expect(h.field(label).getAttribute('aria-invalid')).toBe('true')
    const description = h.field(label).getAttribute('aria-describedby')
    expect(description).toBeTruthy()
    expect(h.ui.container.querySelector(`[id="${description}"]`)!.textContent!.length).toBeGreaterThan(0)
    h.ui.unmount()
  })

  it('refuses an enum init beyond its options', async () => {
    const p = project(), h = setup(p)
    const field = h.field('state init mode') as HTMLSelectElement
    const option = document.createElement('option')
    option.value = '99'; option.textContent = 'out of range'; field.add(option)
    await h.change('state init mode', '99')
    expect(h.state().project).toEqual(p)
    expect(h.field('state init mode').getAttribute('aria-invalid')).toBe('true')
    h.ui.unmount()
  })

  it.each([['read source p min', '500'], ['read source p max', '100'], ['read source p min', '300']])(
    'refuses an invalid simulated source range in %s', async (label, text) => {
      const p = project(), h = setup(p)
      await h.change(label, text)
      await h.blur(label)
      expect(h.state().project).toEqual(p)
      expect(h.ui.container.textContent).toContain('Source')
      expect(h.state().past).toHaveLength(0)
      h.ui.unmount()
    })

  it.each([['step 2 of a min', '11'], ['step 2 of a max', '-1']])(
    'refuses reversed numeric step bounds in %s', async (label, text) => {
      const p = project(), h = setup(p)
      await h.change(label, text)
      await h.blur(label)
      expect(h.state().project).toEqual(p)
      expect(h.ui.container.textContent).toContain('bound')
      expect(h.state().past).toHaveLength(0)
      h.ui.unmount()
    })

  it('accepts corrected history and smoothing values that survive sanitization', async () => {
    const h = setup()
    await h.change('read history p', '-1')
    await h.change('read history p', '12')
    await h.blur('read history p')
    await h.change('read smooth p', '0')
    await h.change('read smooth p', '0.5')
    await h.blur('read smooth p')
    expect(h.state().project.reads[0]).toMatchObject({ history: { n: 12 }, smooth: 0.5 })
    expect(logicFrom(h.state().project).logic.reads).toEqual(h.state().project.reads)
    expect(h.state().past).toHaveLength(2)
    h.ui.unmount()
  })

  it('types prefab lists, enum options and slot reads character by character, committing on blur or Enter', async () => {
    const h = setup()
    const prefabs = 'StructureGasSensor, StructureActiveVent'
    await h.type('role prefabs tank', prefabs)
    expect(h.state().project.roles[0].prefabs).toEqual(role.prefabs)
    await h.blur('role prefabs tank')
    expect(h.state().project.roles[0].prefabs).toEqual(['StructureGasSensor', 'StructureActiveVent'])
    await h.type('state options mode', 'a, b, c, d')
    await h.enter('state options mode')
    expect(h.state().project.state[1].options).toEqual(['a', 'b', 'c', 'd'])
    await h.type('read type p', '0:Quantity')
    expect(h.state().project.reads[0].of).toEqual(read.of)
    await h.blur('read type p')
    expect(h.state().project.reads[0].of).toEqual({ slot: 0, lst: 'Quantity' })
    expect(h.state().past).toHaveLength(3)
    h.ui.unmount()
  }, 10_000) // measured: 0.779 s focused, 3.207 s full suite; at least 3x headroom

  it('commits a range field on Enter once, and blur does not repeat it', async () => {
    const h = setup()
    await h.type('read valid p', '2..4')
    expect(h.state().past).toHaveLength(0)
    await h.enter('read valid p')
    expect(h.state().project.reads[0].valid).toEqual([2, 4])
    expect(h.state().past).toHaveLength(1)
    await h.blur('read valid p')
    expect(h.state().past).toHaveLength(1)
    h.ui.unmount()
  })

  it('adds only the committed LogicType preview source', async () => {
    const h = setup()
    await h.change('read type p', 'Pressur')
    await h.change('read type p', 'Pressure')
    expect(Object.keys(h.state().project.simDevices[0].values)).toEqual([])
    expect(h.state().project.reads[0].of).toEqual(read.of)
    await h.enter('read type p')
    expect(Object.keys(h.state().project.simDevices[0].values)).toEqual(['Pressure'])
    expect(h.state().project.reads[0].of).toEqual({ lt: { name: 'Pressure' } })
    expect(h.state().past).toHaveLength(1)
    await h.blur('read type p')
    expect(h.state().past).toHaveLength(1)
    expect(reducer(h.state(), { type: 'undo' }).project).toEqual(project())
    h.ui.unmount()
  })

  it.each([
    ['role name tank', 'Edited'], ['role label tank', 'Edited'], ['read scale p', '123456'],
    ['read log p', 'Edited'], ['state init text', 'Edited'], ['step 0 of a flag', 'edited'],
    ['rule value r', 'S.n + 1'], ['read derived p', 'x * 2'],
  ])('groups a typing burst in %s into one undo step', async (label, text) => {
    const p = project(), h = setup(p)
    await h.type(label, text)
    expect(h.state().past).toHaveLength(0)
    await h.enter(label)
    expect(h.state().past).toHaveLength(1)
    expect(h.state().project).not.toEqual(p)
    await h.blur(label)
    expect(h.state().past).toHaveLength(1)
    expect(reducer(h.state(), { type: 'undo' }).project).toEqual(p)
    expect(reducer(reducer(h.state(), { type: 'undo' }), { type: 'redo' }).project).toEqual(h.state().project)
    h.ui.unmount()
  })

  it.each([
    ['role id tank', 'role', 'tank'], ['read id p', 'read', 'p'], ['state name n', 'state', 'n'],
  ])('explains a rejected rename in %s and allows correction', async (label, kind, from) => {
    const p = project()
    p.roles.push({ ...role, id: 'other' })
    p.reads.push({ ...read, id: 'otherRead' })
    const h = setup(p)
    await h.change(label, 'end')
    await h.blur(label)
    expect(h.state().past).toHaveLength(0)
    expect(h.field(label).getAttribute('aria-invalid')).toBe('true')
    expect(h.ui.container.textContent).toContain('Lua name')
    await h.change(label, kind === 'state' ? 'mode' : kind === 'role' ? 'other' : 'otherRead')
    await h.blur(label)
    expect(h.field(label).getAttribute('aria-invalid')).toBe('true')
    expect(h.ui.container.textContent).toContain('exists already')
    await h.change(label, 'fresh')
    await h.blur(label)
    expect(h.actions).toContainEqual({ type: 'renameLogic', kind, from, to: 'fresh' })
    expect(h.state().past).toHaveLength(1)
    h.ui.unmount()
  })
})

describe('addRole', () => {
  it('adds a role and its simulated device, labelled with the prefab\'s title', () => {
    expect(addRole(newProject(), 'StructureGasSensor', cat)).toEqual({
      roles: [{ id: 'gasSensor', name: 'Gas Sensor', prefabs: ['StructureGasSensor'], mode: 'one' }],
      simDevices: [{ id: 'sim2', prefab: 'StructureGasSensor', label: 'Gas Sensor', ref: 2, role: 'gasSensor', values: {} }] })
  })
})

describe('LogicPanel', () => {
  const setup = (p: Project) => {
    const actions: Action[] = []
    const ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />)
    return { ui, actions, field: (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field,
      button: (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement }
  }
  it('wires a widget plate in one setLogic', async () => {
    const { ui, actions, button } = setup(withWidgets('toggle'))
    await run(() => button('wire tg1_hit').click())
    expect(actions).toHaveLength(1)
    expect(actions[0]).toMatchObject({ type: 'setLogic', patch: { state: [{ name: 'tg1_on' }] } })
    ui.unmount()
  })
  it('renames a role on blur with renameLogic; a rule on a write-only type is a pulse', async () => {
    const p = { ...newProject(), roles: [{ id: 'inj', name: 'Injectors', prefabs: ['ItemInjectorEpi'], mode: 'all' as const }],
      rules: [{ id: 'r1', role: 'inj', lt: { name: 'On' }, value: '1' }] }
    const { ui, actions, field } = setup(p)
    await run(() => setValue(field('role id inj'), 'epi'))
    await run(() => { field('role id inj').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(actions.at(-1)).toEqual({ type: 'renameLogic', kind: 'role', from: 'inj', to: 'epi' })
    await run(() => setValue(field('rule r1 type'), 'Activate'))
    await run(() => { field('rule r1 type').dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(actions.at(-1)).toEqual({ type: 'setLogic', patch: { rules: [{ id: 'r1', role: 'inj', lt: { name: 'Activate' }, value: '1', pulse: true }] } })
    ui.unmount()
  })

  // Every editable field is reachable through its control and commits with the surrounding edit.
  const blur = (e: Element) => { e.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) }
  const role = { id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' as const }
  const read = { id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }
  const patch = (actions: Action[]) => (actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch
  it('sets a role\'s pin with its simulated device\'s, its ref, and optional', async () => {
    const { ui, actions, field } = setup({ ...newProject(), roles: [role], simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: {} }] })
    await run(() => field('role pin tank').querySelector<HTMLInputElement>('[value="2"]')!.click())
    expect(patch(actions)).toEqual({ roles: [{ ...role, pin: 2 }], simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: {}, pin: 2 }] })
    await run(() => setValue(field('role ref tank'), '123'))
    expect(patch(actions)).toEqual({ roles: [{ ...role, ref: 123 }] })
    await run(() => (field('role optional tank') as HTMLInputElement).click())
    expect(patch(actions)).toEqual({ roles: [{ ...role, optional: true }] })
    ui.unmount()
  })
  it('takes a read\'s clamp and valid range as lo..hi, maps lo..hi to 0..1 in one patch, its log and history every', async () => {
    const { ui, actions, field } = setup({ ...newProject(), roles: [role], reads: [{ ...read, history: { n: 10 } }] })
    await run(() => setValue(field('read clamp p'), '5..0'))
    await run(() => blur(field('read clamp p')))
    expect(patch(actions)).toEqual({ reads: [{ ...read, history: { n: 10 }, clamp: [0, 5] }] })
    await run(() => setValue(field('read valid p'), '-1..1e9'))
    await run(() => blur(field('read valid p')))
    expect(patch(actions)).toEqual({ reads: [{ ...read, history: { n: 10 }, valid: [-1, 1e9] }] })
    await run(() => setValue(field('read map p'), '200..400'))
    await run(() => blur(field('read map p')))
    expect(patch(actions)).toEqual({ reads: [{ ...read, history: { n: 10 }, scale: 0.005, offset: -1, clamp: [0, 1] }] })
    await run(() => setValue(field('read log p'), 'Tank'))
    expect(patch(actions)).toEqual({ reads: [{ ...read, history: { n: 10 }, th: { log: 'Tank' } }] })
    await run(() => setValue(field('read history every p'), '4'))
    expect(patch(actions)).toEqual({ reads: [{ ...read, history: { n: 10, every: 4 } }] })
    expect(Array.from(ui.container.querySelectorAll('#vb-readable-p option'), o => o.getAttribute('value'))).toContain('Pressure')
    ui.unmount()
  })
  it('edits a state\'s init; a type change keeps save', async () => {
    const n = { name: 'n', type: 'number' as const, init: 0, min: 0, max: 5, save: false }
    const { ui, actions, field } = setup({ ...newProject(), state: [n] })
    await run(() => setValue(field('state init n'), '3'))
    expect(patch(actions)).toEqual({ state: [{ ...n, init: 3 }] })
    await run(() => field('state type n').querySelector<HTMLInputElement>('[value="string"]')!.click())
    expect(patch(actions)).toEqual({ state: [{ name: 'n', type: 'string', init: '', save: false }] })
    ui.unmount()
  })
  it('edits every step by its op; adds an action to a raw node, scoped when its id is on several pages', async () => {
    const p = { ...newProject(), state: [{ name: 'mode', type: 'number' as const, init: 0 }],
      actions: [{ id: 'a', on: 'x', do: [{ op: 'set' as const, state: 'mode', value: '1' }, { op: 'log' as const, text: '"hi"' }] }] }
    p.pages.push({ ...newPage(p), scene: parseSrc('SCENE w=480 h=480\nR id=back click=1 x=0 y=0 w=9 h=9\n').scene! })
    p.pages[0] = { ...p.pages[0], scene: parseSrc('SCENE w=480 h=480\nR id=back click=1 x=0 y=0 w=9 h=9\n').scene! }
    const { ui, actions, field, button } = setup(p)
    await run(() => setValue(field('step 0 of a value'), 'S.mode + 1'))
    expect(patch(actions).actions![0].do[0]).toEqual({ op: 'set', state: 'mode', value: 'S.mode + 1' })
    await run(() => field('step 1 of a level').querySelector<HTMLInputElement>('[value="2"]')!.click())
    expect(patch(actions).actions![0].do[1]).toEqual({ op: 'log', text: '"hi"', level: 2 })
    await run(() => button(`add action ${p.pages[1].id}/back`).click())
    expect(patch(actions).actions!.at(-1)).toEqual({ id: 'a_back', on: 'back', page: p.pages[1].id, do: [] })
    ui.unmount()
  })
  it('makes any rule a pulse by its checkbox, and moves rules in their order', async () => {
    const rules = [{ id: 'r1', role: 'tank', lt: { name: 'On' }, value: '1' }, { id: 'r2', role: 'tank', lt: { name: 'Mode' }, value: '0' }]
    const { ui, actions, field, button } = setup({ ...newProject(), roles: [role], rules })
    await run(() => (field('rule pulse r2') as HTMLInputElement).click())
    expect(patch(actions)).toEqual({ rules: [rules[0], { ...rules[1], pulse: true }] })
    await run(() => button('rule down r1').click())
    expect(patch(actions)).toEqual({ rules: [rules[1], rules[0]] })
    ui.unmount()
  })

  it('refreshes numeric and expression bounds after undo, and keeps incomplete numeric input local', async () => {
    const p: Project = { ...newProject(), state: [{ name: 'n', type: 'number', init: 3, min: 2 }],
      actions: [{ id: 'a', on: 'x', do: [{ op: 'step', state: 'n', by: 2, min: 'P.lo', max: 9 }] }] }
    const { ui, actions, field } = setup(p)
    await run(() => setValue(field('state init n'), '-'))
    await run(() => setValue(field('state min n'), '-'))
    expect(field('state init n').value).toBe('-')
    expect(actions).toHaveLength(0)
    ui.rerender(<LogicPanel project={{ ...p, state: [{ name: 'n', type: 'number', init: 7 }],
      actions: [{ ...p.actions[0], do: [{ op: 'step', state: 'n', by: 1, min: 'P.other', max: 12 }] }] }}
      theme={vanillaPlus} dispatch={a => actions.push(a)} catalog={cat} />)
    expect(field('state init n').value).toBe('7')
    expect(field('state min n').value).toBe('')
    expect(field('step 0 of a by').value).toBe('1')
    expect(field('step 0 of a min').value).toBe('P.other')
    expect(field('step 0 of a max').value).toBe('12')
    await run(() => setValue(field('step 0 of a min'), 'function() end'))
    expect(patch(actions).actions![0].do[0]).toMatchObject({ min: 'function() end' })
    expect(ui.container.querySelector(`[aria-label="step 0 of a min"]`)!.getAttribute('aria-describedby')).toBeTruthy()
    ui.unmount()
  })

  it('reuses a renamed wired state for the other Stepper plate', () => {
    let p = withWidgets('stepper')
    const [dec, inc] = clickTargets(p.pages[0], vanillaPlus)
    p = { ...p, ...wire(p, dec, vanillaPlus) }
    p = { ...p, state: [{ ...p.state[0], name: 'desired' }],
      bindings: { stp1_v: { from: 'state', state: 'desired' } } }
    const second = wire(p, inc, vanillaPlus)!
    expect(second.state).toEqual(p.state)
    expect(second.actions!.at(-1)!.do[0]).toMatchObject({ state: 'desired' })
    expect(second.bindings).toEqual(p.bindings)
  })

  it('allocates a free name when an unrelated state holds the suggested name', () => {
    const p: Project = { ...withWidgets('toggle'), state: [{ name: 'tg1_on', type: 'string', init: 'unrelated' }] }
    const [target] = clickTargets(p.pages[0], vanillaPlus)
    const wired = wire(p, target, vanillaPlus)!
    expect(wired.state).toEqual([...p.state, { name: 'tg1_on2', type: 'bool', init: false }])
    expect(wired.bindings).toEqual({ tg1_on: { from: 'state', state: 'tg1_on2' } })
  })

  it('offers a preview source even when the simulated device has no value yet', async () => {
    const p: Project = { ...newProject(), roles: [role], reads: [read],
      simDevices: [{ id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: {} }] }
    const { ui, actions, field } = setup(p)
    expect(field('read source p kind')).not.toBeNull()
    await run(() => field('read source p kind').querySelector<HTMLInputElement>('[value="sine"]')!.click())
    expect(patch(actions).simDevices![0].values.Pressure).toEqual({ kind: 'sine', mid: 0, amp: 1, period: 10 })
    expect(p.simDevices[0].values).toEqual({})
    ui.unmount()
  })

  it('edits a slot read preview in the device slots and applies it to all devices of the role', async () => {
    const p: Project = { ...newProject(), roles: [role], reads: [{ ...read, of: { slot: 1, lst: 'Quantity' } }], simDevices: [
      { id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: { Pressure: { kind: 'const', v: 1 } },
        slots: { '1': { Quantity: { kind: 'const', v: 4 } }, '2': { Quantity: { kind: 'const', v: 8 } } } },
      { id: 's2', prefab: 'StructureGasSensor', label: 'T2', ref: 3, role: 'tank', values: {} },
    ] }
    const { ui, actions, field, button } = setup(p)
    expect(field('read source p value')).not.toBeNull()
    await run(() => setValue(field('read source p value'), '7'))
    expect(patch(actions).simDevices![0]).toEqual({ ...p.simDevices[0], slots: { ...p.simDevices[0].slots,
      '1': { Quantity: { kind: 'const', v: 7 } } } })
    expect(patch(actions).simDevices![1]).toEqual(p.simDevices[1])
    await run(() => button('read source to all p').click())
    expect(patch(actions).simDevices![1].slots).toEqual({ '1': { Quantity: { kind: 'const', v: 4 } } })
    ui.unmount()
  })

  it('edits action and rule ids on blur and explains an empty or duplicate id', async () => {
    const p: Project = { ...newProject(), roles: [role], actions: [{ id: 'a', on: 'x', do: [] }, { id: 'taken', on: 'y', do: [] }],
      rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: '0' }] }
    const { ui, actions, field } = setup(p)
    expect(field('action id a')).not.toBeNull()
    await run(() => setValue(field('action id a'), 'renamed'))
    expect(actions).toHaveLength(0)
    await run(() => blur(field('action id a')))
    expect(patch(actions).actions).toEqual([{ ...p.actions[0], id: 'renamed' }, p.actions[1]])
    await run(() => setValue(field('rule id r'), 'rule-id'))
    await run(() => blur(field('rule id r')))
    expect(patch(actions).rules).toEqual([{ ...p.rules[0], id: 'rule-id' }])
    const count = actions.length
    await run(() => setValue(field('action id a'), 'taken'))
    await run(() => blur(field('action id a')))
    expect(actions).toHaveLength(count)
    expect(field('action id a').getAttribute('aria-invalid')).toBe('true')
    expect(ui.container.textContent).toContain('exists already')
    await run(() => setValue(field('rule id r'), ''))
    await run(() => blur(field('rule id r')))
    expect(actions).toHaveLength(count)
    expect(field('rule id r').getAttribute('aria-invalid')).toBe('true')
    ui.unmount()
  })

  it('commits wire, add-role and slider gestures as single undo steps', async () => {
    const p = withWidgets('toggle')
    let s = initialState(p)
    const dispatch = (a: Action) => { s = reducer(s, a) }
    const ui = mount(<LogicPanel project={s.project} theme={vanillaPlus} dispatch={dispatch} catalog={cat} />)
    const button = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
    await run(() => button('wire tg1_hit').click())
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project).toEqual(p)
    ui.rerender(<LogicPanel project={s.project} theme={vanillaPlus} dispatch={dispatch} catalog={cat} />)
    await run(() => setValue(ui.container.querySelector('[aria-label="new role prefab"]') as Field, 'StructureGasSensor'))
    await run(() => button('add role').click())
    expect(s.past).toHaveLength(2)
    expect(s.project.roles).toHaveLength(1)
    expect(s.project.simDevices).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project.roles).toHaveLength(0)
    expect(reducer(s, { type: 'undo' }).project.simDevices).toHaveLength(0)
    s = initialState({ ...newProject(), roles: [role], reads: [read], simDevices: [
      { id: 's', prefab: 'StructureGasSensor', label: 'T', ref: 2, role: 'tank', values: { Pressure: { kind: 'slider', v: 0, min: 0, max: 100 } } },
      { id: 's2', prefab: 'StructureGasSensor', label: 'T2', ref: 3, role: 'tank', values: { Pressure: { kind: 'const', v: 1 } } },
    ] })
    const render = () => ui.rerender(<LogicPanel project={s.project} theme={vanillaPlus} dispatch={dispatch} catalog={cat} />)
    render()
    const slider = ui.container.querySelector('[aria-label="read source p value"]') as HTMLInputElement
    await run(() => setValue(slider, '20'))
    render()
    await run(() => setValue(slider, '30'))
    expect(s.past).toHaveLength(0)
    await run(() => { slider.dispatchEvent(new Event('pointerup', { bubbles: true })) })
    expect(s.past).toHaveLength(1)
    expect(reducer(s, { type: 'undo' }).project.simDevices[0].values.Pressure).toMatchObject({ v: 0 })
    render()
    await run(() => button('read source to all p').click())
    expect(s.project.simDevices.every(d => d.values.Pressure.kind === 'slider' && d.values.Pressure.v === 30)).toBe(true)
    ui.unmount()
  })

  it('edits page, toggle, cycle, command and call steps and clears a pulse on a readable type', async () => {
    const p: Project = { ...newProject(), roles: [role], state: [{ name: 'x', type: 'number', init: 0 }, { name: 'y', type: 'number', init: 0 }],
      actions: [{ id: 'a', on: 'node', do: [{ op: 'page', page: 'p1' }, { op: 'toggle', state: 'x' },
        { op: 'cycle', state: 'x' }, { op: 'command', flag: 'go' }, { op: 'call', fn: 'f' }] }],
      rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: '0', pulse: true }] }
    const { ui, actions, field } = setup(p)
    const edits = [['page', 'vb_devices'], ['state', 'y'], ['state', 'y'], ['flag', 'stop'], ['fn', 'handler']]
    for (const [i, [key, value]] of edits.entries()) {
      await run(() => setValue(field(`step ${i} of a ${key}`), value))
      await run(() => blur(field(`step ${i} of a ${key}`)))
      expect(patch(actions).actions![0].do[i]).toMatchObject({ [key]: value })
    }
    await run(() => setValue(field('rule r type'), 'Pressure'))
    await run(() => blur(field('rule r type')))
    expect(patch(actions).rules![0]).not.toHaveProperty('pulse')
    ui.unmount()
  })
})

it.each(['derived', 'when'] as const)('optional %s accepts an empty expression but validates non-empty text', async key => {
  const p = newProject()
  p.roles = [{ id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' }]
  p.reads = [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }]
  p.actions = [{ id: 'a', on: 'hit', do: [] }]
  let state = initialState(p)
  const dispatch = (a: Action) => { state = reducer(state, a); ui.rerender(view()) }
  const view = () => <LogicPanel project={state.project} theme={vanillaPlus} dispatch={dispatch} catalog={null} />
  const ui = mount(view())
  try {
    const input = ui.container.querySelector<HTMLInputElement>(key === 'derived' ? '[aria-label="read derived p"]' : '[aria-label="action when a"]')!
    const why = () => input.closest('.vb-expr')!.querySelector('.vb-expr-why')
    expect(why()).toBeNull()
    await run(() => setValue(input, '('))
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(why()).not.toBeNull()
    await run(() => setValue(input, '1'))
    expect(why()).toBeNull()
    await run(() => setValue(input, ''))
    expect(why()).toBeNull()
    expect(key === 'derived' ? state.project.reads[0] : state.project.actions[0]).not.toHaveProperty(key)
  } finally { ui.unmount() }
})

it('required Logic expressions retain empty-expression validation', () => {
  const p: Project = { ...newProject(),
    roles: [{ id: 'tank', name: 'Tank', prefabs: ['StructureGasSensor'], mode: 'one' }],
    state: [{ name: 'n', type: 'number', init: 0 }],
    actions: [{ id: 'a', on: 'hit', do: [{ op: 'set', state: 'n', value: '' }, { op: 'log', text: '' },
      { op: 'step', state: 'n', by: 1, min: '', max: '' }] }],
    rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: '' }] }
  const ui = mount(<LogicPanel project={p} theme={vanillaPlus} dispatch={() => {}} catalog={null} />)
  try {
    for (const label of ['step 0 of a value', 'step 1 of a text', 'step 2 of a min', 'step 2 of a max', 'rule value r']) {
      const input = ui.container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!
      expect(input.getAttribute('aria-invalid'), label).toBe('true')
      expect(input.closest('.vb-expr')!.querySelector('.vb-expr-why')?.textContent, label).toBe('an expression is empty')
    }
  } finally { ui.unmount() }
})
