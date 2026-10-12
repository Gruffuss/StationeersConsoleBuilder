import { expect, it } from 'vitest'
import { colour, gasColours, ROLES, STYLES, THEMES } from './index'
import { bracket } from '../widgets/testing'
import { exportProblems } from '../codegen/exportProblems'
import { newProject } from '../model/project'

const api = () => import('./file')
const file = (theme: unknown) => ({ format: 'vectorbuilder-theme', v: 1, theme })
const read = async (theme: unknown, base = THEMES.neutral) => (await api()).sanitizeTheme(file(theme), base, { taken: new Set() })

it('provided themes round trip', async () => {
  const { sanitizeTheme, themeFileOf, importedId } = await api()
  for (const t of Object.values(THEMES)) {
    const result = sanitizeTheme(JSON.parse(JSON.stringify(themeFileOf(t))), THEMES.neutral, { taken: new Set() })
    expect(result).toEqual({ theme: { ...t, id: importedId(t.name, new Set()) }, notes: [] })
    expect(Object.keys(themeFileOf(t).theme.colors!).some(k => Object.hasOwn(gasColours, k))).toBe(false)
    expect(Object.getPrototypeOf(result.theme!.colors)).toBe(null)
  }
})

it('fills from the base, by name', async () => {
  const { theme, notes } = await read({ name: 'Small', colors: { text: '#010203', accent: '#abcdef', brand: '#10203040' } })
  expect(theme!.colors.accent).toBe('#ABCDEF')
  for (const k of ROLES.filter(k => !['text', 'accent', 'brand'].includes(k))) expect(notes.some(n => n.startsWith('theme.colors.' + k + ':'))).toBe(true)
  for (const k of STYLES) expect(notes.some(n => n.startsWith('theme.type.' + k + ':'))).toBe(true)
  for (const section of ['parts', 'metrics'] as const) for (const k of Object.keys(THEMES.neutral[section])) {
    expect(notes.some(n => n.startsWith(`theme.${section}.${k}:`))).toBe(true)
  }
  expect(notes.some(n => n.startsWith('theme.geo.space.1:'))).toBe(true)
  expect(theme!.parts).toEqual(THEMES.neutral.parts)
  expect(theme!.geo).toEqual(THEMES.neutral.geo)
  expect(theme!.metrics).toEqual(THEMES.neutral.metrics)
  // Task 2 adds project themes; register temporarily to exercise the existing export reader now.
  THEMES[theme!.id] = theme!
  try { expect(exportProblems({ ...newProject(), theme: theme!.id }).filter(p => p.message.includes('missing colour'))).toEqual([]) }
  finally { delete THEMES[theme!.id] }
})

it('game gas colours stay', async () => {
  const { themeFileOf } = await api()
  const source = themeFileOf(THEMES.neutral)
  source.theme.colors!['gas.Oxygen'] = '#010203'
  const { theme, notes } = await read(source.theme)
  expect(colour(theme!, 'gas.Oxygen')).toBe(gasColours['gas.Oxygen'])
  expect(notes).toEqual([expect.stringContaining('theme.colors.gas.Oxygen:')])
})

