import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newPage, newProject } from '../model/project'
import type { Scene, SrcNode, Value } from '../model/scene'
import { parseSrc } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { THEMES } from '../theme'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { problemsOf } from '../srctext/testing'
import { allocUid, detach, dropWidget, expandRoot, markerOf, mergeDefs, NO_CTX, putWidget, reassociate, sanitize, slotsOf, takenUids, themeDefs, widgetAt, widgetOf } from './core'
import { box, el, fill, gradientDef, KEYS, keyOf } from './paint'
import { WIDGETS } from './registry'
import { holds, instance, printed, rules, rulesOf, sceneOf } from './testing'
import type { Click, Params, Slot, WidgetModule } from './types'
import { imported } from '../theme/testing'
import { initialState, reducer } from '../model/store'

it('pasted text from an imported theme stays a widget', () => {
  const ref = { type: 'panel', uid: 'pnl1', params: sanitize(WIDGETS.panel, WIDGETS.panel.defaults(imported, NO_CTX), imported) }
  const pasted = printChecked(putWidget({ header: { w: 480, h: 480 }, defs: [], root: [] }, ref, imported))
  let s = reducer(initialState(), { type: 'addTheme', theme: imported, use: false })
  s = reducer(s, { type: 'setScene', pageId: 'p1', scene: parse(pasted) })
  expect(widgetOf(s.project.pages[0].scene.root[0], THEMES.neutral)?.type).toBe('panel')
  expect(s.notice).not.toContain('detached')
})

const parse = (text: string): Scene => { const r = parseSrc(text); expect(r.errors).toEqual([]); return r.scene! }
const slots = (type: string, over: Params = {}) => expandRoot(instance(type, over), t).exp.slots
const base = (): Scene => ({ header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [el('R', { x: 0, y: 0, w: 10, h: 10, f: '#FFFFFF' })] })
const lightAt = (x: number, uid?: string) => instance('light', { x }, uid)

it('loads every Vanilla + custom glyph ink without detaching or changing its drawing', () => {
  for (const ink of Object.keys(t.colors).filter(k => !THEMES.neutral.colors[k])) {
    const w = { ...instance('glyph', { glyph: 'arrow' }), params: { ...instance('glyph', { glyph: 'arrow' }).params, ink } }
    const saved = sceneOf(w, t), loaded = reassociate({ ...saved, root: [], defs: [] }, saved, t, undefined, true)
    expect(sanitize(WIDGETS.glyph, w.params, t).ink).toBe(ink)
    expect(loaded.detached).toEqual([])
    expect(printChecked(loaded.scene)).toBe(printChecked(saved))
  }
})

it('loads the old painted cog hole without detaching or changing its drawing', () => {
  const w = instance('glyph'), r = Number(w.params.w)/2/1.34, saved = sceneOf(w, t)
  const g = saved.root[0].c![0]
  g.c!.splice(1, 1, el('C', { cx: 0, cy: 0, rx: Math.fround(r), ry: Math.fround(r), f: t.colors['text-secondary'] }),
    el('C', { cx: 0, cy: 0, rx: Math.fround(0.4*r), ry: Math.fround(0.4*r), f: t.colors['surface-panel'] }))
  saved.root[0].comments = [markerOf({ ...w, params: { ...w.params, hole: 'surface-panel' } })]
  const loaded = reassociate({ ...saved, root: [], defs: [] }, saved, t, undefined, true)
  expect(loaded.detached).toEqual([])
  expect(printChecked(loaded.scene)).toBe(printChecked(saved))
  expect(printChecked(sceneOf(widgetOf(loaded.scene.root[0], t)!, t))).toBe(printChecked(saved))
})
const R = (attrs: Record<string, Value>) => el('R', attrs)

describe('the Status light', () => {
  it('draws one circle per state, three of them glowing, and reads one state', () => {
    expect(printed(instance('light'))).toEqual(expect.arrayContaining([
      '# widget light lt1 {"x":24,"y":24,"w":18,"h":18,"keys":{}}', 'G id=lt1 {',
      'C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#A6A6B4',
      'C v==eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]']))
    expect(expandRoot(instance('light'), t).exp.slots).toEqual([{ slot: 'st', key: 'lt1_st', kind: 'state', snap: true, sample: 1 }])
    expect(printed(instance('light', { keys: { st: 'o2_st' } }))).toContain('C v==1-eq($o2_st,1)-eq($o2_st,2)-eq($o2_st,3) cx=33 cy=33 rx=9 ry=9 f=#A6A6B4')
    holds('light', {}, { keys: { st: 'o2_st' } })
  })
  it('draws exactly four circles, idle to crit', () => {
    expect(printed(instance('light')).filter(l => l.startsWith('C '))).toEqual([
      'C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#A6A6B4',
      'C v==eq($lt1_st,1) cx=33 cy=33 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]',
      'C v==eq($lt1_st,2) cx=33 cy=33 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]',
      'C v==eq($lt1_st,3) cx=33 cy=33 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]'])
  })
})

