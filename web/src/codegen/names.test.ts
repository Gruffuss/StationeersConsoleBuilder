import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { parseSrc } from '../srctext/parse'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import type { WidgetRef } from '../widgets/types'
import { namesOf } from './names'

describe('namesOf', () => {
  it('travel follows the switch width', () => {
    const t = { ...vanillaPlus, metrics: { ...vanillaPlus.metrics, 'switch.w': 96 } }, w = instance('toggle', { look: 'switch' })
    const page = newProject().pages[0]
    expect(namesOf({ ...page, scene: putWidget(page.scene, w, t) }, t).find(n => n.slot === 'on')?.travel).toBe(96)
  })
  it('keeps unbounded readers and colour thresholds out of the normalized travel bound', () => {
    const page = newProject().pages[0]
    const shared = (...ws: WidgetRef[]) => namesOf({ ...page, scene: ws.reduce((s, w) => putWidget(s, w, vanillaPlus), page.scene) }, vanillaPlus).find(n => n.name === 'shared')!
    const bar = instance('bar', { keys: { lvl: 'shared' } })
    const auto = instance('bar', { stateMode: 'auto', keys: { lvl: 'shared' } }, 'bar2')
    expect(shared(bar).travel).toBe(400)
    expect(shared(bar, auto).travel).toBeUndefined()
    expect(shared(auto, bar).travel).toBeUndefined()
    const scene = putWidget(page.scene, bar, vanillaPlus)
    scene.root.push(...parseSrc('SCENE w=480 h=480\nR w="100000*$shared" h=10\n').scene!.root)
    expect(namesOf({ ...page, scene }, vanillaPlus).find(n => n.name === 'shared')!.travel).toBeUndefined()
    const transformed = putWidget(page.scene, bar, vanillaPlus)
    transformed.root[0].attrs.s = [100, 100]
    expect(namesOf({ ...page, scene: transformed }, vanillaPlus).find(n => n.name === 'shared')!.travel).toBeUndefined()
  })
  it('raw translation can ease while a raw name shared with text snaps', () => {
    const page = newProject().pages[0]
    const scene = parseSrc('SCENE w=480 h=480\nG t=[$move,0] { R w=$shared h=10 }\nT text="$shared"\n').scene!
    const by = Object.fromEntries(namesOf({ ...page, scene }, vanillaPlus).map(n => [n.name, n]))
    expect(by.move.geometry).toBe(true)
    expect(by.shared.geometry).toBeUndefined()
  })
  it('does not report $word inside a quoted expression as a raw name', () => {
    const page = newProject().pages[0]
    const scene = { ...page.scene, root: [{ op: 'R', attrs: { x: '=\"$word\" + $actual', y: "='$other'" } }] }
    expect(namesOf({ ...page, scene }, vanillaPlus).filter(n => n.kind === 'raw').map(n => n.name)).toEqual(['actual'])
  })
  it('lists widget slots (snapped when any reader snaps), raw names, and native props', () => {
    const p = newProject()
    let scene = parseSrc('SCENE w=480 h=480\nR x=0 y=0 w=$w h=10 f=$colour\nT x=0 y=20 w=100 h=20 text="{$bar1_lvl}"\n').scene!
    scene = putWidget(scene, instance('bar'), vanillaPlus)
    const names = namesOf({ ...p.pages[0], scene, natives: [instance('icon'), instance('textinput')] }, vanillaPlus)
    const by = Object.fromEntries(names.map(n => [n.name, n]))
    expect(by.bar1_lvl).toMatchObject({ kind: 'number', snap: true, slot: 'lvl', widget: 'bar1' })
    expect(by.w).toEqual({ name: 'w', kind: 'raw', snap: true, geometry: true })
    expect(by.colour).toEqual({ name: 'colour', kind: 'raw', snap: true })
    expect(by['@ico1.name']).toEqual({ name: '@ico1.name', kind: 'native', snap: true, native: { uid: 'ico1', prop: 'name' } })
    expect(by['@ti1.value']).toMatchObject({ kind: 'native', native: { uid: 'ti1', prop: 'value' } })
  })
  it('lists a raw name only where the mod binds one: a literal $word in a label is text, a label or paint binding is named whole', () => {
    const page = newProject().pages[0]
    let scene = parseSrc('SCENE w=480 h=480\nT x=0 y=0 w=50 h=10 text="Price $5"\nR x=0 y=20 w=5 h=5 f="$my-colour"\n').scene!
    scene = putWidget(scene, instance('readout', { keys: { v: 'room kPa' } }), vanillaPlus)
    const names = namesOf({ ...page, scene }, vanillaPlus)
    expect(names.filter(n => n.kind === 'raw').map(n => n.name)).toEqual(['my-colour'])
    expect(names.find(n => n.name === 'room kPa')).toMatchObject({ kind: 'text', widget: 'ro1' })
  })
  it('lists a raw name an expression reads with no leading =, and none a literal key holds', () => {
    const page = newProject().pages[0]
    const scene = parseSrc('SCENE w=480 h=480\nR x="1+$a" y=0 w=sqrt($b) h=10 v="clamp($c,0,1)" id="$x"\nT x=0 y=10 w=50 h=10 text=hi oc="$y"\n').scene!
    expect(namesOf({ ...page, scene }, vanillaPlus).filter(n => n.kind === 'raw').map(n => n.name)).toEqual(['a', 'b', 'c'])
  })
  it('puts a name an eased slot and a snapped slot both read on the snapped element, in either order (the per-tick contract)', () => {
    const page = newProject().pages[0], bar = instance('bar', { keys: { lvl: 'shared' } }), stp = instance('stepper', { keys: { v: 'shared' } })
    const shared = (...ws: WidgetRef[]) =>
      namesOf({ ...page, scene: ws.reduce((s, w) => putWidget(s, w, vanillaPlus), page.scene) }, vanillaPlus).filter(n => n.name === 'shared')
    expect(shared(bar)).toEqual([expect.objectContaining({ snap: false, widget: 'bar1' })])   // the bar alone eases it
    expect(shared(stp)).toEqual([expect.objectContaining({ snap: true, widget: 'stp1' })])
    expect(shared(bar, stp)).toEqual([expect.objectContaining({ snap: true })])
    expect(shared(stp, bar)).toEqual([expect.objectContaining({ snap: true })])
  })
})
