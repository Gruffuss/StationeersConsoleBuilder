import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import * as cssModule from './css'
import { proposeTheme } from './map'
import { autoChoices } from './match'
import { readDesignSystem, dsVariables } from './tokens'
const text = (s: string) => new TextEncoder().encode(s)
const fixture = (path: string) => new Uint8Array(readFileSync(new URL('../../../test/fixtures/design-systems/' + path, import.meta.url)))
const files = () => new Map([
  ['tokens.json', fixture('vanilla-plus/project/tokens.json')],
  ['components/bundle.css', fixture('vanilla-plus/project/components/bundle.css')],
])
const read = (data: unknown) => readDesignSystem(new Map([['tokens.json', text(JSON.stringify(data))]]))

it("the worked example's tokens", () => {
  expect(createHash('sha256').update(files().get('tokens.json')!).digest('hex')).toBe('6df158534a86a552e806da2eeb6fbe037d8070ae0a08ef6ac9fa1b86e5ca7a74')
  expect(createHash('sha256').update(files().get('components/bundle.css')!).digest('hex')).toBe('3cad3fee14f9e1eb92777ee3872d043111cbc9020fdcdbc04d7ff1dffc89c4a5')
  const ds = readDesignSystem(files())
  expect(ds.notes).toEqual([])
  expect(ds.name).toBe('Vanilla +')
  expect(ds.colours).toHaveLength(43)
  for (const name of ['on-brand', 'on-danger']) expect(ds.colours.find(c => c.name === name)!.value.console).toBe('#FFFFFFFF')
  expect(ds.colours.find(c => c.name === 'status-idle')!.value.console).toBe('#A6A6B4FF')
  expect(ds.styles).toHaveLength(12)
  expect(new Set(ds.styles.map(s => s.group))).toEqual(new Set(['Display', 'Body']))
  expect(ds.styles.find(s => s.name === 'screen-title')).toMatchObject({ size: 36, weight: 700, letterSpacing: 1.5, families: ['Barlow Condensed', 'Arial Narrow', 'sans-serif'] })
  expect(ds.styles.find(s => s.name === 'reading')).toMatchObject({ size: 28, weight: 500, families: ['Barlow', 'system-ui', 'sans-serif'] })
  for (const [family, count] of [['spacing', 7], ['radius', 6], ['size', 7]] as const) expect(ds.lengths.filter(l => l.family === family)).toHaveLength(count)
  expect(ds.lengths.find(l => l.name === 'radius-full')!.percent).toBe(50)
  expect(ds.shadows).toHaveLength(6)
  expect(ds.shadows.find(s => s.name === 'well-inset')!.layers.console[0]).toEqual({ inset: true, dx: 0, dy: 2, blur: 6, spread: 0, colour: '#0000008C' })
  expect(ds.shadows.find(s => s.name === 'text-drop')!.layers.console[0]).toMatchObject({ dx: 0, dy: 2, blur: 2, spread: 0, colour: '#00000099' })
  expect(ds.fonts).toHaveLength(5)
  expect(ds.fonts[0]).toEqual({ family: 'Barlow', path: 'fonts/Barlow-Regular.woff2', weight: [400, 400], style: 'normal' })
  const panel = ds.rules.find(r => r.selectors.some(s => s.text === '.ss-panel'))!
  expect(panel.decls.find(d => d.prop === 'background')!.value).toBe('#1D1D23FF')
  expect(dsVariables(ds, 'console')('--font-body')).toBe('"Barlow", system-ui, sans-serif')
})

