import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { putWidget, widgetOf } from '../widgets/core'
import { clipProbe, instance } from '../widgets/testing'
import { WIDGETS } from '../widgets/registry'
import { copyText, pasteText } from './clipboard'
import { idsFrom } from './tree'

const uid = (prefix: string) => prefix + '9'   // no plain paste calls it
const G = node('GL', { id: 'g', x1: 0, y1: 0, x2: 1, y2: 0 })
const scene: Scene = { header: { w: 460, h: 460 }, defs: [G, node('GL', { id: 'other' })], root: [node('R', { id: 'a', x: 0, y: 0, w: 5, h: 5, f: '@g' })] }
beforeAll(() => { WIDGETS.clipprobe = clipProbe })
afterAll(() => { delete WIDGETS.clipprobe })

describe('the clipboard text', () => {
  it('carries the nodes and only the defs they reach', () => {
    const text = copyText(scene, scene.root, t)
    expect(text).toContain('GL id=g')
    expect(text).not.toContain('other')
    expect(text).toContain('R id=a')
  })
  it('pastes on top, moved, ids fresh, an equal def reused', () => {
    const out = pasteText(scene, copyText(scene, scene.root, t), idsFrom(new Set(['a', 'g', 'other'])), 10, 10, t, uid)
    if (typeof out === 'string') throw new Error(out)
    expect(out.paths).toEqual([[1]])
    expect(out.scene.defs).toBe(scene.defs)
    expect(out.scene.root[1].attrs).toEqual({ id: 'a2', x: 10, y: 10, w: 5, h: 5, f: '@g' })
  })
  it('renames a different def of the same id with its references; never a theme_ def', () => {
    const there: Scene = { ...scene, defs: [node('GL', { id: 'g', x2: 5 }), node('GL', { id: 'theme_row', x2: 9 })] }
    const text = copyText({ ...scene, defs: [G, node('GL', { id: 'theme_row' })] },
      [node('R', { f: '@g' }), node('R', { f: '@theme_row' })], t)
    const out = pasteText(there, text, idsFrom(new Set(['g', 'theme_row'])), 0, 0, t, uid)
    if (typeof out === 'string') throw new Error(out)
    expect(out.scene.defs.map(d => d.attrs.id)).toEqual(['g', 'theme_row', 'g2'])
    expect(out.scene.root.map(n => n.attrs.f)).toEqual(['@g', '@g2', '@theme_row'])
  })
  it('keeps a def whose id the page lacks; renames one whose id a node of the page uses (ids must not repeat in a scene)', () => {
    const text = copyText(scene, scene.root, t)
    const empty = pasteText({ header: {}, defs: [], root: [] }, text, idsFrom(new Set(['a', 'g'])), 0, 0, t, uid)
    if (typeof empty === 'string') throw new Error(empty)
    expect(empty.scene.defs.map(d => d.attrs.id)).toEqual(['g'])
    const clash = pasteText({ header: {}, defs: [], root: [node('R', { id: 'g' })] }, text, idsFrom(new Set(['a', 'g'])), 0, 0, t, uid)
    if (typeof clash === 'string') throw new Error(clash)
    expect(clash.scene.defs.map(d => d.attrs.id)).toEqual(['g2'])
    expect(clash.scene.root[1].attrs).toMatchObject({ id: 'a2', f: '@g2' })
  })
  it('says why a node stayed where it was copied, or moved on one axis only', () => {
    const out = pasteText(scene, 'R x="=t" y=0 w=5 h=5\n', idsFrom(new Set()), 10, 0, t, uid)
    if (typeof out === 'string') throw new Error(out)
    expect(out.notes).toEqual(['a pasted node stays where it was copied: x is an expression'])
    expect(out.scene.root[1].attrs.x).toBe('=t')
    const part = pasteText(scene, 'R x="=t" y=0 w=5 h=5\n', idsFrom(new Set()), 10, 10, t, uid)
    if (typeof part === 'string') throw new Error(part)
    expect(part.notes).toEqual(['a pasted node moved only in part: x is an expression'])
    expect(part.scene.root[1].attrs.y).toBe(10)
  })
  it('leaves out a widget\'s own defs, but one a plain node reaches; pastes a widget as a copy under a new uid, moved by its params', () => {
    const duct = putWidget({ header: { w: 460, h: 460 }, defs: [], root: [] }, instance('clipprobe'), t)
    expect(copyText(duct, duct.root, t)).not.toContain('CP id=duct1_clip')
    const hand = node('R', { clip: 'duct1_clip' })   // a node written by hand that clips to the widget's def
    expect(copyText(duct, [...duct.root, hand], t)).toContain('CP id=duct1_clip')
    const lock = { ...duct.root[0], comments: ['lock', ...duct.root[0].comments!] }
    const out = pasteText(duct, copyText(duct, [node('R', { id: 'a', x: 0, y: 0, w: 5, h: 5 }), lock], t), idsFrom(new Set(['duct1'])), 10, 10, t, uid)
    if (typeof out === 'string') throw new Error(out)
    expect(out.paths).toEqual([[1], [2]])   // the plain nodes first, then the widgets
    expect(widgetOf(out.scene.root[2], t)).toMatchObject({ uid: 'duct9', params: { x: (widgetOf(duct.root[0], t)!.params.x as number) + 10 } })
    expect(out.scene.root[2].comments![0]).toBe('lock')   // what stands above the marker comes with it
    expect(out.scene.defs.map(d => d.attrs.id)).toEqual(['duct1_clip', 'duct9_clip'])
  })
  it('says why not, for text that is not src or holds no node', () => {
    expect(pasteText(scene, 'R x="', idsFrom(new Set()), 0, 0, t, uid)).toMatch(/^the clipboard holds no src/)
    expect(pasteText(scene, '', idsFrom(new Set()), 0, 0, t, uid)).toMatch(/^the clipboard holds no src/)   // the parser refuses a text without nodes
    expect(pasteText(scene, 'DEFS {\n    GL id=g\n}\n', idsFrom(new Set()), 0, 0, t, uid)).toBe('the clipboard holds no nodes')   // defs only
  })
})