describe('the marker', () => {
  it('prints above G id=<uid>, and reads back as the same widget', () => {
    const text = printChecked(putWidget(base(), lightAt(40), t))
    expect(text).toContain('# widget light lt1 {"x":40,"y":24,"w":18,"h":18,"keys":{}}\nG id=lt1 {\n')
    expect(widgetOf(parse(text).root[1], t)).toEqual(lightAt(40))
  })
  it('is an ordinary comment unless it names a known scene widget and the G’s own id, with a JSON object', () => {
    const g = (comment: string, op = 'G', id = 'lt1'): SrcNode => ({ op, attrs: { id }, c: [], comments: [comment] })
    expect(widgetOf(g('widget light lt1 {"x":1}'), t)?.params.x).toBe(1)
    for (const n of [g('widget light lt1 {"x":1}', 'R'), g('widget light lt1 {}', 'G', 'lt2'), g('widget lamp lt1 {}'),
      g('widget constructor lt1 {}'), g('widget light lt1 [1]'), g('widget light lt1 {"x":'), g('widget light lt_1 {}'), g('see: widget light lt1 {}')])
      expect(widgetOf(n, t)).toBeNull()
  })
  it('reads only what it knows from the JSON, nested to any depth, and never throws', () => {
    const deep = '['.repeat(100_000) + ']'.repeat(100_000)
    const n: SrcNode = { op: 'G', attrs: { id: 'lt1' }, c: [], comments: [`widget light lt1 {"x":5,"deep":${deep},"w":"big","keys":{"st":"a b","__proto__":"x"}}`] }
    const p = widgetOf(n, t)!.params
    expect([p.x, p.y, p.w, p.h, 'deep' in p]).toEqual([5, 24, 18, 18, false])
    // A prototype name is a name like any other, kept in a record with no prototype; the prototype is untouched.
    expect([Object.entries(p.keys as object), Object.getPrototypeOf(p.keys), ({} as Record<string, unknown>).x]).toEqual([[['st', 'a b'], ['__proto__', 'x']], null, undefined])
  })
  it('sanitize clamps numbers to their range and to float32, and falls back per param', () => {
    expect(sanitize(WIDGETS.light, { x: 'a', y: 1e40, w: -5, h: 0.1, keys: { st: 'o2_st', bad: 'a b', no: 5, cr: 'a\rb', '': 'x', e: '' } }, t))
      .toEqual({ x: 24, y: 24, w: 0, h: Math.fround(0.1), keys: { st: 'o2_st', bad: 'a b' } })   // any size the mod draws (ruling 13)
    expect(sanitize(WIDGETS.light, null, t)).toEqual(instance('light').params)
    expect(Object.is(sanitize(WIDGETS.light, { x: -0 }, t).x, 0)).toBe(true)   // the marker writes -0 as 0: read it so
  })
  it('sanitize writes no -0, which the marker would print as 0 and detach the widget on its next read', () => {
    const p = sanitize(WIDGETS.light, { x: -0, y: Math.round(-0.3) }, t)
    expect([Object.is(p.x, 0), Object.is(p.y, 0)]).toEqual([true, true])
  })
  it('keeps a data name in any script; the slot reads it only where it reads back, else its own name', () => {
    expect(sanitize(WIDGETS.light, { keys: { st: 'température', b: 'débit_2', c: 'x\u{1D49C}', d: 'a b', e: '' } }, t).keys)
      .toEqual({ st: 'température', b: 'débit_2', c: 'x\u{1D49C}', d: 'a b' })
    // An expression reads letters, digits and _, and since vector 0.11.98 a supplementary-plane character whole (ReadName).
    for (const [name, key] of [['température', 'température'], ['constructor', 'constructor'], ['x\u{1D49C}', 'x\u{1D49C}'], ['\u{1F600}', '\u{1F600}'],
      ['a b', 'lt1_st'], ['a\uD835', 'lt1_st']])
      expect(slots('light', { keys: { st: name } })[0].key).toBe(key)
    holds('light', { keys: { st: 'x\u{1D49C}' } }, { keys: { st: 'température' } })
    // A label alone reads more: any name its binding reads back whole (Alert's message).
    for (const [name, key] of [['room kPa', 'room kPa'], ['x\u{1D49C}', 'x\u{1D49C}'], ['__proto__', '__proto__'], ['a[0]', 'al1_msg'], ['a\rb', 'al1_msg']])
      expect(slots('alert', { keys: { msg: name } })[1].key).toBe(key)
  })
  it('reads back every param the marker wrote: -0 is sanitized to 0, and a text may hold U+2028 or U+2029', () => {
    expect(Object.is(sanitize(WIDGETS.light, { x: -0, y: -0 }, t).x, 0)).toBe(true)
    for (const w of [instance('button', { x: -0, y: -0 }), instance('button', { states: [{ label: 'a b c', variant: 'secondary' }] })]) {
      const s = parse(printChecked(sceneOf(w)))
      expect(widgetOf(s.root[0], t)).toEqual(w)
      expect(reassociate({ ...s, root: [] }, s, t).detached).toEqual([])
    }
  })
  it('writes each number as the shortest decimal of its float32', () => {
    expect(markerOf({ type: 'light', uid: 'lt1', params: { x: Math.fround(39.2), y: -0, keys: {} } })).toBe('widget light lt1 {"x":39.2,"y":0,"keys":{}}')
  })
})

