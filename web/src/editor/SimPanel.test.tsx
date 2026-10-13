// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { catalogOf } from '../catalog'
import { newProject, type Project } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { mount, run } from '../testing'
import { SimPanel } from './SimPanel'

it('includes visible chip setting labels in their accessible names', () => {
  const ui = mount(<SimPanel project={newProject()} dispatch={() => {}} catalog={null} writes={[]} notes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />)
  try {
    for (const name of ['budget at load', 'budget per tick', 'wipe persist on re-export']) {
      const input = ui.container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!
      expect(input.getAttribute('aria-label')).toContain(input.closest('label')!.textContent!.trim())
    }
  } finally { ui.unmount() }
})

it('names simulated devices by label or prefab without exposing reference ids', () => {
  const p = newProject(); p.simDevices = [{ id: 'internal', ref: 987654, label: '', prefab: 'Tank', values: {} }]
  const ui = mount(<SimPanel project={p} dispatch={() => {}} catalog={null} writes={[]} notes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />)
  try {
    const summary = ui.container.querySelector('.vb-sim-device > summary')!
    expect(summary.textContent).toContain('Tank')
    expect(summary.textContent).not.toContain('987654')
    expect(summary.textContent).not.toContain('internal')
  } finally { ui.unmount() }
})
it('names write destinations by label or prefab and never falls back to a reference id', () => {
  const p = newProject(); p.simDevices = [{ id: 'one', ref: 987654, label: 'Tank', prefab: 'Sensor', values: {} }, { id: 'two', ref: 987655, label: '', prefab: 'Pump', values: {} }]
  const writes = [987654, 987655, 987656].map(ref => ({ ref, lt: 1, slot: -1, value: 0, stored: true }))
  const ui = mount(<SimPanel project={p} dispatch={() => {}} catalog={null} writes={writes} notes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />)
  try {
    expect(Array.from(ui.container.querySelectorAll('.vb-writes li'), el => el.textContent?.split(':')[0])).toEqual(['Tank', 'Pump', 'Device no longer in this project'])
    expect(ui.container.querySelector('.vb-writes')!.textContent).not.toMatch(/98765/)
  } finally { ui.unmount() }
})
it('keeps generated device ids out of visible field labels and accessible names', () => {
  const p = newProject(); p.simDevices = [{ id: 'sim987654', ref: 987654, label: '', prefab: 'Tank', values: { Pressure: { kind: 'const', v: 1 } } }]
  const ui = mount(<SimPanel project={p} dispatch={() => {}} catalog={null} writes={[]} notes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />)
  try {
    expect(ui.container.textContent).not.toContain('sim987654')
    expect(Array.from(ui.container.querySelectorAll('[aria-label]'), e => e.getAttribute('aria-label')).join(' ')).not.toContain('sim987654')
  } finally { ui.unmount() }
})

it('does not wipe saved values when the confirmation is merely opened', async () => {
  const done: string[] = []
  const ui = mount(<SimPanel project={newProject()} dispatch={() => {}} catalog={null} writes={[]} notes={[]} onClearWrites={() => {}} onWipePersist={() => done.push('wipe')} />)
  try {
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="wipe persist"]')!.click())
    expect(done).toEqual([])
    expect(ui.container.querySelector<HTMLDialogElement>('dialog')!.open).toBe(true)
  } finally { ui.unmount() }
})

it('opens counted device cards and asks before wiping persist, with Cancel focused', async () => {
  const p = newProject(), done: string[] = []
  p.simDevices = [{ id: 's1', ref: 2, prefab: 'Sensor', label: 'Tank', values: {} }, { id: 's2', ref: 3, prefab: 'Pump', label: 'Pump', pin: 2, values: {} }]
  const ui = mount(<SimPanel project={p} dispatch={() => {}} catalog={null} writes={[]} notes={[]} onClearWrites={() => {}} onWipePersist={() => done.push('wipe')} />)
  try {
    const sections = Array.from(ui.container.querySelectorAll<HTMLDetailsElement>('details.disc'))
    expect(sections.map(s => [s.querySelector('summary .ptitle')!.textContent, s.open])).toEqual([['Simulated devices', true], ['Not simulated', true]])
    expect(sections[0].querySelector('summary .unit')!.textContent).toBe('2')
    const cards = Array.from(ui.container.querySelectorAll<HTMLDetailsElement>('details.raised'))
    expect(cards).toHaveLength(2)
    expect(cards.every(card => card.open)).toBe(true)
    expect(cards[0].querySelector('summary')!.textContent).toContain('Tank')
    expect(cards[0].querySelector('summary')!.textContent).toContain('Sensor · no pin')
    expect(ui.container.querySelector('[role="radiogroup"][aria-label="Tank pin"]')).not.toBeNull()
    expect(ui.container.querySelector('[aria-label="budget at load"]')!.closest('.grid2')).not.toBeNull()
    const dialog = ui.container.querySelector('dialog')!
    const open = () => run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="wipe persist"]')!.click())
    const cancel = () => Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!
    expect(dialog.open).toBe(false)
    await open()
    expect(dialog.open).toBe(true)
    expect(dialog.querySelector('h2')!.textContent).toBe('Wipe saved values?')
    expect(dialog.textContent).toContain("The simulated chip's persist values are cleared, and the running preview is told at once. Consoles in the game are not touched.")
    expect(document.activeElement).toBe(cancel())
    expect(done).toEqual([])
    await run(() => cancel().click())
    expect(dialog.open).toBe(false)
    expect(done).toEqual([])
    await open()
    const escape = new Event('cancel', { cancelable: true })
    await run(() => { dialog.dispatchEvent(escape) })
    expect(escape.defaultPrevented).toBe(true)
    expect(dialog.open).toBe(false)
    expect(done).toEqual([])
    await open()
    await run(() => Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Wipe persist')!.click())
    expect(dialog.open).toBe(false)
    expect(done).toEqual(['wipe'])
  } finally { ui.unmount() }
})

