import { describe, expect, it } from 'vitest'
import { mapError, type MapEntry } from './linemap'

describe('mapError', () => {
  const map: MapEntry[] = [{ first: 1, last: 400, part: 'lib' }, { first: 401, last: 401, part: 'read', ref: 'tankP' },
    { first: 402, last: 402, part: 'rule', ref: 'r1' }, { first: 410, last: 415, part: 'custom' }]
  it('names the owner of the line a chip error points at (the measured Lua-CSharp form)', () => {
    expect(mapError('Lua-CSharp: [string "chip"]:401: attempt to add a nil value (local \'x\') with a number value', map))
      .toBe('read tankP: attempt to add a nil value (local \'x\') with a number value')
    expect(mapError('Lua-CSharp: [string "chip"]:412: boom', map)).toBe('custom code line 3: boom')
    expect(mapError('[string "chip"]:12: bad', map)).toBe('generated line 12: bad')
    expect(mapError('[string "chip"]:999: bad', map)).toBe('generated line 999: bad')
    expect(mapError('chip:401: not the form Lua-CSharp writes', map)).toBe('chip:401: not the form Lua-CSharp writes')
    expect(mapError('instruction budget exceeded (tick)', map)).toBe('instruction budget exceeded (tick)')
  })
  it('names a read, rule, action, binding or page only by its ref: an entry without one is generated code', () => {
    const own: MapEntry[] = [...map, { first: 403, last: 403, part: 'read' }, { first: 404, last: 404, part: 'page' }]
    expect(mapError('[string "chip"]:403: bad', own)).toBe('generated line 403: bad')
    expect(mapError('[string "chip"]:404: bad', own)).toBe('generated line 404: bad')
  })
  it('adds no ": " when the error has no message after its position (error(""))', () => {
    expect(mapError('Lua-CSharp: [string "chip"]:412: ', map)).toBe('custom code line 3')
    expect(mapError('[string "chip"]:401:', map)).toBe('read tankP')
    expect(mapError('[string "chip"]:12: ', map)).toBe('generated line 12')
  })
})
