import { expect, it } from 'vitest'
import gap from './gap'

it('names the gap commands without ellipses because the status bar provides their value', () => {
  expect(gap.map(c => c.label)).toEqual(['Gap across', 'Gap down'])
})
