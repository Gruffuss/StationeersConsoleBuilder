import { heroUnitY, LIBERATION_SANS, type FaceLines } from './baseline'
import type { Geo, MetricName, Theme } from './types'

export function metricsFor(type: Theme['type'], geo: Geo, lines: (face: string) => FaceLines | undefined): Record<MetricName, number> {
  const figureH = 1.2 * type.hero.size, barY = figureH - 10, barInset = 4, pitch = geo.size.row + geo.space[3]
  return {
    'icon.size': 66,
    'hero.figureH': figureH, 'hero.barY': barY, 'hero.fillH': geo.size.bar - 2 * barInset,
    'hero.statusY': barY + geo.size.bar + geo.space[3], 'hero.unitGap': 8,
    'hero.unitY': heroUnitY(figureH, type.hero.size, lines(type.hero.font) ?? LIBERATION_SANS,
      1.4 * geo.heroUnit, geo.heroUnit, lines(type.unit.font) ?? LIBERATION_SANS),
    'panel.titleY': 10, 'panel.unitW': 64, 'header.clockW': 100, 'header.countW': 40,
    'header.countH': Math.ceil(1.4 * type.value.size), 'header.inset': 4,
    'kpi.unitW': 48, 'kpi.unitY': 6, 'kpi.meterGap': 3.8, 'kpi.meterH': 3, 'compact.statusW': 100,
    'row.valueW1': 96, 'row.valueW2': 80, 'table.valueW': 150, 'list.pitch': pitch,
    'eventlog.timeW': 72, 'repeater.valueW': 110, 'bar.inset': barInset, 'bar.markInset': 3, 'stepper.valueW': 96,
    'switch.w': 56, 'switch.h': 32, 'switch.inset': 2, 'toggle.stateW': 72,
    'alert.messageH': Math.ceil(1.4 * type.message.size), 'devices.pad': 24, 'devices.gap': 10, 'devices.pitch': pitch,
    // labelW 101 fits RESCAN with faux-bold spacing; gap 10 keeps that width on every page shape (Devices tests).
    'devices.labelW': 101,
  }
}
