import { describe, expect, it } from 'vitest'
import { ChipStore } from './chipStore'

describe('ChipStore', () => {
  it('wipes persist when the loaded Lua changes and the project says so; keeps memory; takes what a status carries', () => {
    const c = new ChipStore()
    c.beforeLoad('a', true)
    c.update({ persist: { k: 'v' }, memory: new Array(512).fill(1) })
    c.beforeLoad('a', true)
    expect(c.persist).toEqual({ k: 'v' })
    c.beforeLoad('b', false)
    expect(c.persist).toEqual({ k: 'v' })
    c.beforeLoad('c', true)
    expect(c.persist).toEqual({})
    expect(c.memory[0]).toBe(1)
    c.update({ persist: null, memory: [1, 2] })
    expect(c.memory).toHaveLength(512)
    c.update({ persist: { x: 'y' } })
    c.wipePersist()
    expect(c.persist).toEqual({})
  })
})

describe('ChipStore snapshots', () => {
  it('keeps stores on the first load and absent or invalid updates; accepts empty persist and named memory literals', () => {
    const c = new ChipStore()
    const memory: (number | string)[] = new Array(512).fill(7)
    memory.splice(0, 3, 'NaN', 'Infinity', '-Infinity')
    c.update({ persist: { pick: '2' }, memory })
    c.beforeLoad('first', true)
    expect(c.persist).toEqual({ pick: '2' })
    c.update({})
    c.update({ persist: null, memory: null })
    c.update({ memory: new Array(513).fill(0) })
    c.update({ memory: [1, 2] })
    expect(c.persist).toEqual({ pick: '2' })
    expect(c.memory).toEqual(memory)
    c.update({ persist: {} })
    expect(c.persist).toEqual({})
    c.wipePersist()
    expect(c.memory.slice(0, 3)).toEqual(['NaN', 'Infinity', '-Infinity'])
  })
})
