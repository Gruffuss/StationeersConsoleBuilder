import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import * as catalog from './index'

const tool = fileURLToPath(new URL('../../../tools/catalog/icons-collect.ts', import.meta.url))
const dir = mkdtempSync(fileURLToPath(new URL('../../test/icons-', import.meta.url)))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
function collect(...logs: string[]) {
  const files = logs.map(text => { const f = join(dir, `log-${++n}.txt`); writeFileSync(f, text); return f })
  const out = join(dir, `out-${n}.json`)
  const r = spawnSync(process.execPath, [tool, '--out', out, ...files], { encoding: 'utf8' })
  let written: unknown
  try { written = JSON.parse(readFileSync(out, 'utf8')) } catch { written = undefined }
  return { status: r.status, stderr: r.stderr, written }
}

it('collects sorted icon tables from prefixed, repeated log chunks', () => {
  const r = collect('[12:00] ICONS kinds slot,gas\r\nICONS gas count 2\nICONS gas Oxygen=gas:Oxygen | CO2=gas:CarbonDioxide\n',
    'ICONS gas CO2=gas:CarbonDioxide\nICONS slot count 1\nICONS slot Chip=slot:ProgrammableChip\n')
  expect(r.status, r.stderr).toBe(0)
  expect(r.written).toEqual({ gas: { CO2: 'gas:CarbonDioxide', Oxygen: 'gas:Oxygen' }, slot: { Chip: 'slot:ProgrammableChip' } })
  expect(Object.keys((r.written as Record<string, object>).gas)).toEqual(['CO2', 'Oxygen'])
})

it('refuses incomplete or conflicting counts without writing JSON', () => {
  for (const log of ['ICONS kinds gas\nICONS gas Oxygen=gas:Oxygen\n',
    'ICONS kinds gas\nICONS gas count 2\nICONS gas Oxygen=gas:Oxygen\n',
    'ICONS kinds gas\nICONS gas count 0\nICONS gas Oxygen=gas:Oxygen\n',
    'ICONS kinds gas\nICONS gas count 1\nICONS gas count 2\nICONS gas Oxygen=gas:Oxygen\n']) {
    const r = collect(log)
    expect([r.status, r.written]).toEqual([1, undefined])
    expect(r.stderr).toMatch(/count|incomplete/)
  }
})

it('refuses a malformed atlas value or conflicting entry without writing JSON', () => {
  for (const rows of ['Oxygen=Oxygen', 'Oxygen=gas:', 'Oxygen=gas:Oxygen:extra', 'Oxygen=gas:Oxygen | Oxygen=gas:Other']) {
    const r = collect(`ICONS kinds gas\nICONS gas count 1\nICONS gas ${rows}\n`)
    expect([r.status, r.written]).toEqual([1, undefined])
    expect(r.stderr).toMatch(/value|conflict/)
  }
})

it('looks up measured names and exposes each kind’s sorted keys', () => {
  expect(catalog).toHaveProperty('iconName')
  expect(catalog.iconName('gas', 'Oxygen')).toBe('gas:Oxygen')
  expect(catalog.iconName('gas', 'CO2')).toBe('gas:CarbonDioxide')
  expect(catalog.iconName('prefab', 'GasOxygen')).toBe('gas:Oxygen')
  expect(catalog.iconName('slot', 'Chip')).toBe('slot:ProgrammableChip')
  expect(catalog.iconName('gas', 'O2')).toBeUndefined()
  expect(catalog.iconName('gas', 'constructor')).toBeUndefined()
  expect(catalog.iconName('unknown', 'Oxygen')).toBeUndefined()
  expect(Object.entries(catalog.iconKeys).map(([kind, keys]) => [kind, keys.length])).toEqual([['gas', 39], ['prefab', 100], ['slot', 44]])
  expect(catalog.iconKeys.gas).toEqual([...catalog.iconKeys.gas].sort())
})