describe('defs', () => {
  it('a widget brings the theme gradients its nodes use, once each', () => {
    expect(themeDefs([el('G', {}, [R({ f: '@theme_row' }), R({ f: '@theme_brand' }), R({ f: '@theme_row' })])], t).map(d => d.attrs.id))
      .toEqual(['theme_brand', 'theme_row'])
  })
  it('merge by id: replaced in place, appended, stale <uid>_ defs dropped', () => {
    const d = (id: string, w = 1) => el('CP', { id }, [R({ x: 0, y: 0, w, h: 1 })])
    const out = mergeDefs([d('a'), d('duct1_clip'), d('duct1_old'), d('theme_row'), d('duct10_clip')], [d('duct1_clip', 2), d('theme_row', 3), d('duct1_new')], 'duct1')
    expect(out.map(x => [x.attrs.id, x.c![0].attrs.w])).toEqual([['a', 1], ['duct1_clip', 2], ['theme_row', 3], ['duct10_clip', 1], ['duct1_new', 1]])
  })
})

describe('put, drop, detach', () => {
  it('put replaces a root where it stands, keeping comments above the marker, or appends it on top', () => {
    const s0 = putWidget(base(), lightAt(40), t)
    const s = { ...s0, root: [s0.root[0], { ...s0.root[1], comments: ['mine', ...s0.root[1].comments!] }, R({ x: 1, y: 1, w: 1, h: 1, f: '#000' })] }
    const moved = putWidget(s, lightAt(60), t)
    expect(moved.root).toHaveLength(3)
    expect(moved.root[1].comments).toEqual(['mine', markerOf(lightAt(60))])
    expect(widgetAt(moved, [1], t)?.params.x).toBe(60)
    expect(widgetAt(moved, [2], t)).toBeNull()
    expect(widgetAt(moved, [1, 0], t)).toBeNull()
  })
  it('drop removes the root and its <uid>_ defs; detach drops only the marker', () => {
    const cp = (id: string) => el('CP', { id }, [R({ x: 0, y: 0, w: 1, h: 1 })])
    const s = { ...putWidget(base(), lightAt(40), t), defs: [cp('lt1_clip'), cp('lt10_clip')] }
    const dropped = dropWidget(s, 'lt1', t)
    expect(dropped.root).toHaveLength(1)
    expect(dropped.defs.map(d => d.attrs.id)).toEqual(['lt10_clip'])
    const plain = detach(s, 'lt1', t)
    expect(plain.root[1].comments).toBeUndefined()
    expect(plain.root[1].c).toBe(s.root[1].c)
    expect(widgetOf(plain.root[1], t)).toBeNull()
  })
  it('allocates the smallest uid no id in the project uses, as itself or as an id stem', () => {
    const p = newProject()
    p.pages[0].scene = { ...base(), root: [el('G', { id: 'lt1' }, [R({ id: 'lt3', x: 0, y: 0, w: 1, h: 1 })])], defs: [el('CP', { id: 'lt2_clip' }, [R({ x: 0, y: 0, w: 1, h: 1 })])] }
    expect(allocUid(p, 'lt')).toBe('lt4')
    expect(allocUid(p, 'bar')).toBe('bar1')
  })
  it('allocates no uid a binding is kept under, as a data name’s stem or a native’s @<uid>.', () => {
    const p = { ...newProject(), bindings: { lt1_st: { from: 'const' as const, value: 1 }, '@ico1.name': { from: 'expr' as const, expr: 'P.item' } } }
    expect([allocUid(p, 'lt'), allocUid(p, 'ico'), allocUid(p, 'bar')]).toEqual(['lt2', 'ico2', 'bar1'])
  })
  it('caches a root’s slots by object', () => {
    const s = putWidget(base(), lightAt(40), t)
    expect(slotsOf(s.root[1], t)).toBe(slotsOf(s.root[1], t))
    expect(slotsOf(s.root[0], t)).toEqual([])
  })
})

