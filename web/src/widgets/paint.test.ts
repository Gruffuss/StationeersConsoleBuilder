import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SrcNode } from '../model/scene'
import { checkScene } from '../srctext/check'
import { printChecked } from '../srctext/print'
import { colourProblem } from '../srctext/validate'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import {
  body, chip, gradientDef, hasGradient, ink, keyOf, label, lights, literal, num, plainTextProblem, plus, raised, ring, shadow, st4, textNames, well,
} from './paint'

const line = (n: SrcNode) => printChecked({ header: {}, defs: [], root: [n] }).trim()

describe('tokens to literals', () => {
  it('state colours are colour expressions over a state number', () => {
    expect(st4(t, '$a')).toBe('=if(eq($a,1),#7FD970,if(eq($a,2),#F2B233,if(eq($a,3),#F7777A,#A6A6B4)))')
    expect(ink(t, '$a[i]', '#FFFFFF')).toBe('=if(eq($a[i],2),#F2B233,if(eq($a[i],3),#F7777A,#FFFFFF))')
    expect(colourProblem(st4(t, '$a'))).toBeNull()
    expect(colourProblem(ink(t, '$a[i]', '#FFFFFF'))).toBeNull()
  })
  it('shadows resolve their roles; gradients become theme_ defs', () => {
    expect(shadow(t, 'glowOk')).toEqual([[0, 0, 10, 0, '#7FD970']])
    expect(shadow(t, 'wellInset')).toEqual([[0, 2, 6, 0, '#0000008C', 'inset']])
    expect(line(gradientDef(t, 'row'))).toBe('GL id=theme_row units=bbox x1=0 y1=0 x2=0 y2=1 stops=[[0,#3B3B45],[1,#32323A]]')
  })
  it('a position moves as a number, or as an expression; a slot has a default data name', () => {
    expect(plus(24, 0.5)).toBe(24.5)
    expect(plus('=24+i*56', 0.5)).toBe('=24+i*56+0.5')
    expect(plus('=24+i*56', -2)).toBe('=24+i*56-2')
    expect(keyOf({ keys: { st: 'o2_st' } }, 'lt1', 'st')).toBe('o2_st')
    expect(keyOf({ keys: {} }, 'lt1', 'st')).toBe('lt1_st')
  })
  it('write numbers an expression can read: digits and a point, never an exponent, NaN or Infinity', () => {
    // Expression.cs ReadNumber reads digits and '.' only; '=a+1e-7' stops at 'e' and the attribute falls back.
    expect(num(1e-7)).toBe('0.0000001')
    expect(num(-5.551115e-17)).toBe('-0.00000000000000005551115')
    expect(num(1e21)).toBe('1000000000000000000000')
    expect(num(24.5)).toBe('24.5')
    expect(num(-0)).toBe('0')
    expect(num(NaN)).toBe('0')
    expect(num(Infinity)).toBe('340282350000000000000000000000000000000')
    expect(num(-1e39)).toBe('-340282350000000000000000000000000000000')
    expect(plus('=a', 1e-7)).toBe('=a+0.0000001')
  })
  it('name only gradients and shadows the theme has', () => {
    expect(hasGradient(t, 'row')).toBe(true)
    expect(hasGradient(t, 'x')).toBe(false)
    expect(hasGradient(t, 'toString')).toBe(false)
    expect(() => gradientDef(t, 'x')).toThrow('the theme "Vanilla +" has no gradient "x"')
    expect(() => shadow(t, 'constructor')).toThrow('the theme "Vanilla +" has no shadow "constructor"')
  })
})