it("the format's grammar", () => {
  const ds = readDesignSystem(new Map([['tokens.json', fixture('sample/project/tokens.json')], ['components/bundle.css', fixture('sample/project/components/bundle.css')]]))
  expect(ds.colours.find(c => c.name === 'ink')!.value).toEqual({ light: '#112233FF', dark: '#FFFFFFFF' })
  expect(ds.colours.find(c => c.name === 'alias')!.value).toEqual({ light: '#112233FF', dark: '#FFFFFFFF' })
  expect(ds.colours.find(c => c.name === 'inherit')!.value.dark).toBe('#AABBCCFF')
  expect(ds.colours).toHaveLength(14)
  expect(ds.lengths.find(l => l.name === 'gap')!.px).toBe(32)
  expect(ds.notes.join('\n')).toMatch(/rem.*16/)
  const tokens = [
    { name: 'good', value: '#fff' }, ...Array.from({ length: 18 }, (_, i) => ({ name: 'a' + i, value: i === 17 ? '#fff' : '{a' + (i + 1) + '}' })),
    ...['red', 'var(--good)', 'color-mix(in srgb, red, blue)', '{absent}'].map((value, i) => ({ name: 'bad' + i, value })),
    { name: 'self', value: '{self}' }, { name: 'cycle1', value: '{cycle2}' }, { name: 'cycle2', value: '{cycle1}' },
    { name: 'bad name', value: '#fff' }, { name: 'good', value: '#000' }, { name: '__proto__', value: '#fff' },
  ]
  const result = read({ version: 3, color: { themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }], tokens } })
  expect(result.colours.find(c => c.name === 'a0')).toBeUndefined()
  expect(result.colours.find(c => c.name === 'a1')!.value.light).toBe('#FFFFFFFF')
  expect(result.colours.find(c => c.name === 'good')!.value.dark).toBe('#FFFFFFFF')
  for (const name of ['bad0', 'bad1', 'bad2', 'bad3', 'self', 'cycle1', 'cycle2', 'bad name', '__proto__', 'a0']) expect(result.notes.join('\n')).toContain(name)
  expect(result.notes.join('\n')).toMatch(/repeated.*good|good.*repeated/)
})

it('hostile files', () => {
  const ds = read({ version: 3, color: { tokens: [{ name: '__proto__', value: '#fff' }] }, type: { groups: {} }, spacing: { tokens: [{ name: 'huge', value: '1e39px' }] } })
  expect(ds.notes.join('\n')).toMatch(/groups/)
  expect(ds.notes.join('\n')).toMatch(/huge/)
  expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  const deep = readDesignSystem(new Map([['tokens.json', text('{"version":3,"unknown":' + '['.repeat(100000) + '0' + ']'.repeat(100000) + '}')]]))
  expect(deep.notes.join('\n')).toContain('unknown')
  expect(ds.colours).toEqual([])
})

it('legacy token CSS and inert bundle metadata', () => {
  const ds = readDesignSystem(new Map([
    ['tokens/base.css', text(':root { --ink: #123; --alias: var(--ink); --gap: 4px; --shade: 0 2px 2px #000; } [data-theme="night"] { --ink: #fff; }')],
    ['bundle.js', text('/* @ds-bundle: {"format":4,"namespace":"sample","components":[{"name":"Panel"}]} */\nthrow new Error("never runs")')],
    ['components/Panel/README.md', text('Plain text <script>')],
  ]))
  expect(ds.name).toBe('sample')
  expect(ds.themes.map(t => t.id)).toEqual(['default', 'night'])
  expect(ds.colours.find(c => c.name === 'alias')!.value.night).toBe('#FFFFFFFF')
  expect(ds.lengths).toHaveLength(1)
  expect(ds.shadows).toHaveLength(1)
  expect(ds.components).toEqual([{ name: 'Panel', readme: 'Plain text <script>' }])
  expect(ds.notes).toEqual([])
})

it('legacy aliases classify lengths, shadows, fallbacks and font stacks', () => {
  const ds = readDesignSystem(new Map([
    ['tokens/base.css', text(':root { --ink: #123; --gap: 4px; --space: var(--gap); --shadow: 0 1px 2px var(--ink); --shade: var(--shadow); --fallback: var(--absent, #fff); --font-body: "Example", sans-serif; } [data-theme=night] { --ink: #fff; }')],
    ['components/bundle.css', text('.panel { margin: var(--space); font-family: var(--font-body); box-shadow: var(--shade); color: var(--fallback); }')],
  ]))
  expect(ds.notes).toEqual([])
  expect(ds.colours.find(c => c.name === 'fallback')!.value.default).toBe('#FFFFFFFF')
  expect(ds.lengths.find(l => l.name === 'space')!.px).toBe(4)
  expect(ds.shadows.find(s => s.name === 'shade')!.layers.night[0].colour).toBe('#FFFFFFFF')
  expect(ds.rules[0].decls.find(d => d.prop === 'font-family')!.value).toBe('"Example", sans-serif')
})