describe('a copy pasted from a widget, which used its <uid>_ defs (the final review)', () => {
  // A hand-authored clip around the duct pasted again: the copy is detached and given copies of the defs it uses,
  // under a stem no widget uid can have (UID ends at its number), so the widget's edits and its deletion leave it be.
  const widget = putWidget(base(), instance('duct', { x: 24, y: 100 }), t)
  const one = { ...widget, defs: [el('CP', { id: 'duct1_clip' }, [R({ x: 24, y: 100, w: 300, h: 4 })])],
    root: [widget.root[0], { ...widget.root[1], c: [el('G', { clip: 'duct1_clip' }, widget.root[1].c)] }] }
  const text = printChecked(one)
  const twice = reassociate(one, parse(text + text.slice(text.indexOf('# widget duct'))), t).scene
  it('points the copy at its own copies of the defs it used', () => {
    expect(twice.defs.map(d => d.attrs.id)).toEqual(['duct1_clip', 'duct1copy1_clip'])
    expect(twice.root[2].c![0].attrs.clip).toBe('duct1copy1_clip')
    expect(printChecked({ ...twice, defs: [twice.defs[1]] })).toBe(printChecked({ ...twice, defs: [{ ...twice.defs[0], attrs: { id: 'duct1copy1_clip' } }] }))
    expect(problemsOf(twice).filter(m => /not declared/.test(m))).toEqual([])
    // A stem the page uses already is skipped; a copy using no <uid>_ def gets none.
    const taken = parse(text.replace('R x=0 ', 'R id=duct1copy1_a x=0 ') + text.slice(text.indexOf('# widget duct')))
    expect(reassociate(one, taken, t).scene.root[2].c![0].attrs.clip).toBe('duct1copy2_clip')
    const two = putWidget(base(), lightAt(40), t), lights = printChecked(two)
    expect(reassociate(two, parse(lights + lights.slice(lights.indexOf('# widget light'))), t).scene.defs).toEqual([])
  })
  it('drops the widget’s own defs with it and on re-expansion; the copy keeps drawing as it did', () => {
    expect(dropWidget(twice, 'duct1', t).defs.map(d => d.attrs.id)).toEqual(['duct1copy1_clip'])
    const w = widgetOf(twice.root[1], t)!, moved = putWidget(twice, { ...w, params: { ...w.params, y: 300 } }, t)
    expect(moved.defs.map(d => [d.attrs.id, d.c![0].attrs.y])).toEqual([['duct1copy1_clip', 100]])
    expect(moved.root[1].c![0].attrs.y).toBe(300)
    expect(reassociate(twice, moved, t).detached).toEqual([])
  })
  it('keeps a <uid>_ def a hand-written node uses when the widget is deleted', () => {
    const hand = { ...one, root: [...one.root, el('G', { clip: 'duct1_clip' }, [R({ x: 0, y: 0, w: 5, h: 5, f: '#000' })])] }
    expect(dropWidget(hand, 'duct1', t).defs.map(d => d.attrs.id)).toEqual(['duct1_clip'])
    expect(dropWidget(one, 'duct1', t).defs).toEqual([])   // no other user: the widget's defs go with it
  })
})

