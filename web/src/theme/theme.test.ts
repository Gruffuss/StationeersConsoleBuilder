import { describe, expect, it } from 'vitest'
import { BUNDLED } from '../editor/fonts'
import { newProject } from '../model/project'
import { colour, DEFAULT_THEME, faceOf, groundOf, ROLES, STYLES, THEMES, themeOf } from './index'
import { generate } from '../codegen/generate'
import { initialState, reducer } from '../model/store'
import { printChecked, printSrc } from '../srctext/print'
import { parseSrc } from '../srctext/parse'
import { putWidget, sanitize } from '../widgets/core'
import { el, label } from '../widgets/paint'
import { WIDGETS } from '../widgets/registry'
import { rulesOf, TEST_CTX } from '../widgets/testing'
import { textLook, namedOf } from '../editing/style'
import { vanillaPlus } from './vanillaPlus'

describe('the Vanilla + colours', () => {
  it('defines every required UI role as a hex colour', () => {
    expect(ROLES).toHaveLength(26)
    expect(ROLES).toEqual(expect.arrayContaining(['surface-screen-hi', 'accent', 'on-danger']))
    expect(THEMES[DEFAULT_THEME]).toBe(THEMES.neutral)
    for (const c of Object.values(THEMES['vanilla-plus'].colors)) expect(c).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/i)
  })
  it('give a role its colour, and refuse a role the theme lacks', () => {
    expect(colour(vanillaPlus, 'surface-screen-hi')).toBe('#3A3A43')
    expect(() => colour(vanillaPlus, 'missing')).toThrow('the theme "Vanilla +" has no colour "missing"')
    expect(() => colour(vanillaPlus, 'toString')).toThrow('has no colour "toString"')
  })
  it('give the page ground as its top and bottom colours', () => {
    expect(groundOf(vanillaPlus)).toEqual(['#3A3A43', '#24242A'])
  })
  it('give a project its theme, and Neutral for a name it does not know', () => {
    expect(themeOf(newProject())).toBe(THEMES.neutral)
    expect(themeOf({ ...newProject(), theme: 'nope' })).toBe(THEMES.neutral)
    expect(themeOf({ ...newProject(), theme: 'toString' })).toBe(THEMES.neutral)
  })
})

