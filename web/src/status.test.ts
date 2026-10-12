import { describe, expect, it } from 'vitest'
import type { Status } from './runtime/bridge'
import { patchFailure, statusLines } from './status'

const status = (state: Status['state'], error: string | null, instructions = 7): Status => ({ state, error, instructions, output: [] })

describe('statusLines', () => {
  it('announces the halted core and an erroring run line, not the per-tick run line', () => {
    expect(statusLines('core ready in 90 ms', status('Running', null), ['patch failed: x'])).toEqual({
      shown: 'core ready in 90 ms\nRunning (7 instructions)', spoken: 'patch failed: x' })
    expect(statusLines('halted: the core stopped answering', status('Halted', 'boom'), [])).toEqual({
      shown: '', spoken: 'halted: the core stopped answering\nHalted: boom (7 instructions)' })
  })
})

describe('patchFailure', () => {
  it('says only the failures that are the patch\'s own, not the error a halted chip carries', () => {
    expect(patchFailure(status('Running', null), null)).toBe('')
    expect(patchFailure(status('Halted', 'boom'), 'boom')).toBe('')
    expect(patchFailure(status('Halted', 'no vector scene main/scene to patch'), 'boom')).toBe('patch failed: no vector scene main/scene to patch')
  })
})