describe('reassociate', () => {
  const prev = putWidget(putWidget(base(), lightAt(40), t), lightAt(80, 'lt2'), t)
  const text = printChecked(prev)
  it('detaches a pasted widget whose uid a plain node on the page holds as its stem, but not on a load', () => {
    const plain = { ...base(), root: [...base().root, el('G', { id: 'lt7' }, [el('R', { id: 'lt7_x', x: 0, y: 0, w: 1, h: 1, f: '#FFFFFF' })])] }
    const pasted = parse(printChecked(plain) + printChecked(putWidget(base(), lightAt(40, 'lt7'), t)).split('\n').slice(2).join('\n'))
    expect(reassociate(plain, pasted, t)).toMatchObject({ detached: [], reused: ['lt7'] })
    expect(reassociate(base(), pasted, t, new Set(), true)).toMatchObject({ detached: [], reused: [] })
  })
  it('keeps the marker of a widget moved into an ordinary group', () => {
    const moved = parse(text.replace('# widget light lt2', 'G id=box {\n# widget light lt2').trimEnd() + '\n}\n')
    const r = reassociate(prev, moved, t)
    expect(r.detached).toEqual([])
    expect(printChecked(r.scene)).toContain('# widget light lt2')
    expect(r.dropped).toEqual([])
  })
  it('keeps text pasted from a project in another theme, made again in this one (the final review)', () => {
    for (const other of [THEMES.neutral]) {
      const theirs = printChecked(putWidget(base(), instance('bar', { x: 30 }), other))
      const r = reassociate(base(), parse(theirs), t)
      expect([r.detached, r.reused]).toEqual([[], []])
      expect(printChecked(r.scene)).toBe(printChecked(putWidget(base(), instance('bar', { x: 30 }), t)))
    }
    const edited = printChecked(putWidget(base(), instance('bar', { x: 30 }), THEMES.neutral)).replace('R x=34 ', 'R x=35 ')
    expect(reassociate(base(), parse(edited), t).detached).toEqual(['bar1'])
  })
  it('returns the parsed scene itself when no widget was edited, whatever the layout or the comments above a marker', () => {
    for (const s of [parse(text), parse(text.replace(/\n {4}/g, '\n  ').replace('# widget light lt2', '# mine\n# widget light lt2'))]) {
      const r = reassociate(prev, s, t)
      expect(r.detached).toEqual([])
      expect(r.scene).toBe(s)
    }
  })
  it('detaches exactly the widget edited by hand; its nodes and its id stay', () => {
    const r = reassociate(prev, parse(text.replace('cx=89', 'cx=90')), t)   // lt2's first circle: x 80 + 9
    expect(r.detached).toEqual(['lt2'])
    expect(widgetOf(r.scene.root[1], t)?.uid).toBe('lt1')
    expect(r.scene.root[2].comments).toBeUndefined()
    expect(r.scene.root[2].attrs.id).toBe('lt2')
  })
  it('attaches pasted text whose nodes are what its params expand to, and detaches one whose JSON was edited', () => {
    expect(reassociate(base(), parse(text), t).detached).toEqual([])
    expect(reassociate(prev, parse(text.replace('"x":80', '"x":81')), t).detached).toEqual(['lt2'])
  })
  it('keeps the first of two widgets with one uid', () => {
    const s = parse(text), dup = { ...s, root: [...s.root, s.root[1]] }
    const r = reassociate(prev, dup, t)
    expect([r.detached, r.reused]).toEqual([[], ['lt1']])   // a copy, not an edit: the notice says its uid is used
    expect(widgetOf(r.scene.root[1], t)).not.toBeNull()
    expect(widgetOf(r.scene.root[3], t)).toBeNull()
  })
  it('leaves a comment that only looks like a marker alone', () => {
    const s = parse('# widget lamp lp1 {}\nG id=lp1 {\n}\n')
    const r = reassociate(base(), s, t)
    expect([r.scene, r.detached]).toEqual([s, []])
    expect(r.scene).toBe(s)
  })
})

