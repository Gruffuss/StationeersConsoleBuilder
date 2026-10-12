import { describe, expect, it } from 'vitest'
import { node } from '../model/testing'
import { fieldOf } from '../schema'
import { parseSrc } from '../srctext/parse'
import { absent, dataNames, modeOf, modesOf, noteOf, ownDefault, passedDown, read, shown, withAttr } from './fields'

const x = fieldOf('R', 'x')!, f = fieldOf('R', 'f')!, t = fieldOf('G', 't')!, n = fieldOf('RP', 'n')!, text = fieldOf('T', 'text')!

describe('fields', () => {
  it('offers the fx modes only where the whole value is read as an expression, and the paint modes on paints', () => {
    expect(modesOf(n)).toEqual(['literal'])
    expect(modesOf(x)).toEqual(['literal', 'data', 'expr'])
    expect(modesOf(fieldOf('GR', 'fx')!)).toEqual(['literal', 'data', 'expr'])   // kind L
    expect(modesOf(f)).toEqual(['literal', 'data', 'expr', 'gradient', 'colourExpr'])
    expect(modesOf(fieldOf('T', 'oc')!)).toEqual(['literal'])   // a plain colour
    expect(modesOf(fieldOf('G', 's')!)).toEqual(['literal'])   // a pair: an expression per element, [=t*2,1]
    expect(modesOf(t)).toEqual(['literal'])
  })

  it('reads the mode of a value, among the ones the key offers', () => {
    expect(modeOf('=t*2', x)).toBe('expr')
    expect(modeOf('$level', x)).toBe('data')
    expect(modeOf('$température', x)).toBe('data')
    // a name takes any supplementary-plane character whole since 0.11.98 (Expression.cs ReadName), a letter or not
    expect(modeOf('$𝒳', x)).toBe('data')
    expect(modeOf('$t😀', x)).toBe('data')
    expect(modeOf('$tank[i]', x)).toBe('expr')   // more than a name: the mod reads an expression
    expect(modeOf('$a+1', x)).toBe('expr')
    expect(modeOf('t*2', x)).toBe('expr')   // an = is optional to the mod
    expect(modeOf(3, x)).toBe('literal')
    expect(modeOf(undefined, x)).toBe('literal')
    expect(modeOf('@g', f)).toBe('gradient')
    expect(modeOf('=mix(#000,#fff,t)', f)).toBe('colourExpr')
    expect(modeOf('$tank[i]', f)).toBe('expr')
    expect(modeOf('$tank-1', f)).toBe('data')
    expect(modeOf('#fff', f)).toBe('literal')
    expect(modeOf('red', f)).toBe('literal')
    expect(modeOf('$tank[i]', text)).toBe('literal')   // T text offers no other mode: its text is read as written
    expect(modeOf('=a', text)).toBe('literal')
    expect(modeOf('$a', t)).toBe('literal')
  })

  it('reads typed text in a mode, refusing only what the mod cannot read', () => {
    expect(read('12.5', 'literal', x)).toEqual({ value: 12.5 })
    expect(read('0.1', 'literal', x)).toEqual({ value: Math.fround(0.1) })
    expect(read('abc', 'literal', x)).toEqual({ error: 'a number is expected' })
    expect(read('t*2', 'expr', x)).toEqual({ value: '=t*2' })
    expect(read('=t*2', 'expr', x)).toEqual({ value: '=t*2' })
    expect(read('level', 'data', x)).toEqual({ value: '$level' })
    expect(read('température', 'data', x)).toEqual({ value: '$température' })
    expect(read('tank-1', 'data', x)).toHaveProperty('error')   // in an expression that is tank minus 1
    expect(read('tank-1', 'data', f)).toEqual({ value: '$tank-1' })   // a paint's data name is anything before its [
    expect(read('', 'literal', x)).toEqual({ value: undefined })
    expect(read('  ', 'expr', x)).toEqual({ value: undefined })
    expect(read('tank[i]', 'expr', f)).toEqual({ value: '$tank[i]' })
    expect(read('g', 'gradient', f)).toEqual({ value: '@g' })
    expect(read('tank-fill', 'gradient', f)).toEqual({ value: '@tank-fill' })
    expect(read('a b', 'gradient', f)).toHaveProperty('error')
    expect(read('[1,2]', 'literal', t)).toEqual({ value: [1, 2] })
    expect(read('["=t*10",0]', 'literal', t)).toEqual({ value: ['=t*10', 0] })
    expect(read('[1, 2', 'literal', t)).toHaveProperty('error')
    expect(read('1 2', 'literal', t)).toHaveProperty('error')   // two values, not one
    expect(read('2.5', 'literal', n)).toEqual({ value: 2.5 })   // the mod rounds and clamps (noteOf)
    expect(read('30000', 'literal', n)).toEqual({ value: 30000 })
    expect(read('[1,2,3,4]', 'literal', fieldOf('R', 'rx')!)).toEqual({ value: [1, 2, 3, 4] })   // its corners
    expect(read('a\nb', 'literal', text)).toEqual({ value: 'a\nb' })
    // weight takes a word or a number (0.11.94), each as itself; text stays text
    expect(read('700', 'literal', fieldOf('T', 'weight')!)).toEqual({ value: 700 })
    expect(read('bold', 'literal', fieldOf('G', 'weight')!)).toEqual({ value: 'bold' })
    expect(read('700', 'literal', text)).toEqual({ value: '700' })
    // a number src cannot carry is no word either, as on a number key
    for (const t of ['NaN', 'Infinity', '-infinity', '1e39'])
      expect(read(t, 'literal', fieldOf('T', 'weight')!), t).toEqual({ error: 'a number is expected' })
  })

  it('takes any colour the mod reads, a malformed #hex too: one that is not a colour is a warning of the check', () => {
    for (const c of ['#123', 'none', 'NONE', 'red', 'Red', 'grey', 'gray', 'transparent', 'notacolour', '#12']) expect(read(c, 'literal', f)).toEqual({ value: c })
    expect(read('#12345', 'literal', fieldOf('T', 'oc')!)).toEqual({ value: '#12345' })
    expect(noteOf(f, 'reds')).toBeNull()
  })

  it('keeps a label of spaces; an emptied field removes the key', () => {
    expect(read('  ', 'literal', text)).toEqual({ value: '  ' })
    expect(read('', 'literal', text)).toEqual({ value: undefined })
    expect(read('  ', 'literal', x)).toEqual({ value: undefined })
  })

  it("notes the mod's rounding and clamping", () => {
    expect(noteOf(n, 2.5)).toBe('the mod rounds this to a whole number')
    expect(noteOf(n, 30000)).toBeNull()
    expect(noteOf(n, 3)).toBeNull()
    expect(noteOf(fieldOf('R', 'fo')!, 1.5)).toBe('the mod clamps this to 0…1')
  })

  it('says what an absent key reads as, and that a group passes its defaults down', () => {
    expect(absent(x)).toBe('0')
    expect(absent(fieldOf('R', 'ry')!)).toBe('same as rx')
    expect(absent(fieldOf('YS', 'fo2')!)).toBe('no ramp: fo across the band')
    expect(absent(fieldOf('G', 'o')!)).toBe('1')   // the G's own
    expect(absent(fieldOf('G', 'size')!)).toBe('inherited')
    expect(absent(fieldOf('SCENE', 'sw')!)).toBe("each node's own default")
    expect(absent(fieldOf('SCENE', 'w')!)).toBe('100')
    expect(ownDefault(fieldOf('G', 'kern')!)).toBeUndefined()
    expect(ownDefault(fieldOf('T', 'kern')!)).toBe(1)
  })

  it('shows a value as src writes it, a string as it is', () => {
    expect(shown(undefined)).toBe('')
    expect(shown(Math.fround(0.1))).toBe('0.1')
    expect(shown([1, [2, 3]])).toBe('[1,[2,3]]')
    expect(shown('a b')).toBe('a b')
  })

  it('sets a key in place in its own spelling, appends a new one and removes one', () => {
    const r = node('R', { X: 1, w: 2 })
    expect(Object.entries(withAttr(r, 'x', 5).attrs)).toEqual([['X', 5], ['w', 2]])
    expect(Object.entries(withAttr(r, 'h', 3).attrs)).toEqual([['X', 1], ['w', 2], ['h', 3]])
    expect(Object.entries(withAttr(r, 'x', undefined).attrs)).toEqual([['w', 2]])
    expect(r.attrs).toEqual({ X: 1, w: 2 })   // not changed
    // exact: a group default by its own key only, so G F= gains an f beside it (the F does nothing there)
    const g = node('G', { F: '#f00', o: 1 })
    expect(Object.entries(withAttr(g, 'f', '#0f0', true).attrs)).toEqual([['F', '#f00'], ['o', 1], ['f', '#0f0']])
    expect(Object.entries(withAttr(withAttr(g, 'f', '#0f0', true), 'f', undefined, true).attrs)).toEqual([['F', '#f00'], ['o', 1]])
    expect(Object.entries(withAttr(g, 'F', undefined, true).attrs)).toEqual([['o', 1]])
  })

  it('reads and writes a group default passed down by its exact key, on a G, the SCENE or a block it passes from', () => {
    expect(passedDown(fieldOf('G', 'f')!)).toBe(true)
    expect(passedDown(fieldOf('SCENE', 's_')!)).toBe(true)
    expect(passedDown(fieldOf('G', 'fea_edge')!)).toBe(true)
    // the header's own fit, a shape's own fill and a G's own opacity are read in any case
    expect(passedDown(fieldOf('SCENE', 'fit')!)).toBe(false)
    expect(passedDown(fieldOf('R', 'f')!)).toBe(false)
    expect(passedDown(fieldOf('G', 'o')!)).toBe(false)
  })

  it('collects every $name the scene mentions, sorted, once each', () => {
    const scene = parseSrc('SCENE w=$width\nG t=[$a,"=$b*2"] {\n  R x=$level f="$tank[i]" h=$température y="=$😀+1"\n}\nR w=$level\n').scene!
    expect(dataNames(scene)).toEqual(['a', 'b', 'level', 'tank', 'température', '😀'])
  })

  it('collects a name only where the mod binds one: a T\'s text as its binding reads it, a paint\'s $ binding whole, else a $ or = value', () => {
    const scene = parseSrc(['SCENE w=480 h=480',
      'T x=0 y=0 w=50 h=10 text="Price $5, {$p:%.1f} and {=$q*2}" unit="$u" missing="$m" fmt="$f"',   // unit, missing, fmt are literal
      'T x=0 y=10 w=50 h=10 text="$room kPa"',   // SplitBinding: everything after the $
      'R x=$wx y=20 w=5 h=5 f="$my-colour" s="=if($hot,#f00,#0f0)" id="pad $nope"',
      'T x=0 y=30 w=50 h=10 text="$"', 'R x=0 y=40 w=5 h=5 f="$"',   // a bare $ binds the empty name: no name to send
    ].join('\n') + '\n').scene!
    expect(dataNames(scene)).toEqual(['hot', 'my-colour', 'p', 'q', 'room kPa', 'wx'])
  })

  it('reads every $name of an expression, = or not, where the mod parses one; a literal key reads none', () => {
    const scene = parseSrc(['SCENE w=480 h=480',
      'R x="1+$a" y=0 w=sqrt($b) h=10 v="clamp($c,0,1)" id="$x" f=#fff',   // an expression's leading = is optional
      'T x=0 y=10 w=50 h=10 text=hi oc="$y"',   // oc is a literal colour, an id a literal name
      'G s=["1+$d",1] {\n  R x=0 y=0 w=1 h=1\n}',   // a G's scale pair, an expression per element
      'DEFS {\n  GL id=g x1=0 y1=0 x2=0 y2=1 stops=[["1-$e","$my-stop"],[1,#000]]\n}',   // a stop's position, its $colour whole
    ].join('\n') + '\n').scene!
    expect(dataNames(scene)).toEqual(['a', 'b', 'c', 'd', 'e', 'my-stop'])
  })

  it('reads no name from a literal key', () => {
    const scene = parseSrc('SCENE w=480 h=480\nR x=0 y=0 w=1 h=1 id="$x"\nT x=0 y=0 w=50 h=10 text=hi oc="$y"\nRP n="$z" {\n  R x=0 y=0 w=1 h=1\n}\n').scene!
    expect(dataNames(scene)).toEqual([])
  })
})