describe('labels', () => {
  it('refuse what src would not read as plain text', () => {
    expect(plainTextProblem('Pump B')).toBeNull()
    expect(plainTextProblem('12')).toBeNull()
    expect(plainTextProblem('$x')).toBe('a label cannot start with $: use a Text widget for data')
    expect(plainTextProblem('a {$b}')).toBe('a label cannot hold {$ or {=: use a Text widget for data')
    expect(plainTextProblem('{=1+2} and }')).toBe('a label cannot hold {$ or {=: use a Text widget for data')
  })
  it('take every other text, which prints as written: numbers through a template, = and an unclosed placeholder as they are', () => {
    // labels.json's templates are printed through the mod by the C# suite (FrameTests), each reading as its text.
    const pairs = new Map<string, string>(JSON.parse(readFileSync(new URL('../../test/fixtures/labels.json', import.meta.url), 'utf8')))
    for (const s of ['1e5', 'Infinity', '-0', '=x', '=1+2', 'price {$a', 'a {=b']) {
      expect(plainTextProblem(s)).toBeNull()
      expect(literal(t, 'value', s)).toBe(pairs.get(s))
    }
  })
  it('uppercase by style, and turn plain digits into a template', () => {
    expect(literal(t, 'button-label', 'Vent bay')).toBe('VENT BAY')
    expect(literal(t, 'value', 'Furnace bay')).toBe('Furnace bay')
    expect(literal(t, 'value', '12')).toBe('{=12:%.0f}')
    expect(literal(t, 'value', '-1.25')).toBe('{=-1.25:%.2f}')
  })
  it('print any text src reads as a number as written, through documented placeholders only', () => {
    // [text, its template]: the mod drops printf width and flags, a float32 holds about 7 digits, and NaN or Infinity hold
    // no digit, so one character goes into a placeholder: the last digit through %.0f, else the last hex letter through
    // %x or %X. The C# suite prints each template through the mod (FrameTests: labels.json).
    const pairs: [string, string][] = JSON.parse(readFileSync(new URL('../../test/fixtures/labels.json', import.meta.url), 'utf8'))
    expect(pairs.length).toBeGreaterThan(8)
    for (const [text, template] of pairs) {
      expect(literal(t, 'value', text)).toBe(template)
      const c = checkScene({ header: {}, defs: [], root: [label(t, 'value', { x: 0, y: 0, w: 99, h: 50 }, template)] })
      expect(c.errors).toEqual([])
      expect(c.warnings.map(w => w.message)).toEqual(text.includes('{$') || text.includes('{=') ? [expect.stringContaining('never closed')] : [])
    }
    expect(literal(t, 'button-label', 'Infinity')).toBe('IN{=15:%X}INITY')
    expect(literal(t, 'value', ' 12 ')).toBe(' 1{=2:%.0f} ')
  })
  it('know which data names a text reads, as the mod does', () => {
    expect(textNames('{$a:%.1f} kPa {=$b*2+$c:%.0f} and $d')).toEqual(['a', 'b', 'c'])
    expect(textNames('$room')).toEqual(['room'])
    expect(textNames('$rows[i]')).toEqual(['rows'])
    expect(textNames('Pump $name here')).toEqual([])
    expect(textNames('{$température:%.1f} °C {=$débit*2}')).toEqual(['température', 'débit'])
    expect(textNames('$température')).toEqual(['température'])
  })
  it('read names as SceneModel.TextTemplate and SplitBinding do', () => {
    // A placeholder runs to its first }; one never closed is literal text, and so is everything after it.
    expect(textNames('price {$a')).toEqual([])
    expect(textNames('{$a} {$b')).toEqual(['a'])
    expect(textNames('set {$a} {=$b')).toEqual(['a'])
    // A text whose first character is $ binds everything after it, up to a trailing [index], as one name.
    expect(textNames('$5.00')).toEqual(['5.00'])
    expect(textNames('$a {$b}')).toEqual(['a {$b}'])
    expect(textNames('$rows[]')).toEqual(['rows[]'])
    // Data read inside an index or an expression; a name is what the expression lexer reads (letters, digits, _).
    expect(textNames('$rows[$k]')).toEqual(['rows', 'k'])
    expect(textNames('{$rows[$k]:%.1f} of {$my-name}')).toEqual(['rows', 'k', 'my-name'])
    // A binding's format follows the first ':' outside its index, so a ] or [ in the format is literal (0.11.97).
    expect(textNames('{$v:%.1f [kPa]} {$a[i]:%d]} {$b:[%d} {$c[$k]:x]y}')).toEqual(['v', 'a', 'b', 'c', 'k'])
    expect(textNames('{=since($jump)+$é1:%.0f} {=$ x}')).toEqual(['jump', 'é1'])
    // Since vector 0.11.98 an expression name takes a supplementary-plane character whole; an unpaired half ends it.
    expect(textNames('{=$x\u{1D49C}*2:%.0f} {$rows[$\u{1F600}]} {=$a\uD835b}')).toEqual(['x\u{1D49C}', 'rows', '\u{1F600}', 'a'])
  })
  it('scan in linear time, whatever the text', () => {
    for (const s of ['{='.repeat(500_000), '{$'.repeat(500_000), '{=}'.repeat(300_000) + '{$', '$' + '$['.repeat(500_000) + ']'])
      expect(textNames(s).length).toBeLessThan(2)
    // Any number of names in one placeholder or index: no spread into arguments, which overflows the stack near 125k.
    expect(textNames('{=' + '$a'.repeat(300_000) + '}')).toHaveLength(300_000)
    expect(textNames('{$a[' + '$k'.repeat(300_000) + ']}')).toHaveLength(300_001)
  })
  it('carry their style', () => {
    expect(line(label(t, 'value', { x: 39, y: 104, w: 234, h: 50 }, 'Furnace bay', { fit: true })))
      .toBe('T x=39 y=104 w=234 h=50 text="Furnace bay" size=28 font="Barlow SemiBold" f=#FFFFFF sh=[[0,2,2,0,#00000099]] valign=middle fit=ellipsis')
    expect(line(label(t, 'chip-label', { x: 0, y: 0, w: 86, h: 34.8 }, 'OK', { align: 'center', v: '=eq($s,1)' })))
      .toBe('T v==eq($s,1) x=0 y=0 w=86 h=34.8 text=OK size=24 font="Barlow Condensed Bold" cspace=2.08 f=#17171B align=center valign=middle')
    expect(line(label(t, 'unit', { x: 0, y: 0, w: 64, h: 89.6 }, '%', { size: 64 }))).toContain('size=64 font="Barlow Medium"')
    expect(line(label(t, 'value', { x: 0, y: 0, w: 9, h: 50 }, '$a[i]', { fit: true, missing: true }))).toContain('fit=ellipsis missing=""')
  })
})

