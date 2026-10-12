import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { gases, icons, gasOf } from '../catalog'
import { colour, THEMES } from './index'
import { neutral } from './neutral'
import { vanillaPlus } from './vanillaPlus'

it('resolves every sampled gas fill and ink in every provided theme', () => {
  for (const t of Object.values(THEMES)) for (const [name, gas] of Object.entries(gases)) {
    const fill = Array.isArray(gas.fill) ? gas.fill[0] : gas.fill
    expect(colour(t, 'gas.' + name), t.id + ' ' + name).toBe(fill)
    expect(colour(t, 'gas.' + name + '.ink')).toBe(gas.ink)
    expect(t.colors['gas.' + name]).toBe(fill)
  }
})
it('exposes all gas icon aliases and liquids as shared colour names', () => {
  for (const t of Object.values(THEMES)) for (const [alias, atlas] of Object.entries(icons.gas)) {
    const gas = gasOf(atlas.slice(4))!, fill = Array.isArray(gas.fill) ? gas.fill[0] : gas.fill
    expect(colour(t, 'gas.' + alias), alias).toBe(fill)
    expect(t.colors['gas.' + alias + '.ink']).toBe(gas.ink)
  }
})
it('retains both split halves while a single-colour use takes the left half', () => {
  for (const t of Object.values(THEMES)) {
    expect(colour(t, 'gas.Hydrogen')).toBe('#C32826')
    expect(colour(t, 'gas.Hydrogen.2')).toBe('#8F8F8F')
    expect(colour(t, 'gas.LiquidHydrogen.2')).toBe('#8F8F8F')
    expect(colour(t, 'gas.Hydrogen.ink')).toBe('#FFFFFF')
    expect(() => colour(t, 'gas.Oxygen.2')).toThrow('has no colour')
  }
})
it('adds identities centrally without defining them in theme modules', () => {
  for (const t of Object.values(THEMES)) expect(t.colors['gas.Nitrogen']).toBe('#000000')
  for (const t of [neutral, vanillaPlus]) expect(Object.keys(t.colors).filter(k => k.startsWith('gas.'))).toEqual([])
  for (const file of ['./neutral.ts', './vanillaPlus.ts']) expect(readFileSync(new URL(file, import.meta.url), 'utf8')).not.toMatch(/['"]gas\.[^'"]+['"]\s*:/)
})
it('keeps game identities when a theme attempts to override them', () => {
  const t = { ...THEMES.neutral, colors: { ...THEMES.neutral.colors, 'gas.Oxygen': '#123456' } }
  expect(colour(t, 'gas.Oxygen')).toBe('#FFFFFF')
})

it('skips a future gas icon that has no shared colour when loading themes', async () => {
  const catalog = await vi.importActual<typeof import('../catalog')>('../catalog')
  vi.doMock('../catalog', () => ({ ...catalog, icons: { ...catalog.icons, gas: { ...catalog.icons.gas, FutureGas: 'gas:FutureGas' } } }))
  vi.resetModules()
  try {
    const loaded = await import('./index')
    for (const t of Object.values(loaded.THEMES)) expect(t.colors).not.toHaveProperty('gas.FutureGas')
    expect(loaded.colour(loaded.THEMES.neutral, 'gas.Oxygen')).toBe('#FFFFFF')
  } finally { vi.doUnmock('../catalog'); vi.resetModules() }
})