it('split halves and symbol inks keep their shared identities through a theme file', async () => {
  const { themeFileOf } = await api()
  const names = ['gas.Hydrogen.2', 'gas.Oxygen.ink', 'gas.Hydrogen.ink', 'gas.LiquidHydrogen.2']
  for (const name of names) expect(gasColours[name], name).toMatch(/^#[0-9A-F]{6}$/)
  expect(gasColours['gas.Hydrogen.2']).toBe('#8F8F8F')
  // A file never carries them, and one that does is not believed: the game's colours stand, each named in a note.
  for (const t of Object.values(THEMES)) for (const name of names) expect(Object.hasOwn(themeFileOf(t).theme.colors!, name)).toBe(false)
  const source = themeFileOf(THEMES['vanilla-plus'])
  for (const name of names) source.theme.colors![name] = '#010203'
  const { theme, notes } = await read(source.theme)
  for (const name of names) {
    expect(theme!.colors[name], name).toBe(gasColours[name])
    expect(colour(theme!, name)).toBe(gasColours[name])
  }
  expect(notes).toEqual(names.map(name => `theme.colors.${name}: shared gas colour dropped`))
})

it('hostile input', async () => {
  const { themeFileOf } = await api()
  const raw = JSON.parse(JSON.stringify(themeFileOf(THEMES.neutral)))
  const stack = [raw]
  while (stack.length) {
    const item = stack.pop()!
    if (!Array.isArray(item)) {
      Object.defineProperty(item, '__proto__', { value: { x: 1 }, enumerable: true })
      item.constructor = { x: 2 }
    }
    for (const [k, v] of Object.entries(item)) if (!['__proto__', 'constructor'].includes(k) && typeof v === 'object' && v) stack.push(v)
  }
  raw.theme.type.hero.size = 1e39
  raw.theme.type.hero.cspace = 'NaN'
  raw.theme.geo.space = []
  raw.theme.gradients.bad = { 0: 'text', 1: 'accent' }
  raw.theme.shadows.bad = [[0, 0, -1, 0, 'text']]
  raw.theme.parts.panel.fill = { gradient: 'missing', constructor: 1 }
  const { theme, notes } = (await api()).sanitizeTheme(raw, THEMES.neutral, { taken: new Set() })
  expect(({} as { x?: number }).x).toBeUndefined()
  expect(theme!.type.hero.size).toBe(120)
  expect(theme!.type.hero.cspace).toBe(0)
  for (const path of ['__proto__', 'constructor', 'theme.__proto__', 'theme.colors.constructor', 'theme.type.hero.size',
    'theme.type.hero.cspace', 'theme.geo.space', 'theme.gradients.bad', 'theme.shadows.bad.0', 'theme.parts.panel.fill.constructor']) {
    expect(notes.some(n => n.startsWith(path + ':')), path).toBe(true)
  }
  expect(Object.getPrototypeOf(theme)).toBe(null)
})

it('ids', async () => {
  const { sanitizeTheme, importedId } = await api()
  for (const id of ['neutral', 'vanilla-plus']) expect(sanitizeTheme(file({ name: 'X' }), THEMES.neutral, { id, taken: new Set() }).theme!.id).toBe('ds-x')
  expect(importedId('X', new Set(['ds-x']))).toBe('ds-x-2')
  expect(importedId('+', new Set())).toMatch(/^ds-[a-z0-9-]{1,64}$/)
  expect(importedId('x'.repeat(100), new Set(['ds-' + 'x'.repeat(64)]))).toMatch(/^ds-[a-z0-9-]{1,64}$/)
})

it('widget defaults', async () => {
  const { theme, notes } = await read({ name: 'Defaults', widgetDefaults: { button: {
    states: [{ label: 'Go', variant: 'primary', key: 0 }], x: 5, nope: 1, h: -10,
  }, constructor: {} } })
  expect(theme!.widgetDefaults).toEqual({ button: { states: [{ label: 'Go', variant: 'primary', key: 0 }] } })
  for (const path of ['button.x', 'button.nope', 'button.h', 'constructor']) expect(notes.some(n => n.startsWith('theme.widgetDefaults.' + path + ':'))).toBe(true)
})

it('anatomy is the anatomy sanitizer\'s', async () => {
  const { themeFileOf } = await api()
  expect((await read(themeFileOf(bracket).theme)).theme!.anatomy).toEqual(bracket.anatomy)
  const { notes } = await read({ name: 'Anatomy', anatomy: { v: 1, looks: { unknown: { shape: 'none' } } } })
  expect(notes).toContain('theme.anatomy.looks.unknown: unknown hook')
})

it('rejects foreign formats and inherited headers', async () => {
  const { sanitizeTheme } = await api()
  for (const v of [null, [], {}, { format: 'other', v: 1, theme: {} }, { format: 'vectorbuilder-theme', v: 2, theme: {} },
    Object.create(file({ name: 'Inherited' })), file([])]) {
    const result = sanitizeTheme(v, THEMES.neutral, { taken: new Set() })
    expect(result.theme).toBeUndefined()
    expect(result.notes).toHaveLength(1)
  }
})

it('derives missing metrics from imported type and notes unknown faces', async () => {
  const { theme, notes } = await read({ name: 'Type', type: { hero: { ...THEMES.neutral.type.hero, font: 'A custom face', size: 200 } } })
  expect(theme!.metrics['hero.figureH']).toBe(240)
  expect(notes.some(n => n.startsWith('theme.type.hero.font:') && n.includes('Liberation Sans'))).toBe(true)
})

it('keeps every number and reference usable after partial invalid input', async () => {
  const { theme, notes } = await read({ name: 'Partial', type: { hero: { size: 3e38 } }, geo: { heroUnit: 3e38 },
    parts: { panel: { stroke: 'missing', width: -1 } }, metrics: { 'hero.barY': 1e39 },
    stateWords: ['OK', 'bad\nword', 'CRIT'], pressed: 2, drawText: 'missing' }, THEMES['vanilla-plus'])
  for (const value of Object.values(theme!.metrics)) expect(Number.isFinite(Math.fround(value))).toBe(true)
  expect(notes.some(n => n.startsWith('theme.parts.panel.stroke:'))).toBe(true)
  expect(theme!.stateWords).toEqual(['OK', 'WARN', 'CRIT'])
  for (const s of Object.values(theme!.type)) if (s.shadow) expect(Object.hasOwn(theme!.shadows, s.shadow)).toBe(true)
  expect(theme!.parts.panel.stroke).toBeUndefined()
})

it('refuses prototype keys inside widget default renames', async () => {
  const defaults = JSON.parse('{"button":{"keys":{"__proto__":"a","constructor":"b","valid":"ok"}}}')
  const { theme, notes } = await read({ name: 'Renames', widgetDefaults: defaults })
  expect(theme!.widgetDefaults!.button).toEqual({})
  expect(notes.some(n => n.startsWith('theme.widgetDefaults.button.keys.__proto__:'))).toBe(true)
  expect(notes.some(n => n.startsWith('theme.widgetDefaults.button.keys.constructor:'))).toBe(true)
})

it('refuses sparse and inherited array values', async () => {
  const gradient = Array(2), shadow = [0, 0, 2, 0, 'text'], words = Array(3)
  delete shadow[0]
  Object.setPrototypeOf(words, Object.assign(Object.create(Array.prototype), { 0: 'OK', 1: 'WARN', 2: 'CRIT' }))
  const { theme, notes } = await read({ name: 'Arrays', gradients: { sparse: gradient }, shadows: { sparse: [shadow] }, stateWords: words })
  expect(Object.hasOwn(theme!.gradients, 'sparse')).toBe(false)
  expect(theme!.shadows.sparse).toEqual([])
  for (const path of ['theme.gradients.sparse:', 'theme.shadows.sparse.0:', 'theme.stateWords:']) expect(notes.some(n => n.startsWith(path))).toBe(true)
})

it('accepts effect names outside the colour-token grammar', async () => {
  const { theme } = await read({ name: 'Effects', gradients: { 'soft glow': ['text', 'accent'] }, shadows: { '深い影': [[0, 1, 2, 0, 'text']] },
    parts: { panel: { fill: { gradient: 'soft glow' }, shadow: '深い影' } } })
  expect(theme!.parts.panel).toEqual({ fill: { gradient: 'soft glow' }, shadow: '深い影' })
})

it('reports every anatomy rejection without a spread argument limit', async () => {
  const looks = Object.fromEntries(Array.from({ length: 150000 }, (_, i) => ['unknown' + i, {}]))
  const { notes } = await read({ name: 'Many notes', anatomy: { v: 1, looks } })
  expect(notes.filter(n => n.startsWith('theme.anatomy.looks.unknown'))).toHaveLength(150000)
})

it('keeps non-newline whitespace in state words', async () => {
  const { themeFileOf } = await api(), source = themeFileOf(THEMES.neutral)
  source.theme.stateWords = ['OK\tready', 'WARN', 'CRIT']
  const { theme, notes } = await read(source.theme)
  expect(theme!.stateWords).toEqual(['OK\tready', 'WARN', 'CRIT'])
  expect(notes).toEqual([])
})

it.each(['\u0000', '\u001b[31m', '\u007f', '\u0085', '\r', ' '])('refuses state words holding control character %j', async c => {
  const { themeFileOf } = await api(), source = themeFileOf(THEMES.neutral)
  source.theme.stateWords = ['OK', 'WA' + c + 'RN', 'CRIT']
  const { theme, notes } = await read(source.theme, THEMES['vanilla-plus'])
  expect(theme!.stateWords).toEqual(THEMES['vanilla-plus'].stateWords)
  expect(notes).toEqual(['theme.stateWords: expected three strings without line breaks or control characters other than tab; filled from Vanilla +'])
})
