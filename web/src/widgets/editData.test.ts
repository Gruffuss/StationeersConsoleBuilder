import { expect, it } from 'vitest'
import core from './core.ts?raw'
import { value } from './editData'
import type { Value } from '../model/scene'

it('keeps core independent of edit extraction', () => {
  expect(/from ['"]\.\/edits['"]/.test(core)).toBe(false)
})

it('copies deep values iteratively and rejects a cycle', () => {
  let input: Value = 1
  for (let i = 0; i < 15000; i++) input = [input]
  let copied = value(input)
  expect(copied === input).toBe(false)
  for (let i = 0; i < 15000; i++) {
    expect(Array.isArray(copied)).toBe(true)
    copied = (copied as Value[])[0]
  }
  expect(copied).toBe(1)
  const cycle: unknown[] = []; cycle.push(cycle)
  expect(value(cycle)).toBeUndefined()
})
