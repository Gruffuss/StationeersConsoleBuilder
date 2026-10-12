import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { newProject } from '../../model/project'
import { devicesPage } from '../../codegen/devicesPage'
import { problemsOf } from '../../srctext/testing'
import { WIDGETS } from '../../widgets/registry'
import { sanitize } from '../../widgets/core'
import { checked, instance, rules, variants } from '../../widgets/testing'
import { gasColours, ROLES, THEMES } from '../index'
import { themeFileOf } from '../file'
import { readDesignSystem } from './tokens'
import { autoChoices } from './match'
import { proposeTheme } from './map'

const encode = (s: string) => new TextEncoder().encode(s)
const fixture = (path: string) => new Uint8Array(readFileSync(new URL('../../../test/fixtures/design-systems/' + path, import.meta.url)))
const example = () => readDesignSystem(new Map([
  ['tokens.json', fixture('vanilla-plus/project/tokens.json')],
  ['components/bundle.css', fixture('vanilla-plus/project/components/bundle.css')],
]))
const sample = () => readDesignSystem(new Map([
  ['tokens.json', fixture('sample/project/tokens.json')], ['components/bundle.css', fixture('sample/project/components/bundle.css')],
  ['mapping.css', fixture('sample/project/mapping.css')], ['fonts/sample.woff2', new Uint8Array([1])],
]))
const snapshot = (ds: ReturnType<typeof sample>, c: ReturnType<typeof autoChoices>) => JSON.stringify({ c,
  ds: { ...ds, files: [...ds.files].map(([path, bytes]) => [path, Array.from(bytes)]) }, base: THEMES.neutral })

it('the worked example maps authored tokens and CSS with traceable sources', () => {
  const ds = example(), { theme: t, file, report: r } = proposeTheme(ds,autoChoices(ds),new Set(['ds-vanilla']))
  for (const role of ROLES) expect(t.colors[role],role).toBe(ds.colours.find(c => c.name === role)!.value.console)
  expect(t.type.hero).toMatchObject({ font: 'Barlow Condensed Bold', size: 156 }) // hero token and .ss-hero
  expect(t.type['screen-title'].cspace).toBe(Math.fround(1.5 / 36 * 100)) // .ss-screen-title letter-spacing
  expect(t.type['panel-title'].ink).toBe('text-muted') // .ss-panel-title color
  expect(t.parts.panel).toMatchObject({ fill: 'surface-panel', stroke: 'border', width: 1, radius: 10, outline: 'inside', shadow: 'well-inset' })
  const gradient = t.parts.header.fill
  expect(typeof gradient).toBe('object')
  if (typeof gradient === 'object') expect(t.gradients[gradient.gradient]).toEqual(['brand-hi','brand-lo']) // .ss-header background
  expect(t.parts.header).toMatchObject({ stroke: 'accent', width: 3, radius: 14 })
  expect(t.parts.focus).toMatchObject({ fill: 'none', stroke: 'accent', width: 3, outline: 'outside' }) // focus-ring token
  expect(t.parts.chip.fill).toBe('state')
  expect(t.parts.fill.fill).toBe('state')
  expect(t.geo.chip.w).toBe(86) // .ss-chip width
  expect(t.geo.heroUnit).toBe(64) // .ss-hero small font-size
  expect(t.anatomy).toBeUndefined()
  expect(r.sources['colors.text']).toEqual({ token: 'text' })
  expect(r.sources['parts.panel.fill']).toEqual({ rule: '.ss-panel' })
  expect(r.sources['metrics.hero.unitY']).toHaveProperty('derived')
  expect(r.dropped.join('\n')).toContain('badge-label')
  expect(r.cannotDraw.join('\n')).toContain('tabular')
  expect(r.cannotDraw.join('\n')).toMatch(/ss-badge.*unmatched/)
  expect(r.cannotDraw.filter(n => n.startsWith('line-height:'))).toHaveLength(1)
  expect(r.fonts.every(f => f.supplied === 'mod')).toBe(true)
  expect(file).toEqual(themeFileOf(t))
  expect(t.id).toMatch(/^ds-/)
})

