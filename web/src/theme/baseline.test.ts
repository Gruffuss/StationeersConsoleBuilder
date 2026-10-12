import { expect, it } from 'vitest'
import { faceLines } from '../editor/testing'
import { heroUnitY, LIBERATION_SANS } from './baseline'
import { THEMES } from './index'
import { vanillaPlus } from './vanillaPlus'
import { expandRoot, sanitize, putWidget } from '../widgets/core'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { widgetBox } from '../editor/Handles'
import { WIDGETS } from '../widgets/registry'
import { TEST_CTX } from '../widgets/testing'

it("the faces' lines", () => {
  for (const face of ['Barlow Condensed Bold', 'Barlow Medium'])
    expect(faceLines(face)).toEqual({ ascender: 1000, descender: -200, upem: 1000 })
  expect(faceLines('Liberation Sans')).toEqual(LIBERATION_SANS)
})

it('the rule against Vanilla +', () => {
  const barlow = { ascender: 1000, descender: -200, upem: 1000 }
  expect(heroUnitY(187.2, 156, barlow, 89.6, 64, barlow)).toBeCloseTo(85.6, 4)
  expect(vanillaPlus.metrics['hero.unitY']).toBe(85.5)
})

it('Neutral by the rule', () => {
  const y = heroUnitY(144, 120, LIBERATION_SANS, 1.4 * 48, 48, LIBERATION_SANS)
  expect(y).toBeCloseTo(63.3609, 4)
  expect(THEMES.neutral.metrics['hero.unitY']).toBe(y)
})

it('the hero places it', () => {
  const t = THEMES.neutral, m = WIDGETS.readout
  const params = sanitize(m, { ...m.defaults(t, TEST_CTX), unit: '%', y: 120 }, t)
  const { exp } = expandRoot({ type: 'readout', uid: 'ro1', params }, t)
  const unit = exp.nodes.find(n => n.op === 'T' && n.attrs.text === '%')!
  expect(unit.attrs.y).toBe(Math.fround(120 + t.metrics['hero.unitY']))
})

it('reports the hero status extent after a theme switch, including an ignored typed height', () => {
  const p = newProject(), m = WIDGETS.readout, t = THEMES.neutral
  p.pages[0].scene = putWidget(p.pages[0].scene, { type: 'readout', uid: 'ro1',
    params: sanitize(m, { ...m.defaults(t, TEST_CTX), y: 140, h: 100, unit: '%' }, t) }, t)
  let state = initialState(p)
  for (const theme of ['neutral', 'vanilla-plus', 'neutral']) {
    state = reducer(state, { type: 'setTheme', theme })
    const scene = state.project.pages[0].scene, box = widgetBox(scene, [0], THEMES[theme])!.box
    const status = scene.root[0].c!.find(n => n.op === 'T' && n.attrs.text === '$ro1_status')!
    expect(box.h).toBeCloseTo(theme === 'neutral' ? 201.6 : 258.2, 3)
    expect(Number(status.attrs.y) + Number(status.attrs.h)).toBeCloseTo(box.y + box.h, 3)
  }
})