describe('the widget tokens', () => {
  it('name each weight as ScriptedScreensFonts does', () => {
    expect(([400, 500, 600, 700] as const).map(w => faceOf('Barlow', w))).toEqual(['Barlow', 'Barlow Medium', 'Barlow SemiBold', 'Barlow Bold'])
  })
  it('use bundled faces, and every role they name exists, in every theme', () => {
    expect(STYLES).toHaveLength(11)
    for (const t of Object.values(THEMES)) {
      for (const s of STYLES) {
        if (t.type[s].font) expect(BUNDLED).toContain(t.type[s].font)
        expect(() => colour(t, t.type[s].ink)).not.toThrow()
        if (t.type[s].shadow) expect(t.shadows[t.type[s].shadow!]).toBeDefined()
      }
      for (const [hi, lo] of Object.values(t.gradients)) for (const r of [hi, lo]) expect(() => colour(t, r)).not.toThrow()
      for (const list of Object.values(t.shadows)) for (const [, , , , c] of list) if (c[0] !== '#') expect(() => colour(t, c)).not.toThrow()
    }
  })
  it('hold the Vanilla + numbers', () => {
    const t = THEMES['vanilla-plus']
    expect(t.type['button-label']).toEqual({ font: 'Barlow Condensed Bold', size: 26, cspace: 3.85, upper: true, ink: 'text', shadow: 'textDrop' })
    expect(t.type['chip-label'].shadow).toBeUndefined()
    expect(t.geo.size).toEqual({ header: 64, light: 18, bar: 30, row: 50, control: 54 })
    expect(t.geo.heroUnit).toBe(64)
    expect(t.gradients.row).toEqual(['surface-row-hi', 'surface-row-lo'])
  })
  it('hold every Vanilla + token the widgets draw with', () => {
    const t = THEMES['vanilla-plus'], BC = 'Barlow Condensed', B = 'Barlow'
    // style: face, size, cspace (track px / size × 100), upper, ink, shadow
    const rows: [string, string, number, number, boolean, string, string?][] = [
      ['hero', `${BC} Bold`, 156, 0, false, 'text', 'textDrop'], ['screen-title', `${BC} Bold`, 36, 4.17, true, 'on-brand', 'textDrop'],
      ['clock', `${BC} SemiBold`, 28, 3.57, true, 'on-brand', 'textDrop'], ['panel-title', `${BC} Bold`, 26, 5.77, true, 'text-muted', 'textDrop'],
      ['button-label', `${BC} Bold`, 26, 3.85, true, 'text', 'textDrop'], ['chip-label', `${BC} Bold`, 24, 2.08, true, 'on-status'],
      ['value-lg', `${B} SemiBold`, 34, 0, false, 'text', 'textDrop'], ['value', `${B} SemiBold`, 28, 0, false, 'text', 'textDrop'],
      ['reading', `${B} Medium`, 28, 0, false, 'text-secondary', 'textDrop'], ['message', `${B} Medium`, 26, 0, false, 'text', 'textDrop'],
      ['unit', `${B} Medium`, 24, 0, false, 'text-muted', 'textDrop'],
    ]
    expect(t.type).toStrictEqual(Object.fromEntries(rows.map(([n, font, size, cspace, upper, ink, shadow]) =>
      [n, shadow ? { font, size, cspace, upper, ink, shadow } : { font, size, cspace, upper, ink }])))
    expect(t.geo).toStrictEqual({
      space: { 1: 4, 2: 6, 3: 10, 4: 14, 5: 16, 6: 18, 7: 24 }, radius: { xs: 2, sm: 4, md: 6, lg: 10, xl: 14 },
      edge: { hair: 1, strong: 2, header: 3, primary: 2, focus: 3 },
      size: { header: 64, light: 18, bar: 30, row: 50, control: 54 }, floor: 24, chip: { w: 86, h: 34.8 }, heroUnit: 64,
    })
    expect(t.gradients).toStrictEqual({ screen: ['surface-screen-hi', 'surface-screen-lo'], row: ['surface-row-hi', 'surface-row-lo'],
      brand: ['brand-hi', 'brand-lo'], danger: ['danger', 'danger-lo'] })
    expect(t.shadows).toStrictEqual({ wellInset: [[0, 2, 6, 0, '#0000008C', 'inset']], textDrop: [[0, 2, 2, 0, '#00000099']],
      glowOk: [[0, 0, 10, 0, 'status-ok']], glowWarn: [[0, 0, 10, 0, 'status-warn']], glowCrit: [[0, 0, 10, 0, 'status-crit']] })
  })
  it('gives every theme every required UI role', () => {
    for (const t of Object.values(THEMES)) {
      expect(Object.keys(t.colors)).toEqual(expect.arrayContaining(ROLES))
    }
  })
})

it('retains all 17 Vanilla + gas tokens unchanged', () => {
  expect(Object.fromEntries(Object.entries(vanillaPlus.colors).filter(([k]) => !ROLES.includes(k)))).toEqual({
    'gas-outline': '#FFFFFF', 'on-gas-light': '#17171B', 'on-gas-dark': '#FFFFFF', 'gas-o2': '#F2F2F2',
    'gas-n2': '#101113', 'gas-n2-fill': '#5E6F82', 'gas-co2': '#4A4D52', 'gas-co2-fill': '#A39A8E',
    'gas-h2': '#B93237', 'gas-h2-alt': '#6E747C', 'gas-h2-fill': '#C23A30', 'gas-ch4': '#B93237',
    'gas-ch4-fill': '#F0705F', 'gas-n2o': '#4FB85C', 'gas-x': '#F2C91E', 'gas-o3': '#7A4FC4', 'gas-o3-fill': '#A583E8',
  })
})


