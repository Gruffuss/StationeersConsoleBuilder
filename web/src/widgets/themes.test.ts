import { describe, expect, it } from 'vitest'
import { newPage, newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { node } from '../model/testing'
import { THEMES } from '../theme'
import { sanitize } from './core'
import { TEST_CTX } from './testing'
import { gradientDef } from './paint'
import { WIDGETS } from './registry'
import { checked, rules } from './testing'

describe('every widget in every theme', () => {
  it('expands its defaults with no rule broken and nothing from the checker', () => {
    for (const t of Object.values(THEMES)) for (const m of Object.values(WIDGETS).filter(m => !m.native)) {
      const w = { type: m.type, uid: m.prefix + '1', params: sanitize(m, m.defaults(t, TEST_CTX), t) }
      expect({ theme: t.id, type: m.type, problems: [...rules(w, t), ...checked(w, t)] }).toEqual({ theme: t.id, type: m.type, problems: [] })
    }
  })
})

describe('the theme switch and plain nodes', () => {
  it('refreshes every real theme gradient on every page and tops up missing raw references', () => {
    const p = newProject(), t = THEMES['vanilla-plus']
    p.pages.push(newPage(p))
    for (const page of p.pages) {
      page.scene.defs = Object.keys(t.gradients).filter(name => name !== 'brand').map(name => {
        const d = gradientDef(t, name)
        return { ...d, attrs: { ...d.attrs, stops: [[0, '#010203'], [1, '#040506']] } }
      })
      page.scene.root = Object.keys(t.gradients).map(name => node('R', { x: 0, y: 0, w: 20, h: 20, f: '@theme_' + name }))
    }
    const s = reducer(initialState(p), { type: 'setTheme', theme: t.id })
    for (const page of s.project.pages) {
      expect(page.scene.defs).toHaveLength(Object.keys(t.gradients).length)
      for (const name of Object.keys(t.gradients)) expect(page.scene.defs.find(d => d.attrs.id === 'theme_' + name)).toEqual(gradientDef(t, name))
    }
    expect(reducer(s, { type: 'undo' }).project).toBe(p)
  })
  it("keeps a plain node's gradient when the new theme has none", () => {
    const p = newProject()
    p.theme = 'vanilla-plus'
    p.pages[0] = { ...p.pages[0], scene: { ...p.pages[0].scene, defs: [gradientDef(THEMES['vanilla-plus'], 'row')], root: [node('R', { f: '@theme_row' })] } }
    const s = reducer(initialState(p), { type: 'setTheme', theme: 'neutral' })
    expect(s.project.pages[0].scene.defs).toEqual(p.pages[0].scene.defs)
    expect(s.project.pages[0].scene.root[0].attrs.f).toBe('@theme_row')
  })
})
