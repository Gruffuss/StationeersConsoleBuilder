import { metricsFor } from './metrics'
import { linesOf } from './faces'
import type { Theme } from './types'
import { vanillaPlus } from './vanillaPlus'

const type: Theme['type'] = {
  hero: { font: '', size: 120, cspace: 0, upper: false, ink: 'text' },
  'screen-title': { font: '', size: 30, cspace: 0, upper: false, ink: 'text', weight: 'bold' },
  clock: { font: '', size: 24, cspace: 0, upper: false, ink: 'text-secondary' },
  'panel-title': { font: '', size: 22, cspace: 0, upper: false, ink: 'text-muted', weight: 'bold' },
  'button-label': { font: '', size: 22, cspace: 0, upper: false, ink: 'text', weight: 'bold' },
  'chip-label': { font: '', size: 20, cspace: 0, upper: false, ink: 'on-status', weight: 'bold' },
  'value-lg': { font: '', size: 28, cspace: 0, upper: false, ink: 'text' },
  value: { font: '', size: 24, cspace: 0, upper: false, ink: 'text' },
  reading: { font: '', size: 22, cspace: 0, upper: false, ink: 'text-secondary' },
  message: { font: '', size: 22, cspace: 0, upper: false, ink: 'text' },
  unit: { font: '', size: 20, cspace: 0, upper: false, ink: 'text-muted' },
}
const geo: Theme['geo'] = {
  space: vanillaPlus.geo.space, radius: { xs: 2, sm: 3, md: 4, lg: 6, xl: 8 },
  edge: { hair: 1, strong: 2, header: 1, primary: 1, focus: 2 },
  size: { header: 56, light: 16, bar: 24, row: 44, control: 48 },
  floor: 20, chip: { w: 72, h: 28 }, heroUnit: 48,
}

export const neutral: Theme = {
  id: 'neutral', name: 'Neutral',
  colors: {
    'surface-screen-hi': '#2B2B2B', 'surface-screen': '#262626', 'surface-screen-lo': '#202020', 'surface-panel': '#1A1A1A',
    'surface-row-hi': '#303030', 'surface-row': '#2C2C2C', 'surface-row-lo': '#282828', 'surface-well': '#121212',
    border: '#4A4A4A', 'border-strong': '#7A7A7A', text: '#F2F2F2', 'text-secondary': '#C4C4C4', 'text-muted': '#9A9A9A',
    accent: '#3D8BFD', 'brand-hi': '#2F6FD0', brand: '#2A64BD', 'brand-lo': '#2459A8', 'on-brand': '#FFFFFF',
    'status-ok': '#4CC38A', 'status-warn': '#F0B429', 'status-crit': '#EF5350', 'status-idle': '#9A9A9A', 'on-status': '#111111',
    danger: '#C62828', 'danger-lo': '#A61F1F', 'on-danger': '#FFFFFF',
  },
  gradients: {}, shadows: {}, type, geo,
  parts: {
    panel: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 6, outline: 'inside' },
    row: { fill: 'surface-row', radius: 4 }, track: { fill: 'surface-well', radius: 3 },
    fill: { fill: 'state', radius: 2 }, meter: { fill: 'state' }, mark: { fill: 'border-strong' }, target: { fill: 'text' },
    'button.secondary': { fill: 'surface-row', stroke: 'border', width: 1, radius: 4, outline: 'inside' },
    'button.primary': { fill: 'brand', radius: 4, ink: 'on-brand' },
    'button.danger': { fill: 'danger', radius: 4, ink: 'on-danger' },
    focus: { fill: 'none', stroke: 'accent', width: 2, radius: 4, outline: 'outside' },
    header: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 0, outline: 'inside' },
    chip: { fill: 'state', radius: 3 },
    'light.idle': { fill: 'status-idle' }, 'light.ok': { fill: 'status-ok' },
    'light.warn': { fill: 'status-warn' }, 'light.crit': { fill: 'status-crit' },
    'switch.off': { fill: 'surface-well' }, 'switch.on': { fill: 'status-ok' }, knob: { fill: 'text' },
    field: vanillaPlus.parts.field, 'field.text': vanillaPlus.parts['field.text'], 'field.placeholder': vanillaPlus.parts['field.placeholder'],
    shape: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 4 }, line: { stroke: 'border-strong', width: 2 },
    'duct.track': { fill: 'border' }, 'duct.flow': { stroke: 'text-secondary' },
    'gauge.track': { stroke: 'border-strong', width: 4 }, 'gauge.tick': { stroke: 'border', width: 2 },
    'gauge.needle': { stroke: 'accent', width: 3 }, 'gauge.hub': { fill: 'text' },
  },
  stateWords: ['OK', 'WARN', 'CRIT'], pressed: 0.25, drawText: 'message',
  metrics: metricsFor(type, geo, linesOf),
}
