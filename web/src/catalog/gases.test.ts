import { existsSync, readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { gasOf as lookup, icons, type Gas } from './index'

const values: [string, string | [string, string], string][] = [
  ['Oxygen', '#FFFFFF', '#000000'], ['Nitrogen', '#000000', '#FFFFFF'], ['Pollutant', '#FFDC00', '#000000'],
  ['Hydrogen', ['#C32826', '#8F8F8F'], '#FFFFFF'], ['Helium', ['#793699', '#8F8F8F'], '#FFFFFF'],
  ['Ozone', '#793699', '#FFFFFF'], ['Methane', '#C32826', '#FFFFFF'], ['CarbonDioxide', '#757779', '#FFFFFF'],
  ['Water', '#00529C', '#FFFFFF'], ['NitrousOxide', '#059B57', '#FFFFFF'], ['PollutedWater', ['#683A00', '#00529C'], '#FFFFFF'],
  ['LiquidAlcohol', '#683A00', '#FFFFFF'], ['Silanol', ['#683A00', '#202020'], '#FFFFFF'],
  ['LiquidSodiumChloride', ['#FFFFFF', '#FFEB10'], '#000000'], ['HydrochloricAcid', ['#059B57', '#8F8F8F'], '#FFFFFF'],
  ['Hydrazine', '#F4821E', '#FFFFFF'],
]
const file = new URL('./gases.json', import.meta.url)
const table = (): Record<string, Gas> => { expect(existsSync(file)).toBe(true); return JSON.parse(readFileSync(file, 'utf8')) }

it('keeps exactly the sixteen sampled icon fills and symbol inks, without mixtures', () => {
  const gases = table()
  expect(Object.keys(gases).sort()).toEqual(values.map(([n]) => n).sort())
  for (const [name, fill, ink] of values) expect(gases[name]).toMatchObject({ fill, ink })
})
it('records the owner-supplied game gas icons and their date as every colour source', () => {
  const gases = table()
  for (const gas of Object.values(gases)) expect(gas.source).toBe('Game gas icons supplied by the owner on 2026-10-12')
})
it('resolves every gas icon name and alias through its atlas name to a colour', () => {
  for (const [alias, atlas] of Object.entries(icons.gas)) {
    const gas = lookup(atlas.slice(4))
    expect(gas, atlas).toBeDefined()
    expect(lookup(alias), alias).toEqual(gas)
  }
  expect(lookup('unknown')).toBeUndefined()
  expect(lookup('toString')).toBeUndefined()
})
it('shares liquid and steam colours without stripping canonical liquid identities', () => {
  const pairs = [
    ['LiquidOxygen', 'Oxygen'], ['LiquidNitrogen', 'Nitrogen'], ['LiquidCarbonDioxide', 'CarbonDioxide'],
    ['LiquidMethane', 'Methane'], ['LiquidPollutant', 'Pollutant'], ['LiquidNitrousOxide', 'NitrousOxide'],
    ['LiquidHydrogen', 'Hydrogen'], ['LiquidOzone', 'Ozone'], ['LiquidHydrazine', 'Hydrazine'],
    ['LiquidSilanol', 'Silanol'], ['LiquidHydrochloricAcid', 'HydrochloricAcid'], ['Steam', 'Water'],
  ]
  for (const [liquid, gas] of pairs) expect(lookup(liquid), liquid).toEqual(lookup(gas))
  expect(lookup('LiquidAlcohol')?.fill).toBe('#683A00')
  expect(lookup('LiquidSodiumChloride')?.fill).toEqual(['#FFFFFF', '#FFEB10'])
})
