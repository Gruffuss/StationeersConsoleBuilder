import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { EDGE } from './gl'
import { textOutline } from './fonts'

const tables = JSON.parse(readFileSync(new URL('../../test/fixtures/frames/shader-tables.json', import.meta.url), 'utf8')) as {
  outline: { font: string | null; size: number; stroke: number; width: number; boldRatio: number }[]
  edge: { y: number; g: number; x: number; band: number; coverage: number }[]
}
it('113: preview outline widths and bold ratios match the tagged TextOutline.cs table', () => {
  expect(tables.outline).toHaveLength(48)
  for (const row of tables.outline) {
    const result = textOutline(row.font, row.stroke, row.size)
    expect(result.width, JSON.stringify(row)).toBeCloseTo(row.width, 4)
    expect(result.boldRatio, JSON.stringify(row)).toBeCloseTo(row.boldRatio, 5)
  }
})
it('117: shader coverage matches the tagged EdgeRamp.cs table including geometric fallback', () => {
  expect(tables.edge).toHaveLength(32)
  const body = EDGE.slice(EDGE.indexOf('{') + 1, EDGE.lastIndexOf('}')).replace(/\bfloat\b/g, 'let')
  const run = new Function('y', 'g', 'x', 'band', 'clamp', 'abs', 'min', body)
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
  for (const row of tables.edge)
    expect(run(row.y, row.g, row.x, row.band, clamp, Math.abs, Math.min), JSON.stringify(row)).toBeCloseTo(row.coverage, 5)
})
