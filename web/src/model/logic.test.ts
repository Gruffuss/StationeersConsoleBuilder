import { describe, expect, it, vi } from 'vitest'
import { cascade, DEFAULT_SETTINGS, isLuaName, logicFrom, newLogic, renamed, type Logic } from './logic'

const hostile = {
  roles: [{ id: 'tank', name: 'O2', prefabs: ['StructureGasSensor', 5, ''], mode: 'one', pin: 9, optional: true, distinct: true, ref: 1e300 }, { id: 'tank' }, { id: 'end' }, { id: '1x' }, 'junk'],
  reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } }, scale: NaN, clamp: [5, 1], smooth: -1, history: { n: 0 }, valid: [5, -1] },
    { id: 'q', role: 'gone', of: { lt: { name: 'X' } } }, { id: 'r', role: 'tank', of: { slot: 0, lst: 'Quantity' }, agg: 'median', unit: 'K>C' }],
  state: [{ name: 'mode', type: 'enum', options: ['a', 'b'], init: 7 }, { name: 'n', type: 'number', init: 1e300, min: 10, max: 0 },
    { name: 'bad', type: 'enum', options: [] }, { name: 'room', type: 'string', init: 3, save: false, mirrorBytes: 12 }],
  actions: [{ id: 'a1', on: 'tg1_hit', page: 'p1', do: [{ op: 'toggle', state: 'mode' }, { op: 'boom' }, { op: 'page', page: 'p9' }, { op: 'step', state: 'n', by: 2, min: 0, max: 'S.hi' }] },
    { id: 'a2', on: '', do: [] }, { id: 'a3', on: 'back', page: 'p9', do: [{ op: 'page', page: 'p1' }] }],
  rules: [{ id: 'r1', role: 'tank', lt: { name: 'On' }, value: 'S.n', skipBoot: 'yes', pulse: true }],
  bindings: { a: { from: 'read', read: 'p', part: 'history' }, b: { from: 'read', read: 'q' }, c: { from: 'nope' }, d: { from: 'const', value: [1, 'x'] },
    '@ico1.name': { from: 'expr', expr: 'P.item' }, e: { from: 'state', state: 'mode', ease: true } },
  customLua: 42,
  simDevices: [{ id: 's1', prefab: 'StructureGasSensor', label: 'O2', ref: 1, role: 'tank', values: { Pressure: { kind: 'sine', mid: 1, amp: 1, period: 0 }, On: { kind: 'what' } } },
    { id: 's2', prefab: 'X', ref: 1e300, values: { P: { kind: 'walk', seed: 1e20 } } }],
  settings: { budgets: { load: 1234567, tick: -5 }, day: { length: 0, start: 1.5 }, beta: 'yes' },
}

