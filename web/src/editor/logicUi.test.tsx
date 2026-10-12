// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { sourceJson } from '../codegen/hostOf'
import { isLuaName, type SimSource } from '../model/logic'
import { newProject } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { mount, run } from '../testing'
import { ExprInput, ltFrom, ltText, NamesList, SourceEditor, uniqueName, withPreviewSource } from './logicUi'

it('offers all six source kinds as radios and keeps the fields in a three-column grid', async () => {
  const got: SimSource[] = []
  const ui = mount(<SourceEditor label="source" value={{ kind: 'const', v: 1 }} onChange={s => got.push(s)} />)
  try {
    const group = ui.container.querySelector('[role="radiogroup"][aria-label="source kind"]')!
    expect(group).not.toBeNull()
    expect(Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]')).map(r => r.value)).toEqual(['const', 'slider', 'sine', 'ramp', 'walk', 'keys'])
    expect(ui.container.querySelector('[aria-label="source value"]')!.closest('.grid3')).not.toBeNull()
    await run(() => group.querySelector<HTMLInputElement>('[value="sine"]')!.click())
    expect(got).toEqual([{ kind: 'sine', mid: 0, amp: 1, period: 10 }])
  } finally { ui.unmount() }
})

const setValue = (e: HTMLInputElement | HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const cases: [SimSource['kind'], string, string, object][] = [
  ['const', 'value', '5', { kind: 'const', v: 5 }],
  ['slider', 'max', '50', { kind: 'slider', v: 0, min: 0, max: 50 }],
  ['sine', 'amp', '3', { kind: 'sine', mid: 0, amp: 3, period: 10 }],
  ['ramp', 'to', '9', { kind: 'ramp', from: 0, to: 9, period: 10, loop: true }],
  ['walk', 'seed', '7', { kind: 'walk', v: 0, step: 1, min: 0, max: 100, seed: 7 }],
  ['keys', 'keys', '5:2, 0:1', { kind: 'keys', keys: [[0, 1], [5, 2]], loop: true }],
]

describe('SourceEditor: every simulated-source kind of spec §7 has its fields', () => {
  it.each(['const', 'sine', 'ramp', 'walk'] as const)('%s numeric typing is transient and commits once', async kind => {
    const starts: Record<typeof kind, SimSource> = { const: { kind: 'const', v: 0 }, sine: { kind: 'sine', mid: 0, amp: 1, period: 10 }, ramp: { kind: 'ramp', from: 0, to: 1, period: 10, loop: true }, walk: { kind: 'walk', v: 0, step: 1, min: 0, max: 100, seed: 1 } }
    const p = newProject()
    p.simDevices = [{ id: 'sim', ref: 2, prefab: 'StructureGasSensor', label: '', values: { Pressure: starts[kind] } }]
    let state = initialState(p)
    const dispatch = (a: Action) => { state = reducer(state, a); ui.rerender(render()) }
    const render = () => <SourceEditor label="s" value={state.project.simDevices[0].values.Pressure}
      onChange={(s, transient) => dispatch({ type: 'setLogic', patch: { simDevices: [{ ...state.project.simDevices[0], values: { Pressure: s } }] }, transient })}
      onCommit={() => dispatch({ type: 'commitDrag' })} />
    const ui = mount(render())
    const name = kind === 'const' ? 'value' : kind === 'sine' ? 'mid' : kind === 'ramp' ? 'from' : 'start'
    const input = ui.container.querySelector(`[aria-label="s ${name}"]`) as HTMLInputElement
    for (const text of ['1', '12', '123']) await run(() => setValue(input, text))
    expect(state.past).toHaveLength(0)
    await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(state.past).toHaveLength(1)
    await run(() => dispatch({ type: 'undo' }))
    expect(state.project.simDevices[0].values.Pressure).toEqual(starts[kind])
    expect(input.value).toBe('0')
    ui.unmount()
  })
  it.each(['sine', 'ramp'] as const)('period draft: %s keeps 0 then 0.5 and clamps only on commit', async kind => {
    let source: SimSource = kind === 'sine' ? { kind, mid: 0, amp: 1, period: 10 } : { kind, from: 0, to: 1, period: 10, loop: true }
    const render = () => <SourceEditor label="s" value={source} onChange={s => { source = s; ui.rerender(render()) }} />
    const ui = mount(render())
    const input = ui.container.querySelector('[aria-label="s period"]') as HTMLInputElement
    await run(() => setValue(input, '0'))
    expect(input.value).toBe('0')
    await run(() => setValue(input, input.value + '.'))
    await run(() => setValue(input, input.value + '5'))
    expect(input.value).toBe('0.5')
    await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(source).toMatchObject({ period: 0.5 })
    await run(() => setValue(input, '0'))
    expect(input.value).toBe('0')
    await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(source).toMatchObject({ period: 0.1 })
    expect(input.value).toBe('0.1')
    ui.unmount()
  })
  it.each(cases)('%s: choosing it starts one, editing %s changes it, and the core gets its shape', async (kind, field, text, want) => {
    const got: SimSource[] = []
    const from: SimSource = kind === 'const' ? { kind: 'slider', v: 0, min: 0, max: 100 } : { kind: 'const', v: 0 }
    const ui = mount(<SourceEditor label="s" value={from} onChange={s => got.push(s)} />)
    await run(() => ui.container.querySelector<HTMLInputElement>(`[aria-label="s kind"] [value="${kind}"]`)!.click())
    ui.rerender(<SourceEditor label="s" value={got.at(-1)!} onChange={s => got.push(s)} />)
    const input = ui.container.querySelector(`[aria-label="s ${field}"]`) as HTMLInputElement
    await run(() => setValue(input, text))
    if (kind === 'keys') await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(sourceJson(got.at(-1)!)).toEqual(want)
    ui.unmount()
  })
  it('reflects undo and redo values while preserving incomplete numeric drafts', async () => {
    const got: SimSource[] = []
    const render = (v: number) => <SourceEditor label="s" value={{ kind: 'const', v }} onChange={s => got.push(s)} />
    const ui = mount(render(5))
    const input = ui.container.querySelector('[aria-label="s value"]') as HTMLInputElement
    await run(() => setValue(input, '-'))
    expect(input.value).toBe('-')
    expect(got).toEqual([])
    await run(() => setValue(input, '1.'))
    ui.rerender(render(1))
    expect(input.value).toBe('1.')
    ui.rerender(render(5))
    expect(input.value).toBe('5')
    ui.rerender(render(1))
    expect(input.value).toBe('1')
    ui.unmount()
  })
  it('sends slider drags as transient changes and commits on release', async () => {
    const got: [SimSource, boolean | undefined][] = [], commits: string[] = []
    const ui = mount(<SourceEditor label="s" value={{ kind: 'slider', v: 0, min: 0, max: 100 }}
      onChange={(s, transient) => got.push([s, transient])} onCommit={() => commits.push('commit')} />)
    const input = ui.container.querySelector('[aria-label="s value"]') as HTMLInputElement
    await run(() => setValue(input, '25'))
    expect(got).toEqual([[{ kind: 'slider', v: 25, min: 0, max: 100 }, true]])
    expect(commits).toEqual([])
    await run(() => { input.dispatchEvent(new Event('pointerup', { bubbles: true })) })
    expect(commits).toEqual(['commit'])
    ui.unmount()
  })
  it('commits keyboard slider edits on key release', async () => {
    let commits = 0
    const ui = mount(<SourceEditor label="s" value={{ kind: 'slider', v: 0, min: 0, max: 100 }}
      onChange={() => {}} onCommit={() => { commits++ }} />)
    const input = ui.container.querySelector('[aria-label="s value"]') as HTMLInputElement
    await run(() => setValue(input, '1'))
    await run(() => { input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })) })
    expect(commits).toBe(1)
    ui.unmount()
  })
  it('does not emit non-finite keyframe values', async () => {
    const got: SimSource[] = []
    const ui = mount(<SourceEditor label="s" value={{ kind: 'keys', keys: [[0, 1]], loop: true }} onChange={s => got.push(s)} />)
    const input = ui.container.querySelector('[aria-label="s keys"]') as HTMLInputElement
    await run(() => setValue(input, '0:1e999'))
    await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(got).toEqual([])
    ui.unmount()
  })
  it('keyframe typing commits once on Enter, then blur is a no-op', async () => {
    const got: SimSource[] = []
    const ui = mount(<SourceEditor label="s" value={{ kind: 'keys', keys: [[0, 1]], loop: true }} onChange={s => got.push(s)} />)
    const input = ui.container.querySelector('[aria-label="s keys"]') as HTMLInputElement
    for (const text of ['0:2', '0:2, 5', '0:2, 5:3']) await run(() => setValue(input, text))
    expect(got).toEqual([])
    await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    await run(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(got).toEqual([{ kind: 'keys', keys: [[0, 2], [5, 3]], loop: true }])
    ui.unmount()
  })
})

