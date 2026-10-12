// Test-only theme until the provided Neutral theme lands.
import type { Theme } from './types'
import { vanillaPlus } from './vanillaPlus'
import { bracket } from '../widgets/testing'
import { sanitizeTheme, themeFileOf } from './file'

const file = themeFileOf(bracket)
file.theme.name = 'Imported test'
file.theme.colors!['surface-panel'] = '#123456'
file.theme.parts!.meter = { fill: 'accent' }
file.theme.widgetDefaults = { button: { states: [{ label: 'Go', variant: 'primary', key: 0 }] } }
export const imported = sanitizeTheme(file, bracket, { id: 'ds-test', taken: new Set() }).theme!

export const neutral: Theme = { ...vanillaPlus, id: 'neutral', name: 'Neutral',
  colors: { ...vanillaPlus.colors, accent: '#42A5F5', border: '#4A4A4A', 'surface-panel': '#262626', 'surface-row': '#303030' },
  gradients: {}, shadows: {},
  parts: { ...vanillaPlus.parts, row: { fill: 'surface-row', stroke: 'border', width: 1, radius: 0 },
    shape: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 0 } },
  type: Object.fromEntries(Object.entries(vanillaPlus.type).map(([k, s]) => [k, { ...s, font: '', shadow: undefined }])) as Theme['type'],
}
