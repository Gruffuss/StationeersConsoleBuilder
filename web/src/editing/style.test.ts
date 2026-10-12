import { describe, expect, it } from 'vitest'
import { node } from '../model/testing'
import { invalid, type Checked } from '../srctext/check'
import { COMMANDS, commandsOf } from './registry'
import { colour, type Theme } from '../theme'
import { neutral as slate } from '../theme/neutral'
import { vanillaPlus } from '../theme/vanillaPlus'
import { putWidget } from '../widgets/core'
import { gradientDef, shadow } from '../widgets/paint'
import { instance } from '../widgets/testing'
import { applyStyle, fits, isStyle, namedOf, applyNamed, pasteStyle, styleOf, textLook } from './style'
import { harness } from './testing'
import { neutral } from '../theme/testing'
import { linksOf } from '../theme/links'
import { imported } from '../theme/testing'

it('the named-command catalogue follows the current imported theme', async () => {
  const { commandsOf } = await import('./registry')
  const h = harness({ header: {}, defs: [], root: [node('R')] }, { sel: { pageId: 'p1', path: [0] } })
  h.ctx.theme = () => imported
  expect(commandsOf(h.ctx).filter(c => c.id.startsWith('style.') && c.order! >= 10).map(c => c.id))
    .toEqual(namedOf(imported).map(s => 'style.' + s.id))
  const meter = commandsOf(h.ctx).find(c => c.id === 'style.meter')!
  expect(meter).toBeDefined()
  await meter.run(h.ctx)
  expect(h.root()[0].attrs.f).toBe(imported.colors.accent)
  h.ctx.theme = () => slate
  expect(commandsOf(h.ctx).some(c => c.id === 'style.glow.ok')).toBe(false)
})

it('named style reports when the selection has no fitting scene members', async () => {
  const h = harness({ header: {}, defs: [], root: [] }, { sel: { pageId: 'p1', path: [], native: 'ti1' } })
  await commandsOf(h.ctx).find(c => c.id === 'style.row')!.run(h.ctx)
  expect(h.notes.join('; ')).toContain('no selected shapes fit')
  expect(h.state().past).toHaveLength(0)
})

it('a stale named command reports a style missing from the new theme', async () => {
  const h = harness({ header: {}, defs: [], root: [node('R')] }, { sel: { pageId: 'p1', path: [0] } })
  const glow = commandsOf(h.ctx).find(c => c.id === 'style.glow.ok')!
  h.ctx.theme = () => slate
  await glow.run(h.ctx)
  expect(h.notes.join('; ')).toContain('not available in the current theme')
  expect(h.state().past).toHaveLength(0)
})

it('Use as default skips bound style fields, reports them, and does not change the source', async () => {
  const source = node('R', { f: '$colour', s: '=if(eq($k,1),#ffffff,#000000)', sw: 3 })
  const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [source] }, { sel: { pageId: 'p1', path: [0] } })
  await COMMANDS.find(c => c.id === 'style.useAsDefault')!.run(h.ctx)
  expect(h.ctx.drawDefaults().R.attrs).toEqual({ sw: 3 })
  expect(h.notes.join('; ')).toContain('2 style fields with expressions or data skipped')
  expect(h.root()[0]).toBe(source); expect(h.state().past).toHaveLength(0)
})

it('named styles come from the theme at run time, with links; empty glows are not offered', async () => {
  const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { f: '$colour' })] }, { sel: { pageId: 'p1', path: [0] } })
  h.ctx.theme = () => neutral
  const row = commandsOf(h.ctx).find(c => c.id === 'style.row')!
  expect(row).toBeDefined()
  await row.run(h.ctx)
  expect(h.root()[0].attrs).toEqual({ f: neutral.colors['surface-row'], s: neutral.colors.border, sw: 1, rx: 0 })
  expect(linksOf(h.root()[0])).toMatchObject({ f: { part: 'row', field: 'fill' }, s: { part: 'row', field: 'stroke' } })
  expect(h.notes.join(' ')).toContain('1 expression or data value replaced')
  expect(commandsOf(h.ctx).find(c => c.id === 'style.glow.ok')).toBeUndefined()
})