it('a synthetic system maps the second theme, decorations and disclosed gradient fallback', () => {
  const ds = sample(), c = autoChoices(ds); c.colourTheme = 'dark'
  const { theme: t, report: r } = proposeTheme(ds,c,new Set())
  expect(t.colors.ink).toBe('#FFFFFFFF')
  expect(t.colors.oklch).toBe('#6FB07DFF')
  expect(t.anatomy?.looks.panel.shape).toEqual({ op: 'rect', radius: [4,8,12,16] })
  const marks = t.anatomy?.looks.panel.add?.filter(a => a.name.includes('mark-'))
  expect(marks).toHaveLength(4)
  expect(marks?.[0]).toMatchObject({ op: 'rect', frame: { l: [0,0], t: [0,0], r: [0,12], b: [0,2] }, fill: 'ink' })
  expect(r.sources['anatomy.looks.panel.add.0.frame.r.1']).toEqual({ rule: '.sample-panel .mark-tl' })
  expect(t.anatomy?.looks.row.add?.[0]).toMatchObject({ name: 'border-left', frame: { l: [0,0], t: [0,0], r: [0,3], b: [1,0] } })
  expect(t.anatomy?.looks['button.primary'].shape).toEqual({ op: 'cut', cut: [8,8,8,8] })
  expect(t.anatomy?.looks.header.shape).toBe('none')
  expect(t.anatomy?.looks.fill.shape).toBeUndefined()
  expect(r.dropped.join('\n')).toMatch(/fill.*shape not allowed/)
  expect(t.anatomy?.looks.chip.add?.[0].op).toBe('poly')
  expect(t.colors[String(t.parts.track.fill)]).toBe('#FF0000FF')
  expect(r.cannotDraw.join('\n')).toMatch(/sample-track.*gradient.*first stop/)
  expect(r.fonts).toContainEqual({ face: 'Sample Sans Bold', supplied: 'file', file: 'fonts/sample.woff2' })
  expect(proposeTheme(ds,c,new Set(),new Set(['Sample Sans Bold'])).report.fonts).toContainEqual({ face: 'Sample Sans Bold', supplied: 'local' })
})

it("the synthetic import obeys every non-native module variant and the Devices page's rules", () => {
  const ds = sample(), t = proposeTheme(ds,autoChoices(ds),new Set()).theme
  expect(t.anatomy?.looks['button.primary'].shape).toHaveProperty('op','cut')
  for (const m of Object.values(WIDGETS).filter(m => !m.native)) for (const over of variants(m.type)) {
    const w = instance(m.type,over)
    w.params = sanitize(m,w.params,t)
    expect(rules(w,t),m.type).toEqual([])
    expect(checked(w,t),m.type).toEqual([])
  }
  expect(problemsOf(devicesPage(newProject(),t).scene)).toEqual([])
})

it('every resulting value has a source and a colour-only import preserves the base', () => {
  const ds = readDesignSystem(new Map([['tokens.json',encode('{"version":3,"color":{"tokens":[{"name":"primary","value":"#123"}]}}')]]))
  const { theme: t, report: r } = proposeTheme(ds,autoChoices(ds),new Set())
  expect(t.type).toEqual(THEMES.neutral.type)
  expect(t.parts).toEqual(THEMES.neutral.parts)
  const stack = [{ value: t as unknown, path: '' }]
  while (stack.length) {
    const { value, path } = stack.pop()!
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) stack.push({ value: child, path: path ? path + '.' + key : key })
    else {
      expect(r.sources[path],path).toBeDefined()
      if (/^(type|parts|metrics)\./.test(path)) expect(r.sources[path],path).toSatisfy(s => 'base' in s || 'derived' in s)
    }
  }
})

it('gas names, player widget defaults and invalid choices pass through the shared sanitizer', () => {
  const ds = readDesignSystem(new Map([['tokens.json',encode('{"version":3,"color":{"tokens":[{"name":"gas.Oxygen","value":"#123"}]}}')]]))
  const c = autoChoices(ds); c.widgetDefaults = { button: { states: [{ label: 'Launch', variant: 'primary', key: 0 }], anatomy: {} } }; c.roles.text = 'missing'
  const { theme: t, report: r } = proposeTheme(ds,c,new Set())
  expect(t.colors['ds.gas.Oxygen']).toBe('#112233FF')
  expect(t.colors['gas.Oxygen']).toBe(gasColours['gas.Oxygen'])
  expect(r.notes.join('\n')).toMatch(/gas.Oxygen.*renamed/)
  expect(r.dropped.join('\n')).toContain('missing')
  expect(t.widgetDefaults?.button).toEqual({ states: [{ label: 'Launch', variant: 'primary', key: 0 }] })
  expect(r.dropped.join('\n')).toContain('anatomy')
  expect(r.sources['widgetDefaults.button.states.0.label']).toEqual({ player: true })
})

