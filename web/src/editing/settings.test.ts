import { describe, expect, it } from 'vitest'
import { DEFAULTS, loadSettings, saveSettings } from './settings'
import { defaultOf, loadDrawDefaults, saveDrawDefaults } from './settings'
import { node } from '../model/testing'
import { vanillaPlus } from '../theme/vanillaPlus'

it('draw defaults record literal style only, including nested lists and bare numeric expressions', () => {
  const n = node('R', { f: '$colour', s: '=if(eq($k,1),#ffffff,#000000)', sw: 't*2', rx: 4,
    dash: [6, '$off'], sh: [[0, '=t', 2, 0, '#00000080']], cap: 'round' })
  expect(defaultOf(n, vanillaPlus)).toEqual({ attrs: { rx: 4, cap: 'round' }, links: {} })
  const stored = { R: { attrs: n.attrs, links: {} } }
  expect(loadDrawDefaults({ getItem: () => JSON.stringify(stored), setItem() {} })).toEqual({ R: { attrs: { rx: 4, cap: 'round' }, links: {} } })
})

it('draw defaults use their own key, validate style only, and report denied storage', () => {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
  const defaults = { R: { attrs: { f: '#ff0000', sw: 2 }, links: { f: { role: 'accent' } } } }
  expect(saveDrawDefaults(defaults, store)).toBe(true)
  expect(m.has('vb.drawDefaults')).toBe(true)
  expect(m.has('vb.editing')).toBe(false)
  expect(loadDrawDefaults(store)).toEqual(defaults)
  store.setItem('vb.drawDefaults', '{"R":{"attrs":{"x":20,"id":"bad","f":"#ff0000","sw":1e40},"links":{"id":{"role":"accent"}}},"constructor":{}}')
  expect(loadDrawDefaults(store)).toEqual({ R: { attrs: { f: '#ff0000' }, links: {} } })
  expect(saveDrawDefaults({}, null)).toBe(false)
  expect(saveDrawDefaults({}, { ...store, setItem: () => { throw Error('denied') } })).toBe(false)
})

describe('editing settings', () => {
  const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
  it('round-trips through storage; anything unreadable reads as the default', () => {
    const s = memory()
    saveSettings({ grid: 8, snap: false }, s)
    expect(loadSettings(s)).toEqual({ grid: 8, snap: false })
    s.setItem('vb.editing', '{"grid":7.6}')
    expect(loadSettings(s)).toEqual({ grid: 8, snap: true })
    s.setItem('vb.editing', '{"grid":-3,"snap":"no"}')
    expect(loadSettings(s)).toEqual(DEFAULTS)
    s.setItem('vb.editing', 'not json')
    expect(loadSettings(s)).toEqual(DEFAULTS)
  })
  it('keeps the defaults with no storage, or one that throws', () => {
    expect(loadSettings(null)).toEqual({ grid: 0, snap: true })
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadSettings(broken)).toEqual(DEFAULTS)
    expect(() => saveSettings(DEFAULTS, broken)).not.toThrow()
  })
})