describe('style keys', () => {
  it('are fill, stroke, text and effects keys, less content and structure; a box\'s corners, not a circle\'s size', () => {
    expect(['f', 's', 'sw', 'dash', 'size', 'font', 'sh', 'o', 'rx'].map(k => isStyle('R', k))).toEqual([true, true, true, true, false, false, true, false, true])
    expect(['text', 'v', 'id', 'x', 'size', 'font'].map(k => isStyle('T', k))).toEqual([false, false, false, false, true, true])
    expect(isStyle('C', 'rx')).toBe(false)
    expect(isStyle('G', 's')).toBe(false)
    expect(isStyle('G', 's_')).toBe(true)
    expect(styleOf(node('R', { x: 5, f: '#f00', s: '#0f0', sw: 3, rx: 4 }))).toEqual({ f: '#f00', s: '#0f0', sw: 3, rx: 4 })
  })
  it('pastes what both ops read, removes what the source lacks, counts replaced expressions; a shape\'s s is a group\'s s_', () => {
    const src = { op: 'R', attrs: { f: '#f00', s: '#0f0', sw: 3, rx: 4 } }
    const c = pasteStyle(node('C', { cx: 1, cy: 1, rx: 2, f: '=if(t,#fff,#000)', sh: [[0, 2, 2, 0, '#000']] }), src)
    expect(c.node.attrs).toEqual({ cx: 1, cy: 1, rx: 2, f: '#f00', s: '#0f0', sw: 3 })
    expect(c.overwrote).toBe(1)
    expect(pasteStyle(node('G', { s: [2, 2] }), src).node.attrs).toEqual({ s: [2, 2], f: '#f00', s_: '#0f0', sw: 3 })
    expect(pasteStyle(node('T', { text: 'a', size: 30 }), src).node.attrs).toEqual({ text: 'a', size: 30, f: '#f00' })
  })
  it('crosses no key between two catalogue groups: a shape\'s sat (stroke) is not a group\'s sat (saturation)', () => {
    expect(pasteStyle(node('G', { sat: 0.5 }), { op: 'R', attrs: { s: '#fff', sat: 1 } }).node.attrs).toEqual({ sat: 0.5, s_: '#fff' })
    expect(pasteStyle(node('R', { sat: 1 }), { op: 'G', attrs: { sat: 0.5 } }).node.attrs).toEqual({ sat: 1 })
  })
  it('leaves out content and structure: a T\'s fmt, unit and missing, a G\'s clip, mask, id and v', () => {
    expect(['fmt', 'unit', 'missing'].map(k => isStyle('T', k))).toEqual([false, false, false])
    expect(['clip', 'mask', 'id', 'v', 'o', 'blur'].map(k => isStyle('G', k))).toEqual([false, false, false, false, true, true])
    expect(isStyle('USE', 'clip')).toBe(false)
  })
  it('takes a box\'s corner radius on R, SC and IMG alike', () => {
    expect([isStyle('SC', 'rx'), isStyle('SC', 'ry'), isStyle('IMG', 'rx'), isStyle('IMG', 'ry')]).toEqual([true, true, true, true])
    expect(styleOf(node('SC', { x: 0, y: 0, w: 9, h: 9, rx: 2, o: 0.5 }))).toEqual({ rx: 2, o: 0.5 })
    expect(pasteStyle(node('IMG', { x: 0, rx: 1, ry: 1 }), { op: 'R', attrs: { rx: 4, f: '#f00' } }).node.attrs).toEqual({ x: 0, rx: 4 })
  })
  it('turns a group\'s s_ into a shape\'s s, and back', () => {
    expect(pasteStyle(node('R', { x: 0 }), { op: 'G', attrs: { s_: '#fff' } }).node.attrs).toEqual({ x: 0, s: '#fff' })
    expect(pasteStyle(node('C', { cx: 1, s: '#000', sw: 1 }), { op: 'G', attrs: { s_: '#fff', f: '#f00' } }).node.attrs)
      .toEqual({ cx: 1, s: '#fff', f: '#f00' })
  })
  it('takes from the source only what is style on its op: a G\'s s is its scale, not a stroke', () => {
    expect(pasteStyle(node('R', { x: 0, s: '#fff' }), { op: 'G', attrs: { s: [2, 2] } }).node.attrs).toEqual({ x: 0 })
  })
  it('counts every expression and $data value it replaces, in lists too, as the mod reads each key', () => {
    const c = pasteStyle(node('C', { f: '$fill', s: '@g', sw: '=w', dash: ['$a', 2], sh: [['=t', 2, 2, 0, '#000']] }), { op: 'R', attrs: {} })
    expect(c.node.attrs).toEqual({})
    expect(c.overwrote).toBe(4)   // f's $fill, sw's =w, dash's $a, sh's =t; a gradient @g is none
    expect(pasteStyle(node('G', { blur: 't*2' }), { op: 'G', attrs: { blur: 2 } }).overwrote).toBe(1)   // a bare string in E is one
    expect(pasteStyle(node('R', { f: '=x', dash: ['$a', 2] }), { op: 'R', attrs: { f: '=x', dash: ['$a', 2] } }).overwrote).toBe(0)
  })
})