describe('shared expression controls and helpers', () => {
  it('keeps invalid expression text and connects its guard message to autocomplete', async () => {
    const got: string[] = [], p = newProject()
    p.reads = [{ id: 'pressure', role: 'tank', of: { lt: { name: 'Pressure' } } }]
    p.state = [{ name: 'mode', type: 'number', init: 0 }]
    p.roles = [{ id: 'tank', name: 'Tank', prefabs: [], mode: 'one' }]
    const ui = mount(<><NamesList project={p} /><ExprInput label="expr" value="x = 1" onChange={s => got.push(s)} /></>)
    const input = ui.container.querySelector('[aria-label="expr"]') as HTMLInputElement
    expect(input.getAttribute('list')).toBe('vb-data-names')
    expect(ui.container.querySelector(`#${CSS.escape(input.getAttribute('aria-describedby')!)}`)?.textContent).toContain('cannot assign')
    expect(Array.from(ui.container.querySelectorAll('option'), e => e.value)).toEqual(expect.arrayContaining([
      'P.pressure', 'T.pressure', 'H.pressure', 'S.mode', 'R.tank.n', 'R.tank.names', 'X.', 'VB.unbound()',
    ]))
    await run(() => setValue(input, 'function() end'))
    expect(got).toEqual(['function() end'])
    ui.unmount()
  })
  it('makes Lua names from arbitrary bases, avoiding keywords and taking the first free suffix', () => {
    for (const base of ['', 'end', '1 tank', 'O2 tank', 'tank']) expect(isLuaName(uniqueName(base, []))).toBe(true)
    expect(uniqueName('tank', ['tank', 'tank2', 'tank4'])).toBe('tank3')
  })
  it('parses named and extension LogicTypes and round-trips their text', () => {
    expect(ltFrom(' Pressure ')).toEqual({ name: 'Pressure' })
    expect(ltFrom(' #1224 ')).toEqual({ id: 1224 })
    expect(ltText({ name: 'Pressure' })).toBe('Pressure')
    expect(ltText({ id: 1224 })).toBe('#1224')
    for (const text of ['', '#', '#1.2', 'not a type']) expect(ltFrom(text)).toBeNull()
  })
  it('leaves existing previews and other devices intact, including without a catalogue', () => {
    const p = newProject()
    p.simDevices = [{ id: 's1', ref: 2, prefab: 'StructureGasSensor', role: 'tank', label: 'Tank', values: { Pressure: { kind: 'const', v: 5 } } }]
    const cat = { devices: [], byName: new Map(), enums: { game: 'test', observed: null, LogicType: [], LogicSlotType: [], LogicBatchMethod: [] }, lt: [], lst: [] }
    expect(withPreviewSource(p, 'tank', { name: 'Pressure' }, cat)).toBe(p.simDevices)
    expect(withPreviewSource(p, 'other', { name: 'Temperature' }, cat)).toBe(p.simDevices)
    expect(withPreviewSource(p, 'tank', { name: 'Temperature' }, null)).toBe(p.simDevices)
    const next = withPreviewSource(p, 'tank', { id: 1224 }, cat)
    expect(next[0].values['#1224']).toEqual({ kind: 'const', v: 0 })
    expect(next[0].values.Pressure).toBe(p.simDevices[0].values.Pressure)
    expect(p.simDevices[0].values['#1224']).toBeUndefined()
  })
})