it('CSS cascade respects importance, inheritance and literal token identity without fetching', () => {
  const ds = readDesignSystem(new Map([
    ['tokens.json',encode('{"version":3,"color":{"tokens":[{"name":"text","value":"#fff"},{"name":"alias","value":"{text}"}]}}')],
    ['components/bundle.css',encode('body { color: var(--alias); text-transform: uppercase; } .ui-panel { background: #fedcba; border: 1px solid #fff !important; } .ui-panel { border: 9px solid #000; background-image: url(https://example.test/image); filter: blur(2px); transition: all 1s; }')],
  ]))
  const c = autoChoices(ds); c.styleRules.message = '.ui-panel'
  const { theme: t, report: r } = proposeTheme(ds,c,new Set())
  expect(t.parts.panel.width).toBe(1)
  expect(t.parts.panel.fill).toBe('lit-fedcbaff')
  expect(t.type.message.ink).toBe('alias')
  expect(t.type.message.upper).toBe(true)
  expect(r.cannotDraw.join('\n')).toMatch(/background-image/)
  expect(r.cannotDraw.join('\n')).toMatch(/filter/)
  expect(r.cannotDraw.join('\n')).toMatch(/transition/)
})

it('local CSS wins over inherited important values and the floor follows the final mapped size', () => {
  const ds = readDesignSystem(new Map([
    ['tokens.json',encode(JSON.stringify({ version: 3, type: { groups: [{ name: 'Body', family: 'Example', styles: [{ name: 'label', fontSize: 20 }] }] } }))],
    ['components/bundle.css',encode('body { color: #f00 !important; font-size: 12px; } .ui-label { color: #00f; font-size: 8px; } .ui-hero { font-size: 100px; }')],
  ]))
  const c = autoChoices(ds); c.styleRules.unit = '.ui-label'
  const { theme: t } = proposeTheme(ds,c,new Set())
  expect.soft(t.colors[t.type.unit.ink]).toBe('#0000FFFF')
  expect.soft(t.geo.floor).toBe(8)
  expect.soft(t.geo.heroUnit).toBe(48)
})

it('invalid derived values report the actual base source after sanitizing', () => {
  const ds = readDesignSystem(new Map([['tokens.json',encode(JSON.stringify({ version: 3, type: { groups: [{ name: 'Body', family: 'Example', styles: [{ name: 'hero', fontSize: 1, letterSpacing: 1e38 }] }] } }))]]))
  const { theme: t, report: r } = proposeTheme(ds,autoChoices(ds),new Set())
  expect(t.type.hero.cspace).toBe(THEMES.neutral.type.hero.cspace)
  expect(r.sources['type.hero.cspace']).toEqual({ base: 'Neutral' })
  expect(r.dropped.join('\n')).toContain('cspace')
})

it('pseudo-elements do not inherit their parent background or border', () => {
  const ds = readDesignSystem(new Map([['components/bundle.css',encode('.ui-panel { background: red; border: 1px solid blue; } .ui-panel::before { content: ""; left: 0; top: 0; width: 10px; height: 10px; }')]]))
  const { theme: t, report: r } = proposeTheme(ds,autoChoices(ds),new Set())
  expect(t.anatomy?.looks.panel.add).toBeUndefined()
  expect(r.cannotDraw.join('\n')).toMatch(/before.*no represented background/)
})

it('missing font files are disclosed and mapping never mutates its inputs', () => {
  const ds = sample(), c = autoChoices(ds), files = new Map(ds.files); files.delete('fonts/sample.woff2'); ds.files = files
  const before = snapshot(ds,c)
  const result = proposeTheme(ds,c,new Set())
  expect(result.report.fonts).toContainEqual({ face: 'Sample Sans Bold', supplied: 'none' })
  expect(result.report.dropped.some(note => note.includes('unknown face lines'))).toBe(false)
  expect(snapshot(ds,c)).toBe(before)
})
it('the input snapshot detects file-table and file-byte mutations', () => {
  const ds = sample(), c = autoChoices(ds), before = snapshot(ds,c)
  const files = ds.files as Map<string, Uint8Array>
  const bytes = files.get('fonts/sample.woff2')!, byte = bytes[0]
  bytes[0] ^= 1
  expect.soft(snapshot(ds,c)).not.toBe(before)
  bytes[0] = byte
  files.set('new-file', new Uint8Array([2]))
  expect.soft(snapshot(ds,c)).not.toBe(before)
  files.delete('new-file'); files.delete('fonts/sample.woff2')
  expect.soft(snapshot(ds,c)).not.toBe(before)
})

it('literals absent from the design-system palette get custom tokens and source paths stay real', () => {
  const ds = readDesignSystem(new Map([['components/bundle.css',encode('.ui-panel { background: #fff; } .ui-panel::before { content: ""; left: 0; top: 0; width: 10px; height: 10px; background: #fff; }')]]))
  const { theme: t, report: r } = proposeTheme(ds,autoChoices(ds),new Set())
  expect.soft(t.parts.panel.fill).toBe('lit-ffffffff')
  expect.soft(Object.hasOwn(r.sources,'parts.panel-decoration.fill')).toBe(false)
})