describe('logicFrom and cascade (a shared project is untrusted)', () => {
  const { logic, notes } = logicFrom(hostile)
  const l = cascade(logic, ['p1'])
  it('keeps what reads, drops the rest with a note, and never throws', () => {
    expect(l.roles).toEqual([{ id: 'tank', name: 'O2', prefabs: ['StructureGasSensor'], mode: 'one', optional: true, distinct: true }])
    expect(notes).toEqual(expect.arrayContaining(['role tank appears twice; the second was dropped', 'roles: 3 could not be read and were dropped']))
    expect(l.reads).toEqual([{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } }, clamp: [1, 5], valid: [-1, 5] },
      { id: 'r', role: 'tank', of: { slot: 0, lst: 'Quantity' }, unit: 'K>C' }])
    expect(l.state).toEqual([{ name: 'mode', type: 'enum', init: 1, options: ['a', 'b'] }, { name: 'n', type: 'number', init: 1e12, min: 0, max: 10 },
      { name: 'room', type: 'string', init: '', save: false, mirrorBytes: 12 }])
    expect(l.actions).toEqual([{ id: 'a1', on: 'tg1_hit', page: 'p1', do: [{ op: 'toggle', state: 'mode' }, { op: 'step', state: 'n', by: 2, min: 0, max: 'S.hi' }] }])
    expect(l.rules).toEqual([{ id: 'r1', role: 'tank', lt: { name: 'On' }, value: 'S.n', pulse: true }])
    expect(l.bindings).toEqual({ a: { from: 'read', read: 'p', part: 'history' }, '@ico1.name': { from: 'expr', expr: 'P.item' }, e: { from: 'state', state: 'mode', ease: true } })
    expect(l.customLua).toBe('')
    // A ref or a seed the core's JSON reader cannot hold (C# long, int) is replaced, never passed on (for example, 1e300 is outside either integer type).
    expect(l.simDevices).toEqual([{ id: 's1', prefab: 'StructureGasSensor', label: 'O2', ref: 2, role: 'tank', values: { Pressure: { kind: 'sine', mid: 1, amp: 1, period: 1 } } },
      { id: 's2', prefab: 'X', label: '', ref: 3, values: { P: { kind: 'walk', v: 0, step: 1, min: 0, max: 100, seed: 1 } } }])
    expect(l.settings).toEqual({ budgets: { load: 1235000, tick: 1000 }, beta: false, day: { length: 1200, start: 0.5 }, wipeOnReexport: false })
  })
  it('deduplicates role prefabs in first occurrence order on shared-project load', () => {
    const input = { roles: [{ id: 'tank', prefabs: ['B', 'A', 'B', '', 5, 'A'], mode: 'all' }] }
    const { logic } = logicFrom(input)
    expect(logic.roles[0].prefabs).toEqual(['B', 'A'])
    expect(logicFrom(JSON.parse(JSON.stringify(logic))).logic).toEqual(logic)
  })
  it('reads anything at all as empty logic', () => {
    for (const v of [null, 5, 'x', [], { roles: 'x', bindings: [], settings: null }]) expect(logicFrom(v).logic).toEqual(newLogic())
    expect(newLogic().settings).toEqual(DEFAULT_SETTINGS)
  })
  it('keeps persist on re-export by default and retains an explicit wipe setting', () => {
    expect(newLogic().settings.wipeOnReexport).toBe(false)
    expect(logicFrom({ settings: {} }).logic.settings.wipeOnReexport).toBe(false)
    expect(logicFrom({ settings: { wipeOnReexport: true } }).logic.settings.wipeOnReexport).toBe(true)
  })
  it('gives each simulated device a unique ref of 2 or more: a repeated, missing or housing ref takes the smallest free one', () => {
    const refs = (...r: unknown[]) => logicFrom({ simDevices: r.map((ref, i) => ({ id: `s${i}`, prefab: 'P', ref })) }).logic.simDevices.map(d => d.ref)
    expect(refs(3, 3, undefined, 2, 1)).toEqual([3, 4, 5, 2, 6])
  })
  it('repairs repeated simulated refs with linear inspection cost', () => {
    const n = 4000, sims = Array.from({ length: n }, (_, i) => ({ id: 's' + i, prefab: 'P', ref: 0 }))
    const some = Array.prototype.some
    let inspected = 0
    const spy = vi.spyOn(Array.prototype, 'some').mockImplementation(function(this: unknown[], predicate, arg) {
      return some.call(this, (value, i, array) => {
        if ((value as { prefab?: string })?.prefab === 'P') inspected++
        return predicate.call(arg, value, i, array)
      })
    })
    try {
      const { logic } = logicFrom({ simDevices: sims })
      expect(logic.simDevices.map(d => d.ref)).toEqual(Array.from({ length: n }, (_, i) => i + 2))
      expect(inspected).toBeLessThanOrEqual(n * 4)
    } finally { spy.mockRestore() }
  })
  it('names Lua names: letters, digits and _, not a keyword, not starting with a digit', () => {
    expect(['a', '_x1', 'tankP'].every(isLuaName)).toBe(true)
    expect(['', '1a', 'end', 'a-b', 'é', 5].some(isLuaName)).toBe(false)
  })
})