describe('copy and paste style', () => {
  it('copies the primary\'s style and pastes it on every member in one checked step', async () => {
    const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { f: '#f00', sw: 2, s: '#fff' }), node('C', { cx: 1, cy: 1, rx: 1 }),
      node('Y', { p: [0, 0, 1, 0, 0, 1] })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await COMMANDS.find(c => c.id === 'style.copy')!.run(h.ctx)
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [2] }, also: [{ pageId: 'p1', path: [1] }] })
    await COMMANDS.find(c => c.id === 'style.paste')!.run(h.ctx)
    expect(h.root()[1].attrs).toEqual({ cx: 1, cy: 1, rx: 1, f: '#f00', sw: 2, s: '#fff' })
    expect(h.root()[2].attrs).toMatchObject({ f: '#f00', s: '#fff', sw: 2 })
    expect(h.state().past).toHaveLength(1)
  })
  it('says what it copied, and leaves no step when the style is already there', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0, f: '#f00' }), node('C', { cx: 1, f: '#f00' })] },
      { sel: { pageId: 'p1', path: [0] } })
    await COMMANDS.find(c => c.id === 'style.copy')!.run(h.ctx)
    expect(h.notes.at(-1)).toBe('style copied: f')
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [] })
    await COMMANDS.find(c => c.id === 'style.paste')!.run(h.ctx)
    expect(h.notes.at(-1)).toBe('the style is already there')
    expect(h.state().past).toHaveLength(0)
  })
  const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
  // An R with a fill, and a C bound to data and an expression; the R's style copied and the C selected.
  const copied = async (verdict: () => Checked) => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { f: '#f00' }), node('C', { cx: 1, f: '$fill', s: '=c', sw: 2 })] },
      { sel: { pageId: 'p1', path: [0] }, verdict })
    await COMMANDS.find(c => c.id === 'style.copy')!.run(h.ctx)
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [] })
    return { h, paste: () => COMMANDS.find(c => c.id === 'style.paste')!.run(h.ctx) }
  }
  it('says how many expression or data values the paste replaced', async () => {
    const { h, paste } = await copied(ok)
    await paste()
    expect(h.root()[1].attrs).toEqual({ cx: 1, f: '#f00' })
    expect(h.notes).toContain('2 expression or data values replaced')
  })
  it('lands nothing when the check refuses the pasted scene, and says why', async () => {
    const { h, paste } = await copied(() => invalid('the check refused it'))
    await paste()
    expect(h.root()[1].attrs).toEqual({ cx: 1, f: '$fill', s: '=c', sw: 2 })
    expect(h.state().past).toHaveLength(0)
    expect(h.status()).toBe('the check refused it')
  })
  it('lands nothing when the scene changed while the paste was checked', async () => {
    const { h, paste } = await copied(ok)
    const p = paste()
    h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: { ...h.scene(), root: [...h.root(), node('R', {})] } })
    await p
    expect(h.root()[1].attrs).toEqual({ cx: 1, f: '$fill', s: '=c', sw: 2 })
    expect(h.state().past).toHaveLength(1)
    expect(h.status()).toBe('the scene changed while this was checked; not applied')
  })
})

