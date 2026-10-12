import { describe, expect, it } from 'vitest'
import type { Binding } from '../model/logic'
import { newProject, type Project } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { readTraps } from './checks'

const project = (over: Partial<Project>): Project => {
  const p = { ...newProject(), roles: [{ id: 't', name: 'T', prefabs: [], mode: 'one' as const }], ...over }
  p.pages[0] = { ...p.pages[0], scene: putWidget(parseSrc('SCENE w=480 h=480\nR x=0 y=0 w=10 h=10 f=$c s=$edge\n').scene!, instance('bar'), vanillaPlus) }
  return p
}

describe('readTraps', () => {
  it('warns when an eased number that drives geometry reads a read with no clamp and no derived', () => {
    const lvl = { from: 'read' as const, read: 'p' }
    expect(readTraps(project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } } }], bindings: { bar1_lvl: lvl } }), vanillaPlus))
      .toEqual([{ level: 'warning', message: 'bar1_lvl: drives geometry from read p, which has no clamp; a value out of range draws outside its widget' }])
    expect(readTraps(project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } }, clamp: [0, 1] }], bindings: { bar1_lvl: lvl } }), vanillaPlus)).toEqual([])
    expect(readTraps(project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } }, derived: 'x / 100' }], bindings: { bar1_lvl: lvl } }), vanillaPlus)).toEqual([])
  })
  it('checks what a paint reads as a colour: a constant must parse; other sources get information', () => {
    expect(readTraps(project({ bindings: { c: { from: 'const', value: 'not-a-colour' } } }), vanillaPlus))
      .toEqual([{ level: 'warning', message: 'c: a paint reads it as a colour; the constant is not a valid colour, so it draws magenta' }])
    expect(readTraps(project({ bindings: { c: { from: 'const', value: '#FF0000' }, edge: { from: 'const', value: '#11223344' } } }), vanillaPlus)).toEqual([])
    expect(readTraps(project({ state: [{ name: 'k', type: 'string', init: '#000000' }], bindings: { edge: { from: 'state', state: 'k' } } }), vanillaPlus))
      .toEqual([{ level: 'info', message: 'edge: a paint reads it as a colour: send #hex, none or named colour strings' }])
  })
  // Accepted independently from Colours.cs:26-48 and REFERENCE.md's data colour grammar.
  it.each(['red', '#fff', 'none', 'gray', ' #112233 ', '#aBcD', '#aBcDeF', '#aBcDeF00',
    'cyan', 'blue', 'darkblue', 'lightblue', 'purple', 'yellow', 'lime', 'fuchsia', 'white', 'silver',
    'grey', 'black', 'orange', 'brown', 'maroon', 'green', 'olive', 'navy', 'teal', 'aqua', 'magenta',
    'transparent', ' RED ', '\tGrAy\n', ' NONE ', ' TRANSPARENT '])('accepts the data colour constant %j', value => {
    expect(readTraps(project({ bindings: { c: { from: 'const', value } } }), vanillaPlus)).toEqual([])
  })
  it('reports each message once across repeated paints and pages, and never an error', () => {
    const p = project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } } }],
      bindings: { bar1_lvl: { from: 'read', read: 'p' }, c: { from: 'const', value: 'not-a-colour' }, edge: { from: 'expr', expr: 'S.k' } } })
    const expected = readTraps(p, vanillaPlus)
    p.pages[0].scene.root.push({ op: 'R', attrs: { f: '$c', s: '$c', s_: '$c' } })
    p.pages.push({ ...p.pages[0], id: 'p2', surface: 'page2' })
    expect(readTraps(p, vanillaPlus)).toEqual(expected)
    expect(expected.map(x => x.level)).toEqual(['warning', 'warning', 'info'])
  })
  it('does not warn about missing reads, state/history parts, constants, raw geometry or snapped slots', () => {
    const sources: Binding[] = [{ from: 'read', read: 'missing' }, { from: 'read', read: 'p', part: 'state' },
      { from: 'read', read: 'p', part: 'history' }, { from: 'const', value: 2 }]
    for (const source of sources) {
      expect(readTraps(project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } } }], bindings: { bar1_lvl: source } }), vanillaPlus)).toEqual([])
    }
    const p = project({ reads: [{ id: 'p', role: 't', of: { lt: { name: 'Pressure' } } }],
      bindings: { bar1_lvl: { from: 'read', read: 'p' }, width: { from: 'read', read: 'p' } } })
    p.pages[0].scene = putWidget(p.pages[0].scene, instance('stepper', { keys: { v: 'bar1_lvl' } }), vanillaPlus)
    p.pages[0].scene.root.push({ op: 'R', attrs: { w: '$width' } })
    expect(readTraps(p, vanillaPlus)).toEqual([])
  })
  it('warns about rejected colour strings and non-string colour constants', () => {
    const values = ['', '   ', 'FFFFFF', '#ff', '#fffff', '#1122334', '#1122334455', '#gg2233',
      '#12 233', 'rgba(255,0,0,1)', 'hsl(0,100%,50%)', 'not-a-colour', 123, ['#112233']]
    for (const value of values) {
      expect(readTraps(project({ bindings: { c: { from: 'const', value } } }), vanillaPlus))
        .toEqual([{ level: 'warning', message: 'c: a paint reads it as a colour; the constant is not a valid colour, so it draws magenta' }])
    }
  })
  it('gives colour information for reads, expressions, exports and logs', () => {
    const sources: Binding[] = [{ from: 'read', read: 'p' }, { from: 'expr', expr: 'S.k' },
      { from: 'export', name: 'colour' }, { from: 'log', part: 'm' }]
    for (const source of sources) {
      expect(readTraps(project({ bindings: { c: source } }), vanillaPlus))
        .toEqual([{ level: 'info', message: 'c: a paint reads it as a colour: send #hex, none or named colour strings' }])
    }
  })
  it('finds shadow paints in nested definitions and respects the first folded attribute', () => {
    const p = project({ bindings: { shadow: { from: 'const', value: 'not-a-colour' }, ignored: { from: 'const', value: 'not-a-colour' } } })
    p.pages[0].scene.defs.push({ op: 'SYM', attrs: { id: 'mark' }, c: [
      { op: 'R', attrs: { S_: '$shadow', s_: '$ignored' } },
    ] })
    expect(readTraps(p, vanillaPlus))
      .toEqual([{ level: 'warning', message: 'shadow: a paint reads it as a colour; the constant is not a valid colour, so it draws magenta' }])
  })
  it('ignores colour expressions, indexed paints and widget state slots', () => {
    const p = project({ bindings: { c: { from: 'const', value: 'not-a-colour' }, edge: { from: 'const', value: 'not-a-colour' }, bar1_st: { from: 'const', value: 2 } } })
    p.pages[0].scene.root[0] = { op: 'R', attrs: { f: '=if($c,#112233,#445566)', s: '$edge[0]' } }
    expect(readTraps(p, vanillaPlus)).toEqual([])
  })
  it('ignores inherited binding properties and unused bindings', () => {
    const bindings = Object.create({ c: { from: 'const', value: 'not-a-colour' } }) as Project['bindings']
    bindings.unused = { from: 'const', value: 'not-a-colour' }
    expect(readTraps(project({ bindings }), vanillaPlus)).toEqual([])
  })
  it('checks paint defaults on the scene header', () => {
    const p = project({ bindings: { headerColour: { from: 'const', value: 'not-a-colour' } } })
    p.pages[0].scene.header.f = '$headerColour'
    expect(readTraps(p, vanillaPlus))
      .toEqual([{ level: 'warning', message: 'headerColour: a paint reads it as a colour; the constant is not a valid colour, so it draws magenta' }])
  })
})