describe('cascade', () => {
  const base = (): Logic => ({ ...newLogic(),
    roles: [{ id: 'tank', name: 'Tank', prefabs: [], mode: 'one' }],
    reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }],
    state: [{ name: 'on', type: 'bool', init: false }],
    actions: [{ id: 'a', on: 'b_hit', do: [{ op: 'toggle', state: 'on' }, { op: 'page', page: 'p2' }, { op: 'page', page: 'vb_devices' }] }],
    rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: 'S.on' }],
    bindings: { x: { from: 'read', read: 'p' }, y: { from: 'state', state: 'on' } },
    simDevices: [{ id: 's', prefab: 'P', label: 'T', ref: 2, role: 'tank', values: {} }, { id: 't', prefab: 'P', label: 'T', ref: 3, values: {} }] })
  it('a role taken away takes its reads, rules and the simulated device made for it; their bindings go', () => {
    const l = cascade({ ...base(), roles: [] }, ['p1', 'p2'])
    expect([l.reads, l.rules, l.simDevices.map(d => d.id), Object.keys(l.bindings)]).toEqual([[], [], ['t'], ['y']])
  })
  it('a state taken away takes its steps and bindings; a page taken away takes the steps to it, never the Devices page', () => {
    const l = cascade({ ...base(), state: [] }, ['p1'])
    expect(l.actions[0].do).toEqual([{ op: 'page', page: 'vb_devices' }])
    expect(Object.keys(l.bindings)).toEqual(['x'])
  })
  it('a page taken away takes the actions scoped to it (ruling P18)', () => {
    const scoped = { ...base(), actions: [...base().actions, { id: 'back2', on: 'back', page: 'p2', do: [] }, { id: 'back1', on: 'back', page: 'p1', do: [] }] }
    expect(cascade(scoped, ['p1']).actions.map(a => a.id)).toEqual(['a', 'back1'])
  })
})

describe('renamed', () => {
  const l: Logic = { ...newLogic(), roles: [{ id: 'tank', name: 'T', prefabs: [], mode: 'one' }], reads: [{ id: 'p', role: 'tank', of: { lt: { name: 'Pressure' } } }],
    rules: [{ id: 'r', role: 'tank', lt: { name: 'On' }, value: '1' }], state: [{ name: 'on', type: 'bool', init: false }],
    actions: [{ id: 'a', on: 'x', do: [{ op: 'toggle', state: 'on' }] }], bindings: { b: { from: 'read', read: 'p' }, c: { from: 'state', state: 'on' } },
    simDevices: [{ id: 's', prefab: 'P', label: 'T', ref: 2, role: 'tank', values: {} }] }
  it('renames a role, a read or a state with every reference', () => {
    const r = renamed(l, 'role', 'tank', 'o2') as Logic
    expect([r.roles[0].id, r.reads[0].role, r.rules[0].role, r.simDevices[0].role]).toEqual(['o2', 'o2', 'o2', 'o2'])
    expect((renamed(l, 'read', 'p', 'press') as Logic).bindings.b).toEqual({ from: 'read', read: 'press' })
    const s = renamed(l, 'state', 'on', 'pump') as Logic
    expect([s.state[0].name, s.actions[0].do[0], s.bindings.c]).toEqual(['pump', { op: 'toggle', state: 'pump' }, { from: 'state', state: 'pump' }])
  })
  it('refuses a name that is not a Lua name or is taken', () => {
    expect(renamed(l, 'role', 'tank', 'end')).toBe('"end" is not a Lua name (letters, digits and _, not a keyword)')
    expect(renamed({ ...l, roles: [...l.roles, { id: 'b', name: 'B', prefabs: [], mode: 'one' }] }, 'role', 'tank', 'b')).toBe('role b exists already')
    expect(renamed(l, 'read', 'nope', 'x')).toBe('no read nope')
  })
})