describe('named styles', () => {
  it.each([vanillaPlus, slate])('reads $id brand, danger, well, statuses and glows from the provided theme', theme => {
    const styles = namedOf(theme), attrs = (id: string) => styles.find(s => s.id === id)?.attrs(theme)
    const vanilla = theme === vanillaPlus
    expect(attrs('button.primary')).toEqual(vanilla
      ? { f: '@theme_brand', s: '#FF772D', sw: 2, rx: 6, sh: undefined }
      : { f: '#2A64BD', s: undefined, sw: undefined, rx: 4, sh: undefined })
    expect(attrs('button.danger')).toEqual({ f: vanilla ? '@theme_danger' : '#C62828', s: undefined, sw: undefined, rx: vanilla ? 6 : 4, sh: undefined })
    expect(attrs('track')).toEqual(vanilla
      ? { f: '#111116', s: '#5A5A69', sw: 1, rx: 4, sh: undefined }
      : { f: '#121212', s: undefined, sw: undefined, rx: 3, sh: undefined })
    const colours = vanilla ? ['#7FD970', '#F2B233', '#F7777A', '#A6A6B4'] : ['#4CC38A', '#F0B429', '#EF5350', '#9A9A9A']
    for (const [i, status] of ['ok', 'warn', 'crit', 'idle'].entries()) {
      expect(attrs(`status.${status}`)).toEqual({ f: colours[i] })
      if (i < 3) expect(attrs(`glow.${status}`)).toEqual(vanilla ? { sh: [[0, 0, 10, 0, colours[i]]] } : undefined)
    }
  })
  const t = vanillaPlus
  const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
  const named = (id: string) => namedOf(t).find(s => s.id === id)!.attrs(t)
  const run = (id: string, h: ReturnType<typeof harness>) => commandsOf(h.ctx).find(c => c.id === `style.${id}`)!.run(h.ctx)
  it('reads a text style as label() writes it, without the box', () => {
    expect(textLook(t, 'message')).toEqual({ size: 26, font: 'Barlow Medium', f: '#FFFFFF', sh: [[0, 2, 2, 0, '#00000099']] })
    expect(textLook(t, 'screen-title')).toMatchObject({ size: 36, font: 'Barlow Condensed Bold', cspace: 4.17, f: '#FFFFFF' })
  })
  it('applies only what the target reads as style; a group takes s as s_', () => {
    const raised = named('row')
    expect(applyStyle(node('R', { x: 1 }), raised).node.attrs).toEqual({ x: 1, f: '@theme_row', s: '#5A5A69', sw: 1, rx: 6 })
    expect(applyStyle(node('G'), raised).node.attrs).toEqual({ f: '@theme_row', s_: '#5A5A69', sw: 1 })
    expect(namedOf(t).filter(s => s.fits === 'text')).toHaveLength(11)
  })
  it('a text style is the whole text look: the spacing or drop an earlier style left goes', () => {
    const hero = applyStyle(applyStyle(node('T', { text: 'a' }), named('text.screen-title')).node, named('text.hero')).node
    expect(hero.attrs).toEqual({ text: 'a', size: 156, font: 'Barlow Condensed Bold', f: '#FFFFFF', sh: [[0, 2, 2, 0, '#00000099']] })
    expect(applyStyle(hero, named('text.chip-label')).node.attrs).toEqual({ text: 'a', size: 24, font: 'Barlow Condensed Bold', f: '#17171B', cspace: Math.fround(2.08) })
  })
  it('a named style is one checked step, adds the theme gradient def it paints with, and skips what it does not fit', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0, y: 0, w: 9, h: 9 }), node('T', { text: 'a' })] },
      { sel: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }], verdict: ok })
    await commandsOf(h.ctx).find(c => c.id === 'style.row')!.run(h.ctx)
    expect(h.root()[0].attrs.f).toBe('@theme_row')
    expect(h.scene().defs.map(d => d.attrs.id)).toEqual(['theme_row'])
    expect(h.notes).toContain('1 skipped: this style does not fit it')
    expect(h.state().past).toHaveLength(1)
  })
  it('skips a widget root (its look is its params) and leaves no step when the style is already there', async () => {
    const lit = putWidget({ header: { w: 480, h: 480 }, defs: [], root: [] }, instance('light'), t)
    const w = harness(lit, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('status.ok', w)
    expect([w.notes, w.root(), w.state().past]).toEqual([['1 skipped: a widget\'s look is its params'], lit.root, []])
    const use = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('USE', { ref: 'a' }), node('IMG', { x: 0 })] },
      { sel: { pageId: 'p1', path: [0] }, also: [{ pageId: 'p1', path: [1] }], verdict: ok })
    await run('status.ok', use)   // neither reads f
    expect([use.notes, use.state().past]).toEqual([['2 skipped: this style does not fit them'], []])
    const r = harness({ header: { w: 480, h: 480 }, defs: [], root: [applyNamed(node('R', { x: 0 }), namedOf(t).find(s => s.id === 'panel')!, t).node] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('panel', r)
    expect([r.notes.at(-1), r.state().past]).toEqual(['the style is already there', []])
  })
  it('never rewrites a theme_ gradient def the page has: a hand edit survives; a clip by that id is not one (ruling)', async () => {
    const clip = node('CP', { id: 'theme_row' }, [node('R', { w: 9, h: 9 })]), old = node('GL', { id: 'theme_row', stops: [[0, '#010203'], [1, '#040506']] })
    const h = harness({ header: { w: 480, h: 480 }, defs: [clip, old], root: [node('R', { x: 0 })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('row', h)
    expect([h.root()[0].attrs.f, h.scene().defs]).toEqual(['@theme_row', [clip, old]])   // a theme switch, a load or a widget edit writes it again
    const c = harness({ header: { w: 480, h: 480 }, defs: [clip], root: [node('R', { x: 0 })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('row', c)
    expect(c.scene().defs).toEqual([clip, gradientDef(t, 'row')])
  })
  it('adds the theme gradient def where the style is already there and the def is not', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0, ...named('row') })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('row', h)
    expect([h.scene().defs, h.state().past.length, h.notes]).toEqual([[gradientDef(t, 'row')], 1, []])
    await run('row', h)   // now it is all there
    expect([h.state().past.length, h.notes]).toEqual([1, ['the style is already there']])
  })
  it('says how many expression or data values it replaced or removed, as paste style does', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('T', { text: 'a', size: '=t*2', f: '$col', sh: [['=t', 2, 2, 0, '#000']] }),
      node('R', { f: '=if(eq($k,1),#FF0000,#00FF00)', sw: '=$w' })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    await run('text.chip-label', h)   // chip-label has no drop: the shadow with its =t goes
    expect([h.root()[0].attrs, h.notes]).toEqual([{ text: 'a', size: 24, f: '#17171B', font: 'Barlow Condensed Bold', cspace: Math.fround(2.08) },
      ['3 expression or data values replaced']])
    h.ctx.dispatch({ type: 'select', selection: { pageId: 'p1', path: [1] }, also: [] })
    await run('line', h)
    expect(h.notes.at(-1)).toBe('2 expression or data values replaced')
    expect(applyStyle(node('R', { f: '$a' }), named('status.ok')).overwrote).toBe(1)
  })
  it('lands nothing when the check refuses the styled scene, and says why', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0 })] },
      { sel: { pageId: 'p1', path: [0] }, verdict: () => invalid('the check refused it') })
    await run('row', h)
    expect([h.root()[0].attrs, h.scene().defs, h.state().past, h.status()]).toEqual([{ x: 0 }, [], [], 'the check refused it'])
  })
  it('writes a group default by its exact key: a G\'s F= is a dead key of its own (the default-case trap), and copies none', () => {
    const g = node('G', { F: '#0f0', Size: 30 })
    expect(applyStyle(g, named('status.ok')).node.attrs).toEqual({ F: '#0f0', Size: 30, f: colour(t, 'status-ok') })
    expect(applyStyle(g, named('text.message')).node.attrs).toEqual({ F: '#0f0', Size: 30, size: 26, font: 'Barlow Medium', f: '#FFFFFF',
      sh: [[0, 2, 2, 0, '#00000099']] })
    expect(pasteStyle(g, { op: 'R', attrs: { f: '#f00' } })).toEqual({ node: node('G', { F: '#0f0', Size: 30, f: '#f00' }), overwrote: 0 })
    expect(styleOf(node('G', { F: '#0f0', f: '#f00', sw: 2 }))).toEqual({ f: '#f00', sw: 2 })
    expect(pasteStyle(node('R'), { op: 'G', attrs: { F: '#0f0' } }).node.attrs).toEqual({})   // a dead key passes nothing
    expect(applyStyle(node('R', { F: '#0f0' }), named('panel')).node.attrs.F).toBe(colour(t, 'surface-panel'))   // a shape's own f, any case
  })
  it('gives an open SP no shadow, which it casts only with close=1: a glow skips it and paste style leaves its sh alone', async () => {
    const p = [0, 0, 10, 10, 20, 0], open = node('SP', { p }), closed = node('SP', { p, close: 1 }), glow = namedOf(t).find(s => s.id === 'glow.ok')!
    expect([fits(glow, open, t), fits(glow, closed, t), fits(glow, node('SP', { p, close: '=c' }), t)]).toEqual([false, true, true])
    expect(pasteStyle(open, { op: 'R', attrs: { f: '#f00', sh: [[0, 2, 2, 0, '#000']] } }).node.attrs).toEqual({ p, f: '#f00' })
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [open, closed] }, { sel: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }], verdict: ok })
    await run('glow.ok', h)
    expect([h.root()[0], h.root()[1].attrs.sh, h.notes]).toEqual([open, shadow(t, 'glowOk'), ['1 skipped: this style does not fit it']])
  })
  it('a text style is the whole text look: a weight, kerning, outline or first-line override it has none of goes; layout stays', () => {
    const was = node('T', { text: 'a', weight: 'bold', kern: 0, ow: 2, oc: '#000', fl: 'size=12', align: 'center', lh: 1.2, wrap: 1 })
    expect(applyStyle(was, named('text.message')).node.attrs).toEqual({ text: 'a', align: 'center', lh: 1.2, wrap: 1, size: 26,
      font: 'Barlow Medium', f: '#FFFFFF', sh: [[0, 2, 2, 0, '#00000099']] })
  })
  it('skips a node inside a widget, saying why; a native in the set is no member (the store selects one alone)', async () => {
    const lit = putWidget({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0 })] }, instance('light'), t)
    const h = harness(lit, { sel: { pageId: 'p1', path: [0] }, also: [{ pageId: 'p1', path: [1, 0] }, { pageId: 'p1', path: [], native: 'n1' }], verdict: ok })
    await run('panel', h)
    expect([h.root()[0].attrs.f, h.root()[1], h.notes]).toEqual([colour(t, 'surface-panel'), lit.root[1], ['1 skipped: a widget\'s look is its params']])
  })
  it('reads paint parts independently of geometry tokens', () => {
    const odd: Theme = { ...slate, parts: { ...slate.parts, row: { fill: 'surface-panel', stroke: 'accent', width: 7, radius: 9 } } }
    expect(namedOf(odd).find(s => s.id === 'row')!.attrs(odd)).toEqual({ f: colour(slate, 'surface-panel'), s: colour(slate, 'accent'), sw: 7, rx: 9, sh: undefined })
    expect(namedOf(odd).find(s => s.id === 'text.unit')!.attrs(odd)).toMatchObject({ size: slate.type.unit.size, f: colour(slate, slate.type.unit.ink) })
  })
  it('styles 40 000 members in one pass, not one copy of the page list per member', async () => {
    const n = 40000, root = Array.from({ length: n }, (_, i) => node('R', { x: i }))
    const sel = (i: number) => ({ pageId: 'p1', path: [i] })
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root }, { sel: sel(n - 1), also: root.slice(1).map((_, i) => sel(i)), verdict: ok })
    await run('row', h)
    expect(h.root().every(r => r.attrs.f === '@theme_row')).toBe(true)
  }, 10_000) // measured: 0.426 s alone, 2.323 s full suite; at least 3x headroom
})

