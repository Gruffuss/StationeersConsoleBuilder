// The Vanilla + preset (spec §5.2; token set version 3): its colour tokens, aliases resolved, each role named as its token;
// then the gradients, type styles, geometry and shadows the widgets draw with.
import type { Theme } from './types'
import { faceName } from './faces'

/** A Fonts-mod face name (D13): the regular weight is the bare family, every other weight the family plus its style. */
export const faceOf = (family: string, weight: 400 | 500 | 600 | 700) =>
  faceName(family, weight, false)
const BC = 'Barlow Condensed', B = 'Barlow'

export const vanillaPlus: Theme = {
  id: 'vanilla-plus', name: 'Vanilla +',
  colors: {
    'surface-screen-hi': '#3A3A43', 'surface-screen': '#313139', 'surface-screen-lo': '#24242A', 'surface-panel': '#1D1D23',
    'surface-row-hi': '#3B3B45', 'surface-row': '#36363F', 'surface-row-lo': '#32323A', 'surface-well': '#111116',
    'border': '#5A5A69', 'border-strong': '#8E8E9E', 'text': '#FFFFFF', 'text-secondary': '#C8C8D2', 'text-muted': '#A6A6B4',
    'accent': '#FF772D', 'brand-hi': '#1D4F7F', 'brand': '#17487A', 'brand-lo': '#0D3B6A', 'on-brand': '#FFFFFF',
    'status-ok': '#7FD970', 'status-warn': '#F2B233', 'status-crit': '#F7777A', 'status-idle': '#A6A6B4', 'on-status': '#17171B',
    'danger': '#B93237', 'danger-lo': '#932629', 'on-danger': '#FFFFFF', 'gas-outline': '#FFFFFF', 'on-gas-light': '#17171B',
    'on-gas-dark': '#FFFFFF', 'gas-o2': '#F2F2F2', 'gas-n2': '#101113', 'gas-n2-fill': '#5E6F82', 'gas-co2': '#4A4D52',
    'gas-co2-fill': '#A39A8E', 'gas-h2': '#B93237', 'gas-h2-alt': '#6E747C', 'gas-h2-fill': '#C23A30', 'gas-ch4': '#B93237',
    'gas-ch4-fill': '#F0705F', 'gas-n2o': '#4FB85C', 'gas-x': '#F2C91E', 'gas-o3': '#7A4FC4', 'gas-o3-fill': '#A583E8',
  },
  // Two stops, top to bottom, units=bbox (the worst mid-ramp difference against CSS is 2 levels).
  gradients: { screen: ['surface-screen-hi', 'surface-screen-lo'], row: ['surface-row-hi', 'surface-row-lo'],
    brand: ['brand-hi', 'brand-lo'], danger: ['danger', 'danger-lo'] },
  parts: {
    panel: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 10, outline: 'inside', shadow: 'wellInset' },
    row: { fill: { gradient: 'row' }, stroke: 'border', width: 1, radius: 6, outline: 'inside' },
    track: { fill: 'surface-well', stroke: 'border', width: 1, radius: 4, outline: 'inside' },
    fill: { fill: 'state', radius: 2 }, meter: { fill: 'state' }, mark: { fill: 'border-strong' }, target: { fill: 'text' },
    'button.secondary': { fill: { gradient: 'row' }, stroke: 'border', width: 1, radius: 6, outline: 'inside' },
    'button.primary': { fill: { gradient: 'brand' }, stroke: 'accent', width: 2, radius: 6, outline: 'inside' },
    'button.danger': { fill: { gradient: 'danger' }, radius: 6, ink: 'on-danger' },
    focus: { fill: 'none', stroke: 'accent', width: 3, radius: 6, outline: 'outside' },
    header: { fill: { gradient: 'brand' }, stroke: 'accent', width: 3, radius: 14, outline: 'inside' },
    chip: { fill: 'state', radius: 4 },
    'light.idle': { fill: 'status-idle' }, 'light.ok': { fill: 'status-ok', shadow: 'glowOk' },
    'light.warn': { fill: 'status-warn', shadow: 'glowWarn' }, 'light.crit': { fill: 'status-crit', shadow: 'glowCrit' },
    'switch.off': { fill: 'surface-well' }, 'switch.on': { fill: 'status-ok' }, knob: { fill: 'text' },
    field: { fill: 'surface-well' }, 'field.text': { fill: 'text' }, 'field.placeholder': { fill: 'text-muted' },
    shape: { fill: 'surface-panel', stroke: 'border', width: 1, radius: 6 }, line: { stroke: 'border-strong', width: 2 },
    'duct.track': { fill: 'border' }, 'duct.flow': { stroke: 'text-secondary' },
    'gauge.track': { stroke: 'border-strong', width: 6 }, 'gauge.tick': { stroke: 'border', width: 2 },
    'gauge.needle': { stroke: 'accent', width: 4 }, 'gauge.hub': { fill: 'text' },
  },
  stateWords: ['OK', 'WARN', 'CRIT'], pressed: 0.25, drawText: 'message',
  metrics: {
    'icon.size': 66,
    'panel.titleY': 10, 'panel.unitW': 80, 'header.clockW': 120, 'header.countW': 47, 'header.countH': 34, 'header.inset': 6,
    'hero.figureH': 187.2, 'hero.barY': 177.2, 'hero.fillH': 20, 'hero.statusY': 219, 'hero.unitY': 85.5, 'hero.unitGap': 8,
    'kpi.unitW': 60, 'kpi.unitY': 7, 'kpi.meterGap': 3.8, 'kpi.meterH': 3, 'compact.statusW': 120,
    'row.valueW1': 110, 'row.valueW2': 90, 'table.valueW': 176, 'list.pitch': 56, 'eventlog.timeW': 80, 'repeater.valueW': 130,
    'bar.inset': 5, 'bar.markInset': 3, 'stepper.valueW': 110, 'switch.w': 64, 'switch.h': 38, 'switch.inset': 2, 'toggle.stateW': 84,
    'alert.messageH': 42, 'devices.pad': 24, 'devices.gap': 12, 'devices.pitch': 56, 'devices.labelW': 100,
  },
  // cspace = track px / size × 100; a fit=ellipsis box is at least 1.4 × size tall.
  type: {
    hero: { font: faceOf(BC, 700), size: 156, cspace: 0, upper: false, ink: 'text', shadow: 'textDrop' },
    'screen-title': { font: faceOf(BC, 700), size: 36, cspace: 4.17, upper: true, ink: 'on-brand', shadow: 'textDrop' },
    clock: { font: faceOf(BC, 600), size: 28, cspace: 3.57, upper: true, ink: 'on-brand', shadow: 'textDrop' },
    'panel-title': { font: faceOf(BC, 700), size: 26, cspace: 5.77, upper: true, ink: 'text-muted', shadow: 'textDrop' },
    'button-label': { font: faceOf(BC, 700), size: 26, cspace: 3.85, upper: true, ink: 'text', shadow: 'textDrop' },
    'chip-label': { font: faceOf(BC, 700), size: 24, cspace: 2.08, upper: true, ink: 'on-status' },
    'value-lg': { font: faceOf(B, 600), size: 34, cspace: 0, upper: false, ink: 'text', shadow: 'textDrop' },
    value: { font: faceOf(B, 600), size: 28, cspace: 0, upper: false, ink: 'text', shadow: 'textDrop' },
    reading: { font: faceOf(B, 500), size: 28, cspace: 0, upper: false, ink: 'text-secondary', shadow: 'textDrop' },
    message: { font: faceOf(B, 500), size: 26, cspace: 0, upper: false, ink: 'text', shadow: 'textDrop' },
    unit: { font: faceOf(B, 500), size: 24, cspace: 0, upper: false, ink: 'text-muted', shadow: 'textDrop' },
  },
  geo: {
    space: { 1: 4, 2: 6, 3: 10, 4: 14, 5: 16, 6: 18, 7: 24 },
    radius: { xs: 2, sm: 4, md: 6, lg: 10, xl: 14 },
    edge: { hair: 1, strong: 2, header: 3, primary: 2, focus: 3 },
    size: { header: 64, light: 18, bar: 30, row: 50, control: 54 },
    floor: 24, chip: { w: 86, h: 34.8 }, heroUnit: 64,
  },
  // Nothing else casts a shadow.
  shadows: {
    wellInset: [[0, 2, 6, 0, '#0000008C', 'inset']], textDrop: [[0, 2, 2, 0, '#00000099']],
    glowOk: [[0, 0, 10, 0, 'status-ok']], glowWarn: [[0, 0, 10, 0, 'status-warn']], glowCrit: [[0, 0, 10, 0, 'status-crit']],
  },
}