it('a constant chip fill is not changed to state paint just because status variants exist', () => {
  const ds = readDesignSystem(new Map([
    ['tokens.json',encode('{"version":3,"color":{"tokens":[{"name":"status-warn","value":"#ff0"},{"name":"status-crit","value":"#f00"}]}}')],
    ['components/bundle.css',encode('.ui-chip { background: #fff; } .ui-chip.warn { background: var(--status-warn); } .ui-chip.crit { background: var(--status-crit); }')],
  ]))
  const t = proposeTheme(ds,autoChoices(ds),new Set()).theme
  expect(t.parts.chip.fill).toBe('lit-ffffffff')
})

it('background-color overrides a flat background in CSS cascade order', () => {
  const ds = readDesignSystem(new Map([['components/bundle.css',encode('.ui-panel { background: red; background-color: blue; }')]]))
  const t = proposeTheme(ds,autoChoices(ds),new Set()).theme
  expect(t.colors[String(t.parts.panel.fill)]).toBe('#0000FFFF')
})
it('role remaps preserve palette token values, sources and CSS references without order dependence', () => {
  const ds = readDesignSystem(new Map([
    ['tokens.json', encode('{"version":3,"color":{"tokens":[{"name":"text","value":"#f00"},{"name":"brand","value":"#00f"},{"name":"ds.text","value":"#0f0"}]}}')],
    ['components/bundle.css', encode('.ui-panel {background: var(--text)} .ui-unit {color: var(--brand)}')],
  ]))
  const c = autoChoices(ds); c.roles.text = 'brand'; c.roles.brand = 'text'
  const { theme: t, report: r } = proposeTheme(ds, c, new Set())
  expect.soft(t.colors.text).toBe('#0000FFFF')
  expect.soft(t.colors.brand).toBe('#FF0000FF')
  expect.soft(t.colors['ds.text']).toBe('#00FF00FF')
  expect.soft(t.colors['ds.text-2']).toBe('#FF0000FF')
  expect.soft(t.colors['ds.brand']).toBe('#0000FFFF')
  expect.soft(t.parts.panel.fill).toBe('ds.text-2')
  expect.soft(t.type.unit.ink).toBe('ds.brand')
  expect.soft(r.sources['colors.ds.text-2']).toEqual({ token: 'text' })
  expect.soft(r.sources['colors.ds.brand']).toEqual({ token: 'brand' })
  expect.soft(r.notes.join('\n')).toMatch(/text.*renamed.*ds.text-2/)
  c.roles.text = null
  expect.soft(proposeTheme(ds, c, new Set()).theme.colors.text).toBe(THEMES.neutral.colors.text)
})
it('colourless borders retain the base paint and disclose implicit currentcolor', () => {
  const ds = readDesignSystem(new Map([['components/bundle.css', encode('.ui-panel {border: 1px solid; outline: 2px solid}')]]))
  const { theme: t, report: r } = proposeTheme(ds, autoChoices(ds), new Set())
  expect.soft(t.parts.panel).toEqual(THEMES.neutral.parts.panel)
  expect.soft(r.cannotDraw).toContain('.ui-panel border: implicit currentcolor is not represented; keeping the base paint')
  expect.soft(r.cannotDraw).toContain('.ui-panel outline: implicit currentcolor is not represented; keeping the base paint')
})
it.each(['border-color', 'border-width', 'border-style', 'outline-color', 'outline-width', 'outline-style', 'border-left-color', 'border-top-width'])('unrepresented %s is named in full', prop => {
  const value = prop.endsWith('color') ? 'red' : prop.endsWith('width') ? '2px' : 'solid'
  const ds = readDesignSystem(new Map([['components/bundle.css', encode(`.ui-panel {${prop}: ${value}}`)]]))
  const { report: r } = proposeTheme(ds, autoChoices(ds), new Set())
  expect(r.cannotDraw).toContain('.ui-panel ' + prop + ': not represented; keeping the shorthand or base paint')
})
it('maps a stylesheet with more rules than a call takes arguments', () => {
  const ds = readDesignSystem(new Map([['components/bundle.css', encode('.r { color: red; }\n'.repeat(300000))]]))
  expect(ds.rules).toHaveLength(300000)
  expect(proposeTheme(ds, autoChoices(ds), new Set()).theme).toBeDefined()
}, 120_000)