describe('paste style and the theme gradients', () => {
  const ok = (): Checked => ({ errors: [], warnings: [], src: 'R', order: { ops: [], nodes: [] } })
  const paste = (h: ReturnType<typeof harness>) => COMMANDS.find(c => c.id === 'style.paste')!.run(h.ctx)
  it('brings the theme gradient def a style copied on another page paints with, and tops one up where the style is there', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('R', { x: 0 })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    h.ctx.clip.style = { op: 'R', attrs: { f: '@theme_row' } }   // as Copy style leaves it on a page that has the def
    await paste(h)
    expect([h.root()[0].attrs, h.scene().defs, h.state().past.length]).toEqual([{ x: 0, f: '@theme_row' }, [gradientDef(vanillaPlus, 'row')], 1])
    const there = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('C', { cx: 1, f: '@theme_row' })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    there.ctx.clip.style = { op: 'R', attrs: { f: '@theme_row' } }
    await paste(there)
    expect([there.scene().defs, there.state().past.length, there.notes]).toEqual([[gradientDef(vanillaPlus, 'row')], 1, []])
  })
  it('leaves a hand-edited theme_ gradient def as it is (ruling): the style there already, no step', async () => {
    const old = node('GL', { id: 'theme_row', stops: [[0, '#010203'], [1, '#040506']] })
    const h = harness({ header: { w: 480, h: 480 }, defs: [old], root: [node('R', { x: 0, f: '@theme_row' })] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    h.ctx.clip.style = { op: 'R', attrs: { f: '@theme_row' } }
    await paste(h)
    expect([h.scene().defs, h.state().past.length, h.notes]).toEqual([[old], 0, ['the style is already there']])
  })
  it('brings the def a group\'s passed-down stroke s_ paints with (its children read it as s)', async () => {
    const h = harness({ header: { w: 480, h: 480 }, defs: [], root: [node('G', {}, [node('R', { x: 0 })])] }, { sel: { pageId: 'p1', path: [0] }, verdict: ok })
    h.ctx.clip.style = { op: 'R', attrs: { s: '@theme_row' } }
    await paste(h)
    expect([h.root()[0].attrs, h.scene().defs]).toEqual([{ s_: '@theme_row' }, [gradientDef(vanillaPlus, 'row')]])
  })
})
