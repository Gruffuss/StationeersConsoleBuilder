// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { COMMANDS } from '../editing/registry'
import { harness } from '../editing/testing'
import { copyText } from '../editing/clipboard'
import { node } from '../model/testing'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { isStyleLink, linked, linksOf, linkValue, resolveLinks, unlinked } from './links'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { vanillaPlus } from './vanillaPlus'
import { neutral } from './testing'

describe('style links', () => {
  it('keeps a gas identity link through a real theme switch and src round-trip', () => {
    const n = { ...node('R', { f: '#FFFFFF' }), comments: ['style {"f":{"gas":"Oxygen"}}'] }
    expect(linksOf(n)).toEqual({ f: { gas: 'Oxygen' } })
    const p = newProject(); p.theme = 'vanilla-plus'; p.pages[0].scene.root = [n]
    const s = reducer(initialState(p), { type: 'setTheme', theme: 'neutral' })
    const next = s.project.pages[0].scene.root[0]
    expect(next.attrs.f).toBe('#FFFFFF')
    expect(linksOf(next)).toEqual({ f: { gas: 'Oxygen' } })
    expect(linksOf(parseSrc(printChecked(s.project.pages[0].scene)).scene!.root[0])).toEqual({ f: { gas: 'Oxygen' } })
  })
  it('resolves gas and liquid links to the left split half independently of a theme palette', () => {
    for (const name of ['Hydrogen', 'LiquidHydrogen', 'H2']) {
      const n = { ...node('R'), comments: ['style ' + JSON.stringify({ f: { gas: name } })] }
      expect(linksOf(n)).toEqual({ f: { gas: name } })
      for (const t of [vanillaPlus, neutral]) expect(linkValue(linksOf(n).f, t)).toEqual({ value: '#C32826' })
    }
  })
  it('validates gas links as single named fields and keeps an unknown gas missing', () => {
    expect(isStyleLink({ gas: 'Oxygen' })).toBe(true)
    for (const gas of ['', 'Oxygen\n', null, 3]) expect(isStyleLink({ gas })).toBe(false)
    expect(isStyleLink({ gas: 'Oxygen', role: 'accent' })).toBe(false)
    const n = { ...node('R', { f: '#123456' }), comments: ['style {"f":{"gas":"toString"}}'] }
    expect(linkValue(linksOf(n).f, vanillaPlus)).toEqual({ missing: 'toString' })
    expect(resolveLinks(n, vanillaPlus, neutral)).toMatchObject({ node: n, missing: ['toString'], stale: 0 })
  })
  it('keeps authored style prose beside a link through linking and detach', () => {
    const comments = ['style', 'style notes: card look', 'style of this card']
    const n = linked({ ...node('R'), comments }, 'f', { role: 'accent' }, vanillaPlus)
    expect(n.comments?.slice(0, 3)).toEqual(comments)
    expect(linksOf(n)).toEqual({ f: { role: 'accent' } })
    expect(unlinked(n).comments).toEqual(comments)
  })
  it('a link follows the theme and a literal stays', () => {
    const n = linked(node('R', { s: '#123456' }), 'f', { role: 'accent' }, vanillaPlus)
    expect(resolveLinks(n, vanillaPlus, neutral)).toMatchObject({ node: { attrs: { f: neutral.colors.accent, s: '#123456' } }, missing: [], stale: 0 })
    expect(Object.keys(n.attrs)).toEqual(['s', 'f'])
  })
  it('a hand edit severs, including an expression; missing token keeps its literal and link', () => {
    const n = linked(node('R'), 'f', { role: 'accent' }, vanillaPlus)
    for (const f of ['#ff0000', '$colour', '=if(t,#fff,#000)']) {
      const r = resolveLinks({ ...n, attrs: { f } }, vanillaPlus, neutral)
      expect([r.node.attrs.f, linksOf(r.node), r.stale]).toEqual([f, {}, 1])
    }
    const glow = linked(node('R'), 'sh', { shadow: 'glowOk' }, vanillaPlus)
    const r = resolveLinks(glow, vanillaPlus, neutral)
    expect([r.node, r.missing]).toEqual([glow, ['glowOk']])
    expect(resolveLinks(r.node, neutral, vanillaPlus).missing).toEqual([])
  })
  it('validates untrusted comments and style keys; detach keeps attributes and other comments', () => {
    for (const comment of ['style nope', 'style []', 'style {"x":{"role":"accent"}}', 'style {"f":{"role":"accent","extra":1}}', 'style {"f":{"part":"constructor","field":"fill"}}', 'style {"f":{"part":"shape","field":["fill"]}}']) {
      expect(linksOf({ ...node('R'), comments: [comment] })).toEqual({})
    }
    const n = linked({ ...node('R'), comments: ['lock', 'authored'] }, 'f', { role: 'accent' }, vanillaPlus)
    expect(unlinked(n)).toEqual({ ...n, comments: ['lock', 'authored'] })
    expect(() => linked(n, 'id', { role: 'accent' }, vanillaPlus)).toThrow()
  })
  it('the comment round-trips through src, copy, duplicate and reorder', async () => {
    const n = linked(node('R', { x: 0, y: 0, w: 20, h: 20 }), 'f', { role: 'accent' }, vanillaPlus)
    const scene = { header: { w: 480, h: 480 }, defs: [], root: [n, node('R', { x: 50, w: 20, h: 20 })] }
    const src = printChecked(scene)
    expect(src).toContain('# style ')
    expect(linksOf(parseSrc(src).scene!.root[0])).toEqual(linksOf(n))
    expect(linksOf(parseSrc(copyText(scene, [n], vanillaPlus)).scene!.root[0])).toEqual(linksOf(n))
    const h = harness(scene, { sel: { pageId: 'p1', path: [0] } })
    await COMMANDS.find(c => c.id === 'duplicate')!.run(h.ctx)
    expect(h.root().filter(x => Object.keys(linksOf(x)).length)).toHaveLength(2)
    await COMMANDS.find(c => c.id === 'front')!.run(h.ctx)
    expect(h.root().filter(x => Object.keys(linksOf(x)).length)).toHaveLength(2)
  })
  it('an expression edited while its token is missing is never overwritten when the token returns', () => {
    const glow = linked(node('R'), 'sh', { shadow: 'glowOk' }, vanillaPlus)
    const held = resolveLinks(glow, vanillaPlus, neutral).node
    const edited = { ...held, attrs: { sh: [['=t', 0, 10, 0, '#ffffff']] } }
    const r = resolveLinks(edited, neutral, vanillaPlus)
    expect(r.node.attrs).toEqual(edited.attrs)
    expect(linksOf(r.node)).toEqual({})
  })
  it('a shadow link survives float32 src round-trips', () => {
    const t = { ...vanillaPlus, shadows: { ...vanillaPlus.shadows, fractional: [[0.1, 0, 2.3, 0, '#000000']] as import('./types').ShadowSpec[] } }
    const n = linked(node('R'), 'sh', { shadow: 'fractional' }, t)
    const parsed = parseSrc(printChecked({ header: {}, defs: [], root: [n] })).scene!.root[0]
    expect(resolveLinks(parsed, t, t).stale).toBe(0)
  })
})
afterEach(() => { document.body.innerHTML = '' })