it('the default is Neutral', () => {
  expect(DEFAULT_THEME).toBe('neutral')
  expect(Object.keys(THEMES)).toEqual(['neutral', 'vanilla-plus'])
  const p = newProject()
  expect(p.theme).toBe('neutral')
  expect(p.pages[0].background).toEqual(groundOf(THEMES.neutral))
  expect(ROLES).toHaveLength(26)
  expect(ROLES.some(r => r.includes('gas'))).toBe(false)
  for (const t of Object.values(THEMES)) {
    for (const role of ROLES) expect(t.colors[role]).toBeDefined()
    expect(Object.keys(t.parts).sort()).toEqual(Object.keys(vanillaPlus.parts).sort())
    expect(Object.keys(t.metrics).sort()).toEqual(Object.keys(vanillaPlus.metrics).sort())
    for (const metric of Object.values(t.metrics)) expect(Number.isFinite(metric)).toBe(true)
    for (const p of Object.values(t.parts)) {
      for (const paint of [p.fill, p.stroke, p.ink]) {
        if (typeof paint === 'object') expect(t.gradients[paint.gradient]).toBeDefined()
        else if (paint && paint !== 'state' && paint !== 'none') expect(t.colors[paint]).toBeDefined()
      }
      if (p.shadow) expect(t.shadows[p.shadow]).toBeDefined()
    }
  }
})

it('no Fonts mod for widgets', () => {
  const p = newProject(), t = THEMES.neutral
  expect(t).toBeDefined()
  p.theme = 'neutral'
  for (const m of Object.values(WIDGETS).filter(m => !m.native)) {
    const params = sanitize(m, m.defaults(t, TEST_CTX), t)
    p.pages[0].scene = putWidget(p.pages[0].scene, { type: m.type, uid: m.prefix + '1', params }, t)
  }
  expect(printChecked(p.pages[0].scene)).not.toMatch(/\bfont=/)
  expect(generate(p, pg => printSrc(pg.scene)).lua.split('\n').filter(l => /require|Requires/.test(l)).join('\n')).not.toContain('ScriptedScreens Fonts')
})

it('E10 accepts the default face', () => {
  const root = el('G', { id: 'txt1' }, [el('T', { text: 'Title', size: 22, weight: 'bold' })])
  expect(rulesOf(root, [], { nodes: root.c!, slots: [] }, 'txt1')).toEqual([])
  root.c![0].attrs.weight = 'normal'
  expect(rulesOf(root, [], { nodes: root.c!, slots: [] }, 'txt1')).not.toEqual([])
})

it('a removed preset id loads as the default with a notice', () => {
  const p = { ...newProject(), theme: 'slate' }, t = THEMES['vanilla-plus'], m = WIDGETS.readout
  const params = sanitize(m, { ...m.defaults(t, TEST_CTX), variant: 'kpi', unit: '%', caption: '#404' }, t)
  p.pages[0].scene = putWidget(p.pages[0].scene, { type: m.type, uid: 'ro1', params }, t)
  // Removed palettes shared Vanilla +'s drawing; colour changes must not prevent the other-theme match.
  const text = printChecked(p.pages[0].scene).replace(/#FFFFFF/g, '#123456')
  p.pages[0].scene = parseSrc(text).scene!
  const raw = { op: 'R', attrs: { x: 0, y: 0, w: 10, h: 10, f: '#123456' } }
  p.pages[0].scene.root.push(raw)
  const loaded = reducer(initialState(), { type: 'loadProject', project: p })
  expect(loaded.project.theme).toBe('neutral')
  expect(themeOf(loaded.project)).toBe(THEMES.neutral)
  expect(loaded.notice).toContain('slate')
  expect(loaded.notice).not.toContain('detached')
  const expected = putWidget({ ...p.pages[0].scene, root: [], defs: [] },
    { type: m.type, uid: 'ro1', params: sanitize(m, params, THEMES.neutral) }, THEMES.neutral)
  expect(printChecked({ ...expected, root: loaded.project.pages[0].scene.root.slice(0, 1) })).toBe(printChecked(expected))
  expect(loaded.project.pages[0].scene.root[1]).toEqual(raw)
})

it('Neutral text styles omit font and retain bold when applied', () => {
  const t = THEMES.neutral
  expect(t).toBeDefined()
  const attrs = label(t, 'screen-title', { x: 0, y: 0, w: 100, h: 50 }, 'Title').attrs
  expect(attrs).not.toHaveProperty('font')
  expect(attrs.weight).toBe('bold')
  expect(textLook(t, 'screen-title')).toMatchObject({ size: 30, weight: 'bold' })
  expect(namedOf(t).find(s => s.id === 'text.screen-title')!.attrs(t).weight).toBe('bold')
})