describe('shared pieces', () => {
  it('keep strokes inside their box, and the focus ring outside; a box thinner than its stroke draws no negative size', () => {
    expect(line(raised(t, 24, 104, 440, 50))).toBe('R x=24.5 y=104.5 w=439 h=49 rx=5.5 f=@theme_row s=#5A5A69 sw=1')
    expect(line(well(t, 24, 300, 400, 30))).toBe('R x=24.5 y=300.5 w=399 h=29 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    expect(line(well(t, 0, 0, 0, 0))).toBe('R x=0.5 y=0.5 w=0 h=0 rx=3.5 f=#111116 s=#5A5A69 sw=1')
    expect(line(body(t, 'primary', 0, 0, 1, 1))).toContain(' w=0 h=0 ')
    expect(line(ring(t, 24, 500, 200, 54))).toBe('R x=22.5 y=498.5 w=203 h=57 rx=7.5 f=none s=#FF772D sw=3')
    expect(line(ring(t, 24, 500, 200, 54, '=$s'))).toBe('R v==$s x=22.5 y=498.5 w=203 h=57 rx=7.5 f=none s=#FF772D sw=3')
  })
  it('draw the three button bodies, pressed by down', () => {
    expect(line(body(t, 'secondary', 24, 500, 200, 54))).toBe('R x=24.5 y=500.5 w=199 h=53 rx=5.5 f=@theme_row s=#5A5A69 sw=1 fo==1-0.25*down')
    expect(line(body(t, 'primary', 24, 500, 200, 54))).toBe('R x=25 y=501 w=198 h=52 rx=5 f=@theme_brand s=#FF772D sw=2 fo==1-0.25*down')
    expect(line(body(t, 'danger', 24, 500, 200, 54))).toBe('R x=24 y=500 w=200 h=54 rx=6 f=@theme_danger fo==1-0.25*down')
    expect(() => body(t, 'primray', 0, 0, 10, 10)).toThrow('no button body "primray"')
  })
  it('draw a light as four variants, three of them glowing', () => {
    expect(lights(t, 48, 129, 9, 9, '$lt1_st').map(line)).toEqual([
      'C v==1-eq($lt1_st,1)-eq($lt1_st,2)-eq($lt1_st,3) cx=48 cy=129 rx=9 ry=9 f=#A6A6B4',
      'C v==eq($lt1_st,1) cx=48 cy=129 rx=9 ry=9 f=#7FD970 sh=[[0,0,10,0,#7FD970]]',
      'C v==eq($lt1_st,2) cx=48 cy=129 rx=9 ry=9 f=#F2B233 sh=[[0,0,10,0,#F2B233]]',
      'C v==eq($lt1_st,3) cx=48 cy=129 rx=9 ry=9 f=#F7777A sh=[[0,0,10,0,#F7777A]]',
    ])
  })
  it('draw a chip and its three words', () => {
    const c = chip(t, 39, 407.6, '$al1_st').map(line)
    expect(c[0]).toBe('R x=39 y=407.6 w=86 h=34.8 rx=4 f==if(eq($al1_st,1),#7FD970,if(eq($al1_st,2),#F2B233,if(eq($al1_st,3),#F7777A,#A6A6B4)))')
    expect(c.slice(1).map(l => l.match(/v==eq\(\$al1_st,(\d)\).*text=(\w+)/)!.slice(1))).toEqual([['1', 'OK'], ['2', 'WARN'], ['3', 'CRIT']])
  })
})
