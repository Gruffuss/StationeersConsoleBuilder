import { expect, it } from 'vitest'
import readout from './modules/readout.ts?raw'
import panel from './modules/panel.ts?raw'
import devices from '../codegen/devicesPage.ts?raw'
import metrics from '../theme/metrics.ts?raw'

it('documents theme baselines, unit widths and Devices measurements', () => {
  expect(readout).toContain('theme/baseline.ts')
  expect(readout).toContain('unverified')
  expect(panel).not.toContain('fixed 80-unit')
  expect(panel).toContain('theme metric')
  expect(devices).not.toContain('in the presets')
  expect(metrics).toContain('gap 10')
  expect(metrics).toContain('every page shape')
})