describe('the expansion rules', () => {
  const check = (nodes: SrcNode[], slots: Slot[] = [], defs: SrcNode[] = [], clicks: Click[] = []) =>
    rulesOf({ op: 'G', attrs: { id: 'w1' }, c: nodes }, defs, { nodes, slots, clicks }, 'w1')
  const slot = (key: string, kind: Slot['kind'] = 'state', snap = true): Slot => ({ slot: key, key, kind, snap, sample: 1 })
  it('passes the light', () => expect(rules(instance('light'))).toEqual([]))
  it('flags each broken rule', () => {
    expect(check([el('T', { id: 'w1_t', click: 1, x: 0, y: 0, w: 9, h: 9, text: 'a', size: 8, font: 'Barlow' })], [], [], [{ id: 'w1_t', step: '' }]))
      .toContain('E3: T w1_t is clickable but not an unpainted R with an id')
    expect(check([R({ id: 'x', x: 0, y: 0, w: 1, h: 1, f: '#fff' })])).toContain('E2: id x is not w1_…')
    expect(check([R({ x: 0, y: 0, w: '=$a', h: 1, f: '#fff' })], [slot('a', 'number', false)])).toContain('E8: w on R is not clamped')
    expect(check([R({ x: 0, y: 0, w: 1, h: 1, f: '#fff', fo: '=1-down' })])).toContain('E4: fo on R reads hover/down outside its button')
    expect(check([R({ v: '=eq($s,1)', x: 0, y: 0, w: 1, h: 1, f: '#fff' })], [slot('s', 'state', false)])).toContain('E7: R reads eased $s as a state')
    expect(check([el('T', { x: 0, y: 0, w: 9, h: 9, text: '$m', size: 26, font: 'Barlow', fit: 'ellipsis' })], [slot('m', 'string')]))
      .toContain('E9: T ellipsis box 9 < 1.4 × 26')
    expect(check([el('T', { x: 0, y: 0, w: 9, h: 99, text: '$m', size: 26, font: 'Barlow' })], [slot('m', 'string')]))
      .toContain('E9: T shows a data string without fit=ellipsis')
    expect(check([el('T', { x: 0, y: 0, w: 9, h: 9, text: 'a', size: 8, font: 'Barlow', weight: 'bold' })])).toContain('E10: weight on T')
    expect(check([el('T', { x: 0, y: 0, w: 90, h: 20, text: 'a', size: 8, font: 'Barlow' }), R({ x: 5, y: 5, w: 5, h: 5, f: '#fff' })]))
      .toContain('E5: R is drawn over an earlier label')
    expect(check([R({ x: 0, y: 0, w: 1, h: 1, f: '@g' })])).toContain('E16: @g has no def')
    expect(check([R({ x: 0, y: 0, w: 1, h: 1, f: '$c[i]' })], [slot('c', 'strings')])).toContain('E12: f on R reads a colour array')
    expect(check([el('G', { r: 1 }, [el('G', { clip: 'w1_clip' }, [])])], [], [el('CP', { id: 'w1_clip' }, [R({ x: 0, y: 0, w: 1, h: 1 })])]))
      .toContain('E13: clip on G')
    expect(check([], [slot('s')])).toContain('E2: slot key s is never read')
    expect(check([R({ id: 'w1_hit', click: 1, x: 0, y: 0, w: 1, h: 1 })])).toContain('clicks: w1_hit is not listed')
  })
  it('lets a hit plate come anywhere, and a pressed look answer to its button', () => {
    expect(check([el('T', { x: 0, y: 0, w: 90, h: 20, text: 'a', size: 8, font: 'Barlow' }), R({ id: 'w1_hit', click: 1, x: 0, y: 0, w: 90, h: 20 }),
      el('G', {}, [R({ x: 99, y: 0, w: 1, h: 1, f: '#fff', fo: '=1-0.25*down' })])], [], [], [{ id: 'w1_hit', step: '' }])).toEqual([])
  })
  it('reads a name inside a {=…} placeholder, and none from a $ in plain text', () => {
    const T = (text: string) => el('T', { x: 0, y: 0, w: 90, h: 40, text, size: 8, font: 'Barlow' })
    expect(check([T('{=$a*2:%.0f}')], [slot('a', 'number')])).toEqual([])
    expect(check([T('Pump $a here')], [slot('a', 'number')])).toEqual(['E2: slot key a is never read'])
  })
  it('flags SYM and USE and a node past 6 levels, and allows a clip directly under the root', () => {
    expect(check([el('USE', { ref: 's' })])).toContain('E1: USE')
    expect(check([], [], [el('SYM', { id: 'w1_s' }, [])])).toContain('E1: SYM in defs')
    let deep: SrcNode = R({ x: 0, y: 0, w: 1, h: 1, f: '#fff' })
    for (let k = 0; k < 6; k++) deep = el('G', {}, [deep])
    expect(check([deep])).toEqual(['E15: R is 7 levels deep'])
    expect(check([el('G', { clip: 'w1_clip' }, [])], [], [el('CP', { id: 'w1_clip' }, [R({ x: 0, y: 0, w: 1, h: 1 })])])).toEqual([])
  })
})

// A module with a param of every type, its own clip def and a theme gradient: what the light cannot exercise.
type FP = { x: number; y: number; w: number; h: number; label: string; tpl: string; fmt: string; look: string; on: boolean
  vals: number[]; page: string; items: { name: string; v: number }[]; keys: Record<string, string> }
const FAKE: WidgetModule<FP> = {
  type: 'fake', label: 'Fake', group: 'values', prefix: 'fk', resize: 'both',
  params: [...box(), { key: 'label', type: 'text' }, { key: 'tpl', type: 'template' }, { key: 'fmt', type: 'fmt' },
    { key: 'look', type: 'enum', enum: ['a', 'b'] }, { key: 'on', type: 'flag' }, { key: 'vals', type: 'numbers', min: 0, max: 10 },
    { key: 'page', type: 'page' }, { key: 'items', type: 'list', item: [{ key: 'name', type: 'text' }, { key: 'v', type: 'num', min: 0 }], min: 1 }, KEYS],
  defaults: () => ({ x: 0, y: 0, w: 40, h: 20, label: 'A', tpl: 'T', fmt: '%.1f', look: 'a', on: false, vals: [1], page: 'p1',
    items: [{ name: 'n', v: 1 }], keys: {} }),
  expand(p, _t, uid) {
    const v = keyOf(p, uid, 'v')
    return {
      nodes: [el('G', { clip: `${uid}_clip` }, [R({ x: p.x, y: p.y, w: p.w, h: p.h, f: fill('row') })]),
        el('T', { x: p.x, y: p.y + 40, w: p.w, h: 40, text: p.label, size: 8, font: 'Barlow' }),
        el('T', { x: p.x, y: p.y + 80, w: p.w, h: 40, text: `${p.tpl}{=$${v}:${p.fmt}}`, size: 8, font: 'Barlow' })],
      defs: [el('CP', { id: `${uid}_clip` }, [R({ x: p.x, y: p.y, w: p.w, h: p.h })])],
      slots: [{ slot: 'v', key: v, kind: 'number', snap: true, sample: 1 }],
    }
  },
}