type Field = HTMLInputElement | HTMLSelectElement
const setValue = (e: Field, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const json = (f: string) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'))
const cat = catalogOf(json('../catalog/devices.json'), json('../catalog/enums.json'))

describe('SimPanel', () => {
  const p: Project = { ...newProject(), simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'O2 tank', ref: 2,
    values: { Pressure: { kind: 'slider', v: 100, min: 0, max: 200 } } }] }
  const note = 'Mystery: prefab ModThing is not in the catalogue, so every LogicType reads and writes'
  const panel = (actions: Action[], done: string[] = []) => mount(<SimPanel project={p} dispatch={a => actions.push(a)} catalog={cat}
    writes={[{ ref: 2, lt: 28, slot: -1, value: 1, stored: true }]} notes={[note]} onClearWrites={() => done.push('clear')} onWipePersist={() => done.push('wipe')} />)
  const patch = (actions: Action[]) => (actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch
  it('adds, duplicates and removes a device, and adds a value with its starting source', async () => {
    const actions: Action[] = []
    const ui = panel(actions)
    const field = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field
    const button = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
    await run(() => setValue(field('new device prefab'), 'StructureVolumePump'))
    await run(() => button('add device').click())
    expect(patch(actions).simDevices).toEqual([...p.simDevices, { id: 'sim3', prefab: 'StructureVolumePump', label: 'Volume Pump', ref: 3, values: {} }])
    await run(() => button('duplicate O2 tank').click())
    expect(patch(actions).simDevices).toEqual([...p.simDevices, { ...p.simDevices[0], id: 'sim3', ref: 3, pin: undefined, label: '' }])
    await run(() => button('remove O2 tank').click())
    expect(patch(actions).simDevices).toEqual([])
    await run(() => setValue(field('O2 tank new value'), 'Temperature'))
    await run(() => button('add value to O2 tank').click())
    expect(patch(actions).simDevices![0].values.Temperature).toEqual({ kind: 'slider', v: 293.15, min: 200, max: 400 })
    await run(() => button('remove O2 tank Pressure').click())
    expect(patch(actions).simDevices![0].values).toEqual({})
    expect(ui.container.textContent).toContain('real physics')
    expect(ui.container.textContent).toContain(note)
    ui.unmount()
  })
  it.each(['O2 tank label', 'budget at load', 'budget per tick', 'day length', 'day start'])('commits character-by-character typing in %s as one undo step', async label => {
    let state = initialState(p)
    const actions: Action[] = []
    const dispatch = (a: Action) => { actions.push(a); state = reducer(state, a); ui.rerender(view()) }
    const view = () => <SimPanel project={state.project} dispatch={dispatch} catalog={null} writes={[]} notes={[]}
      onClearWrites={() => {}} onWipePersist={() => {}} />
    const ui = mount(view())
    try {
      const input = ui.container.querySelector<HTMLInputElement>('[aria-label="' + label + '"]')!
      const text = label === 'O2 tank label' ? 'O2 supply' : '60000'
      for (let k = 1; k <= text.length; k++) await run(() => setValue(input, text.slice(0, k)))
      expect(state.past).toHaveLength(0)
      expect(actions.every(a => a.type === 'setLogic' && a.transient)).toBe(true)
      if (label === 'O2 tank label' || label === 'day length') await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      else await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
      await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
      expect(actions.filter(a => a.type === 'commitDrag')).toHaveLength(1)
      expect(state.past).toHaveLength(1)
      state = reducer(state, { type: 'undo' })
      expect(state.project).toEqual(p)
    } finally { ui.unmount() }
  })
  it('moves a slider as transient steps and commits on release; edits settings; shows the writes; wipes and clears', async () => {
    const actions: Action[] = [], done: string[] = []
    // No catalogue here: the write's LogicType shows as its number, #28 (with the catalogue it reads On).
    const ui = mount(<SimPanel project={p} dispatch={a => actions.push(a)} catalog={null} writes={[{ ref: 2, lt: 28, slot: -1, value: 1, stored: true }]}
      notes={[]} onClearWrites={() => done.push('clear')} onWipePersist={() => done.push('wipe')} />)
    const field = (label: string) => ui.container.querySelector(`[aria-label="${label}"]`) as Field
    await run(() => setValue(field('O2 tank Pressure value'), '150'))
    await run(() => { field('O2 tank Pressure value').dispatchEvent(new Event('pointerup', { bubbles: true })) })
    expect(actions).toEqual([{ type: 'setLogic', transient: true, patch: { simDevices: [{ ...p.simDevices[0], values: { Pressure: { kind: 'slider', v: 150, min: 0, max: 200 } } }] } },
      { type: 'commitDrag' }])
    await run(() => setValue(field('budget per tick'), '60000'))
    expect(actions.at(-1)).toEqual({ type: 'setLogic', transient: true, patch: { settings: { ...p.settings, budgets: { load: 500000, tick: 60000 } } } })
    await run(() => { field('budget per tick').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(actions.at(-1)).toEqual({ type: 'commitDrag' })
    expect(field('budget at load').value).toBe('500000')
    await run(() => setValue(field('budget at load'), '100000'))
    expect(patch(actions).settings!.budgets.load).toBe(100000)
    expect(ui.container.textContent).toContain('O2 tank: #28 ← 1 (stored)')
    await run(() => (ui.container.querySelector('[aria-label="wipe persist"]') as HTMLButtonElement).click())
    await run(() => ui.container.querySelector<HTMLButtonElement>('dialog .btn.danger')!.click())
    await run(() => (ui.container.querySelector('[aria-label="reset written values"]') as HTMLButtonElement).click())
    expect(done).toEqual(['wipe', 'clear'])
    ui.unmount()
  })
})

it('without a catalogue, any non-empty new value name can be added once', async () => {
  const p: Project = { ...newProject(), simDevices: [{ id: 's', prefab: 'UnknownPrefab', ref: 2, label: 'Tank', values: {} }] }
  let state = initialState(p)
  const dispatch = (a: Action) => { state = reducer(state, a); ui.rerender(view()) }
  const view = () => <SimPanel project={state.project} dispatch={dispatch} catalog={null} notes={[]} writes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />
  const ui = mount(view())
  try {
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="add value to Tank"]')!
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Tank new value"]')!
    for (const blank of ['', '   ']) {
      await run(() => setValue(input, blank))
      expect(add.disabled).toBe(true)
    }
    await run(() => setValue(input, '  CustomType  '))
    expect(add.disabled).toBe(false)
    await run(() => add.click())
    expect(state.project.simDevices[0].values).toHaveProperty('CustomType')
    expect(input.value).toBe('')
    await run(() => setValue(input, 'CustomType'))
    expect(add.disabled).toBe(true)
  } finally { ui.unmount() }
})

it('a duplicated device has no pin or label, and value names must match the catalogue', async () => {
  const p: Project = { ...newProject(), simDevices: [{ id: 's', prefab: 'StructureGasSensor', ref: 2, label: 'Tank', pin: 0, values: {} }] }
  const actions: Action[] = []
  const ui = mount(<SimPanel project={p} dispatch={a => actions.push(a)} catalog={cat} notes={[]} writes={[]} onClearWrites={() => {}} onWipePersist={() => {}} />)
  try {
    const add = ui.container.querySelector<HTMLButtonElement>('[aria-label="add value to Tank"]')!
    const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Tank new value"]')!
    for (const wrong of ['pressure', 'NotAType']) {
      await run(() => setValue(input, wrong))
      expect(add.disabled).toBe(true)
    }
    await run(() => setValue(input, 'Pressure'))
    expect(add.disabled).toBe(false)
    // A mod's LogicType by its number (#<integer>) is always accepted: the simulator carries it.
    await run(() => setValue(input, '#1110'))
    expect(add.disabled).toBe(false)
    for (const wrong of ['#', '#1.5', '#x']) {
      await run(() => setValue(input, wrong))
      expect(add.disabled).toBe(true)
    }
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="duplicate Tank"]')!.click())
    const dup = (actions.at(-1) as Extract<Action, { type: 'setLogic' }>).patch.simDevices!.at(-1)!
    expect([dup.pin, dup.label]).toEqual([undefined, ''])
  } finally { ui.unmount() }
})
