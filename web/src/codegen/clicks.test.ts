import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { clickTargets, parseStep } from './clicks'

describe('clickTargets', () => {
  it('lists widget plates with their suggested step, press and repeat flags; raw clickable nodes; text inputs', () => {
    const p = newProject(), page = p.pages[0]
    let scene = parseSrc('SCENE w=480 h=480\nR id=pad click=1 xy=1 x=0 y=0 w=10 h=10\nRP n=3 {\n    R id=cell press=1 x=0 y=0 w=5 h=5\n}\nR id=plain x=0 y=0 w=1 h=1\n').scene!
    for (const type of ['toggle', 'stepper', 'repeater']) scene = putWidget(scene, instance(type, type === 'repeater' ? { click: true } : {}), vanillaPlus)
    const t = clickTargets({ ...page, scene, natives: [instance('textinput')] }, vanillaPlus)
    expect(t).toEqual([
      { id: 'pad', page: 'p1', step: '', press: false, inRepeat: false },
      { id: 'cell', page: 'p1', step: '', press: true, inRepeat: true },
      { id: 'tg1_hit', page: 'p1', step: 'toggle', press: false, inRepeat: false, widget: 'tg1' },
      { id: 'stp1_dec', page: 'p1', step: expect.stringMatching(/^step\(/), press: true, inRepeat: false, widget: 'stp1' },
      { id: 'stp1_inc', page: 'p1', step: expect.stringMatching(/^step\(/), press: true, inRepeat: false, widget: 'stp1' },
      { id: 'rep1_r', page: 'p1', step: 'id:i', press: false, inRepeat: true, widget: 'rep1' },
      { id: 'ti1', page: 'p1', step: 'set', press: false, inRepeat: false, native: true },
    ])
  })
  it('lists a node that only drags, drops or reports hover: each sends plain clicks too (REFERENCE.md)', () => {
    const p = newProject()
    const scene = parseSrc('SCENE w=480 h=480\nR id=h hoverev=1 x=0 y=0 w=5 h=5\nR id=d drag=1 x=10 y=0 w=5 h=5\n').scene!
    expect(clickTargets({ ...p.pages[0], scene }, vanillaPlus).map(x => x.id)).toEqual(['h', 'd'])
  })
  it('reads a flag as the mod does: on above 0.5 (SceneModel PropNumber > 0.5f), so click=2 and press=0.75 count, 0.5 not', () => {
    const p = newProject()
    const scene = parseSrc('SCENE w=480 h=480\nR id=a click=2 x=0 y=0 w=5 h=5\nR id=b press=0.75 x=10 y=0 w=5 h=5\nR id=c click=0.5 x=20 y=0 w=5 h=5\n').scene!
    expect(clickTargets({ ...p.pages[0], scene }, vanillaPlus)).toEqual([
      { id: 'a', page: 'p1', step: '', press: false, inRepeat: false },
      { id: 'b', page: 'p1', step: '', press: true, inRepeat: false },
    ])
  })
  it('finds a repeat by its op in any case: the mod upper-cases an op (SceneModel), so a nested rp gives id:i', () => {
    const p = newProject()
    const scene = parseSrc('SCENE w=480 h=480\nrp n=2 {\n    R id=d click=1 x=0 y=0 w=5 h=5\n}\n').scene!
    expect(clickTargets({ ...p.pages[0], scene }, vanillaPlus)).toEqual([{ id: 'd', page: 'p1', step: '', press: false, inRepeat: true }])
  })
  it('lists one target per id on a page, the first in pre-order, wherever the nodes stand: every node with an id sends that id', () => {
    const p = newProject()
    let scene = parseSrc('SCENE w=480 h=480\nR id=a press=1 x=0 y=0 w=5 h=5\nR id=a click=1 x=10 y=0 w=5 h=5\nG {\n    R id=a click=1 x=20 y=0 w=5 h=5\n}\n').scene!
    scene = putWidget(scene, instance('toggle'), vanillaPlus)
    scene = { ...scene, root: [...scene.root, ...parseSrc('SCENE w=480 h=480\nR id=tg1_hit click=1 x=30 y=0 w=5 h=5\n').scene!.root] }
    expect(clickTargets({ ...p.pages[0], scene }, vanillaPlus)).toEqual([
      { id: 'a', page: 'p1', step: '', press: true, inRepeat: false },
      { id: 'tg1_hit', page: 'p1', step: 'toggle', press: false, inRepeat: false, widget: 'tg1' },
    ])
  })
})

describe('parseStep', () => {
  it('reads the steps the widget modules suggest', () => {
    expect(parseStep('toggle')).toEqual({ op: 'toggle' })
    expect(parseStep('cycle')).toEqual({ op: 'cycle' })
    expect(parseStep('set(2)')).toEqual({ op: 'set', value: 2 })
    expect(parseStep('page(p2)')).toEqual({ op: 'page', page: 'p2' })
    expect(parseStep('step(-1,0,10)')).toEqual({ op: 'step', by: -1, min: 0, max: 10 })
    expect(parseStep('step(0.5,-2.5,1e3)')).toEqual({ op: 'step', by: 0.5, min: -2.5, max: 1000 })
    expect(parseStep('id:i')).toEqual({ op: 'index' })
    expect(parseStep('')).toEqual({ op: 'none' })
    expect(parseStep('what')).toEqual({ op: 'none' })
  })
})
