import { expect, it } from 'vitest'
import { neutral } from './neutral'

it('Neutral by its own rules', async () => {
  const { metricsFor } = await import('./metrics'), { linesOf } = await import('./faces')
  const expected = {
    'icon.size': 66, 'hero.figureH': 144, 'hero.barY': 134, 'hero.fillH': 16,
    'hero.statusY': 168, 'hero.unitGap': 8, 'hero.unitY': 63.360937500000006,
    'panel.titleY': 10, 'panel.unitW': 64, 'header.clockW': 100, 'header.countW': 40,
    'header.countH': 34, 'header.inset': 4, 'kpi.unitW': 48, 'kpi.unitY': 6,
    'kpi.meterGap': 3.8, 'kpi.meterH': 3, 'compact.statusW': 100, 'row.valueW1': 96,
    'row.valueW2': 80, 'table.valueW': 150, 'list.pitch': 54, 'eventlog.timeW': 72,
    'repeater.valueW': 110, 'bar.inset': 4, 'bar.markInset': 3, 'stepper.valueW': 96,
    'switch.w': 56, 'switch.h': 32, 'switch.inset': 2, 'toggle.stateW': 72,
    'alert.messageH': 31, 'devices.pad': 24, 'devices.gap': 10, 'devices.pitch': 54, 'devices.labelW': 101,
  }
  expect(metricsFor(neutral.type, neutral.geo, linesOf)).toEqual(expected)
  expect(neutral.metrics).toEqual(expected)
})