describe('the core with every param type, defs and pages', () => {
  beforeAll(() => { WIDGETS.fake = FAKE })
  afterAll(() => { delete WIDGETS.fake })
  const fake = (over: Params = {}, uid?: string) => instance('fake', over, uid)

  it('round-trips string params holding U+2028 and U+2029, and reads a marker with blanks after it', () => {
    const w = fake({ label: 'a\u2028b "#}', tpl: 'x\u2029y', fmt: '%.1f\u2028kPa', items: [{ name: 'i\u2029', v: 2 }] })
    expect(w.params).toMatchObject({ label: 'a\u2028b "#}', tpl: 'x\u2029y', fmt: '%.1f\u2028kPa', items: [{ name: 'i\u2029', v: 2 }] })
    expect(markerOf(w)).not.toMatch(/[\u2028\u2029]/)
    const text = printChecked(putWidget(base(), w, t))
    expect(widgetOf(parse(text).root[1], t)).toEqual(w)
    expect(reassociate(base(), parse(text), t).detached).toEqual([])
    const raw: SrcNode = { op: 'G', attrs: { id: 'fk1' }, c: [], comments: [`widget fake fk1 ${JSON.stringify(w.params)} \t`] }
    expect(widgetOf(raw, t)).toEqual(w)
  })
  it('reads every param type, falling back per param', () => {
    const p = (v: Params) => sanitize(FAKE, v, t), d = FAKE.defaults(t, NO_CTX)
    expect(p({ look: 'b', on: true, label: '12', tpl: '=$x', page: 'p2' })).toMatchObject({ look: 'b', on: true, label: '12', tpl: '=$x', page: 'p2' })
    expect(p({ look: 'c', on: 1, label: '$x', tpl: 5, page: null })).toMatchObject({ look: 'a', on: false, label: 'A', tpl: 'T', page: 'p1' })
    expect([p({ label: 'a {=1}' }).label, p({ label: '1e5' }).label]).toEqual(['A', '1e5'])   // plainTextProblem decides
    // Printf.Translate passes on whatever lies between the % and the letter (%1.2.3f too); the placeholder's grammar ends a
    // format at a brace. Since vector 0.11.97 a placeholder's own format follows the first ':' outside its index, so a ] or
    // a [ in it is literal.
    for (const fmt of ['', '%d', '%5.2f kPa', 'kPa %.0f', '%.99e', '%.100f', '%.003f', '%x', '50%', '%%', '%1.2.3f', '%d %d', '%é',
      '%.1f [kPa]', '[%d]', '%d]', ']', '[%d', '%d [kPa', ':%d:']) expect(p({ fmt }).fmt).toBe(fmt)
    for (const fmt of ['{', '%.1f}', '}', '{0:F1}']) expect(p({ fmt }).fmt).toBe('%.1f')
    expect(p({ vals: [0.1, 'a', -5, 11, Infinity, 1e40] }).vals).toEqual([Math.fround(0.1), 0, 10])
    expect(p({ x: 0.1 }).x).toBe(Math.fround(0.1))
    expect(p({ items: [{ name: 'a', v: -1, junk: 1 }, 7, { name: '$b' }] }).items).toEqual([{ name: 'a', v: 0 }, { name: 'n', v: 1 }])
    expect(p({ items: [] }).items).toEqual(d.items)
    expect(p({ keys: { v: 'ok', constructor: 'a', w: 'toString', x: 'a b', y: 3 } }).keys).toEqual({ v: 'ok', constructor: 'a', w: 'toString', x: 'a b' })
    expect([p({ label: 'a\r\nb\rc' }).label, p({ tpl: 'x\ry' }).tpl]).toEqual(['a\nb\nc', 'x\ny'])   // src holds no CR
    const empty = { ...FAKE, defaults: () => ({ ...d, items: [] }), params: FAKE.params.map(q => q.type === 'list' ? { ...q, min: 0 } : q) }
    expect(sanitize(empty as WidgetModule, { items: [{ v: 3 }] }, t).items).toEqual([{ v: 3 }])
  })
  it('brings only the theme gradients f and s paint with, never a label’s text', () => {
    expect(themeDefs([el('T', { text: '@theme_row' }), R({ f: '@theme_zz' }), R({ s: '@theme_constructor' }), R({ s: '@theme_brand' })], t)
      .map(d => d.attrs.id)).toEqual(['theme_brand'])
    expect(expandRoot(fake({ label: '@theme_zz', tpl: '@theme_brand' }), t).defs.map(d => d.attrs.id)).toEqual(['fk1_clip', 'theme_row'])
  })
  it('keeps in the marker the renames its slots read and those of slots it lacks now, never one a slot cannot read back', () => {
    const w = fake({ keys: { v: 'pump', gone: 'old' } })
    expect(w.params.keys).toEqual({ v: 'pump', gone: 'old' })
    expect(expandRoot(w, t).root.comments).toEqual([markerOf(w)])
    const odd = fake({ keys: { v: 'a b', gone: 'old' } })   // an expression reads v: 'a b' is not its name
    expect(expandRoot(odd, t).root.comments).toEqual([markerOf({ ...odd, params: { ...odd.params, keys: { gone: 'old' } } })])
    // A Bar's state slot, gone while the colour is automatic, finds its rename again (the M2b final review).
    let bar = instance('bar', { keys: { st: 'pump_st' } })
    for (const stateMode of ['auto', 'bound']) bar = widgetOf(expandRoot({ ...bar, params: sanitize(WIDGETS.bar, { ...bar.params, stateMode }, t) }, t).root, t)!
    expect(slots('bar', bar.params).map(s => s.key)).toEqual(['bar1_lvl', 'pump_st'])
  })
  it('merges defs by kind and id; a def without an id is never a match', () => {
    const cp = el('CP', { id: 'theme_row' }, []), gl = gradientDef(t, 'row'), noId = el('GL', {})
    expect(mergeDefs([cp, noId], [gl, el('GL', {})], 'fk1')).toEqual([cp, noId, gl])
    const old = el('GL', { id: 'theme_row', x1: 5 }), k = el('CP', { id: 'k' }, [])
    expect(mergeDefs([old, k, old], [gl], 'fk1')).toEqual([gl, k])
  })
  it('takes uids from every page, or from all but one', () => {
    const p = newProject(), p2 = newPage(p)
    p2.scene = { ...base(), root: [el('G', { id: 'lt1' }, [])] }
    p.pages.push(p2)
    p.pages[0].scene = { ...base(), defs: [el('CP', { id: 'lt2_clip' }, [])] }
    expect(allocUid(p, 'lt')).toBe('lt3')
    expect([...takenUids(p, p2.id)]).toEqual(['lt2'])
  })
  it('detaches a widget whose own def was edited by hand, and puts back a def the text lost', () => {
    const s = putWidget(base(), fake(), t)
    expect(s.defs.map(d => d.attrs.id)).toEqual(['fk1_clip', 'theme_row'])
    expect(reassociate(s, { ...s }, t).scene.defs).toBe(s.defs)
    const clip = el('CP', { id: 'fk1_clip' }, [R({ x: 0, y: 0, w: 3, h: 3 })])
    expect(reassociate(s, { ...s, defs: [clip, s.defs[1]] }, t).detached).toEqual(['fk1'])
    const lost = reassociate(s, { ...s, defs: [s.defs[1]] }, t)
    expect([lost.detached, lost.scene.defs]).toEqual([[], [s.defs[1], s.defs[0]]])
  })
  it('attaches pasted text without its DEFS and appends the defs it needs', () => {
    const r = reassociate(base(), parse(printChecked({ ...putWidget(base(), fake(), t), defs: [] })), t)
    expect([r.detached, r.scene.defs.map(d => d.attrs.id)]).toEqual([[], ['fk1_clip', 'theme_row']])
  })
  it('detaches a widget new to the page whose uid another page has', () => {
    const s = putWidget(base(), lightAt(40), t), text = printChecked(s)
    expect(reassociate(base(), parse(text), t, new Set(['lt1'])).reused).toEqual(['lt1'])
    expect(reassociate(s, parse(text), t, new Set(['lt1']))).toMatchObject({ detached: [], reused: [] })
  })
  it('reports a widget whose marker no longer reads, leaving its nodes as written', () => {
    const s = putWidget(base(), lightAt(40), t), text = printChecked(s)
    for (const edit of [text.replace('\nG id=lt1', '\n# mine\nG id=lt1'), text.replace('"x":40', '"x":'), text.replace('G id=lt1', 'G id=lt9')]) {
      const next = parse(edit), r = reassociate(s, next, t)
      expect(r.detached).toEqual(['lt1'])
      expect(r.scene).toBe(next)
    }
    expect(reassociate(s, base(), t).detached).toEqual([])
  })
})