it('theme selection, literal inheritance, cross-family names and known keys', () => {
  const data = { version: 3, color: { themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }], tokens: [
    { name: 'ink', value: { light: '#123', dark: '#fff', unlisted: '#f00' } },
    { name: 'invalid', value: { light: '#123', dark: null } },
    { name: 'alias', value: '{ink}', extra: 1 },
  ] }, spacing: { tokens: [{ name: 'ink', value: '4px' }] }, type: { families: { body: 'serif, "Example"' }, fonts: [{ family: 'Example', file: '../unsafe', weight: '400' }], groups: [{ name: 'Body', family: 'body', styles: [{ name: 'label', fontSize: 20, fontWeight: '100 900', letterSpacing: '1em', lineHeight: '24px' }] }] } }
  const ds = readDesignSystem(new Map([['tokens.json', text(JSON.stringify(data))], ['components/bundle.css', text('.panel { color: var(--ink); }')]]), 'dark')
  expect(ds.rules[0].decls[0].value).toBe('#FFFFFFFF')
  expect(ds.colours.find(c => c.name === 'invalid')!.value.dark).toBeUndefined()
  expect(ds.notes.join('\n')).toMatch(/unlisted/)
  expect(ds.notes.join('\n')).toMatch(/extra/)
  expect(ds.notes.join('\n')).toMatch(/repeated name ink/)
  expect(ds.fonts).toEqual([])
  expect(ds.styles[0]).toMatchObject({ families: ['Example', 'serif'], weight: 100, letterSpacing: 16, lineHeight: 24 })
  expect(Object.getPrototypeOf(ds.colours[0].value)).toBeNull()
})

it('invalid bundle formats and unsafe component names are noted without reading script bodies', () => {
  const ds = readDesignSystem(new Map([
    ['tokens/base.css', text(':root { --ink: #123; }')],
    ['components/bundle.js', text('/* @ds-bundle: {"format":99,"namespace":"unsafe","components":[{"name":"Panel"}]} */\nfetch("never")')],
    ['components/__proto__/README.md', text('bad')],
  ]))
  expect(ds.components).toEqual([])
  expect(ds.notes.join('\n')).toMatch(/format/)
  expect(ds.notes.join('\n')).toMatch(/__proto__/)
})

it.each(['components/bundle.css', 'tokens/base.css'])('%s reports variable expansion work budgets', path => {
  const declarations = Array.from({ length: 19 }, (_, i) => '--v' + i + ': ' + (i === 18 ? '#fff' : 'var(--v' + (i+1) + ') var(--v' + (i+1) + ')') + ';').join('')
  const source = path.startsWith('components/') ? '.panel {' + declarations + 'color: var(--v0, #000); border-color: #123;}' : ':root {' + declarations + '--ink: #123;}'
  const ds = readDesignSystem(new Map([[path, text(source)]]))
  expect(ds.notes.join('\n'), path).toContain('too large to resolve here')
  expect(ds.notes.join('\n'), path).not.toMatch(/invalid/)
  if (path.startsWith('components/')) {
    expect(ds.rules[0].decls.some(d => d.prop === 'color')).toBe(false)
    expect(ds.rules[0].decls.find(d => d.prop === 'border-color')!.value).toBe('#123')
  } else expect(ds.colours.find(c => c.name === 'ink')!.value.default).toBe('#112233FF')
})

it('reads each file once: variables and every mapping reuse the parses', () => {
  const parse = vi.spyOn(cssModule, 'parseCss'), json = vi.spyOn(JSON, 'parse')
  try {
    const ds = readDesignSystem(files())
    const legacy = readDesignSystem(new Map([['tokens/base.css', text(':root { --ink: #123; }')], ['components/bundle.css', text('.panel { color: var(--ink); }')]]))
    expect(parse).toHaveBeenCalledTimes(3)
    const parsed = json.mock.calls.length
    for (const d of [ds, legacy]) for (const theme of d.themes) expect(dsVariables(d, theme.id)('--nothing')).toBeUndefined()
    expect(json.mock.calls.length).toBe(parsed)
    for (const d of [ds, legacy]) for (let i = 0; i < 3; i++) proposeTheme(d, autoChoices(d), new Set())
    expect(parse).toHaveBeenCalledTimes(3)
    expect(dsVariables(legacy)('--ink')).toBe('#123')
  } finally { parse.mockRestore(); json.mockRestore() }
})
