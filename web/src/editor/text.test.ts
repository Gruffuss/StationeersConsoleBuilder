import { describe, expect, it } from 'vitest'
import type { FrameText } from '../runtime/frame'
import { label } from '../runtime/testing'
import { clipStyle, drawable, innerStyle, labelStyle, sameLabels, stripRichText, textRuns, toLabel } from './text'

describe('stripRichText', () => {
  it('removes TMP tags', () => {
    expect(stripRichText('code face: <b>0123</b> 456')).toBe('code face: 0123 456')
    expect(stripRichText('<color=#FF0000>hot</color>')).toBe('hot')
    expect(stripRichText('<size=20>big</size> <font="code">mono</font>')).toBe('big <font="code">mono</font>')
  })
  it('keeps a < that opens no tag', () => {
    expect(stripRichText('a < b')).toBe('a < b')
    expect(stripRichText('x<y> and 1<2')).toBe('x<y> and 1<2')
  })
})

describe('font runs', () => {
  it.each([
    ['20',20],['20px',20],['+5',45],['-5',35],['2em',80],['2e',80],['50%',20],
  ])('uses the base size for nested <size=%s>', (form, size) => {
    const runs=textRuns(label({size:40,text:'<size=2em>a<size='+form+'>b</size>c</size>d'}))
    expect(runs.map(r=>r.size)).toEqual([80,size,80,40])
  })
  it.each([['2',2],['2px',2],['2em',160]])('uses current size only for em cspace=%s', (form, units) => {
    const runs=textRuns(label({size:40,charSpacing:5,text:'<size=2em><cspace='+form+'>ab</cspace>c</size>d'}))
    expect(runs[0].spacing*80).toBeCloseTo(2+units)
    expect(runs[0]).toHaveProperty('trailing',-units)
    expect(runs.at(-1)!.spacing*40).toBe(2)
  })
  it('keeps rejected percentage cspace literal', () => {
    expect(stripRichText('<cspace=10%>x</cspace>')).toBe('<cspace=10%>x</cspace>')
  })
  it.each(['font-weight=abc','font-weight=','i='])('ignores malformed <%s> inside valid styles', tag => {
    const runs=textRuns(label({text:'<b><i=60>a<'+tag+'>b</'+tag.split('=')[0]+'>c</i></b>'}))
    expect(runs.map(r=>[r.weight,r.italic,r.italicStyle])).toEqual([[700,true,60],[700,true,60],[700,true,60]])
  })

  it('keeps weight independent of a named face and restores clamped italic angles', () => {
    const runs = textRuns(label({ font: 'Barlow Bold', text: '<i=20>a<i=999>b</i>c</i>d<i=-999>e</i>' }))
    expect(runs.map(r => [r.text, r.weight, r.italic, r.italicStyle])).toEqual([
      ['a', 400, true, 20], ['b', 400, true, 180], ['c', 400, true, 20], ['d', 400, false, undefined], ['e', 400, true, -180],
    ])
  })
  it('keeps unknown font tags literal and accepts all characters without filtering', () => {
    const text = '<font="Absent">\u6f22\u5b57 \u{1fa90} \u1eaf</font>'
    expect(textRuns(label({ font: 'Barlow', text })).map(r => r.text).join('')).toBe(text)
    expect(textRuns(label({ font: 'Barlow SemiBold', text: '<i>x</i><font-weight=400>y</font-weight>' })).map(r => [r.text, r.weight, r.italic])).toEqual([['x', 400, true], ['y', 400, false]])
  })
  it('ends a quoted font name before trailing material attributes and restores nested names', () => {
    const text = `<font="Barlow" material="X">a<font='Barlow Medium' material='Y'>b</font>c</font>d`
    expect(textRuns(label({ text })).map(r => [r.text, r.font])).toEqual([
      ['a', 'Barlow'], ['b', 'Barlow Medium'], ['c', 'Barlow'], ['d', null],
    ])
  })
  it('keeps all spellings of br as newlines while restoring nested font styles', () => {
    expect(textRuns(label({ text: 'a<br/>b<br />c<BR>d' })).map(r => r.text).join('')).toBe('a\nb\nc\nd')
    expect(textRuns(label({ text: '<b>a<i>b</i>c</b>d' })).map(r => [r.text, r.weight, r.italic])).toEqual([
      ['a', 700, false], ['b', 700, true], ['c', 700, false], ['d', 400, false],
    ])
  })
})

describe('labelStyle', () => {
  it('places and sizes the box in CSS px', () => {
    expect(labelStyle(label(), 2)).toMatchObject({ position: 'absolute', left: 20, top: 40, width: 60, height: 80, fontSize: 24 })
  })
  it('rotates counter-clockwise as the game does', () => {
    expect(labelStyle(label({ rotation: 90 }), 1).transform).toContain('rotate(-90deg)')
  })
  it('aligns horizontally', () => {
    expect(labelStyle(label({ align: 1 }), 1).textAlign).toBe('center')
  })
  it('aligns vertically with a column flex', () => {
    expect(labelStyle(label({ valign: 2 }), 1)).toMatchObject({ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' })
  })
  it('keeps one line without wrap', () => {
    expect(labelStyle(label({ wrap: false }), 1).whiteSpace).toBe('pre')
  })
  it('truncates with an ellipsis for fit 1', () => {
    expect(labelStyle(label({ fit: 1 }), 1)).toMatchObject({ textOverflow: 'ellipsis', overflow: 'hidden' })
  })
  it('writes the colour as rgba', () => {
    expect(labelStyle(label({ colour: [1, 0, 0, 0.5] }), 1).color).toBe('rgba(255,0,0,0.5)')
  })
  it('falls back to Liberation Sans', () => {
    expect(String(labelStyle(label({ font: null }), 1).fontFamily)).toMatch(/^"Liberation Sans"/)
  })
  it('draws a label in its face first', () => {
    expect(String(labelStyle(label({ font: 'Barlow SemiBold' }), 1).fontFamily)).toMatch(/^"Barlow SemiBold"/)
  })
  it('uses real bundled bold faces without synthesis', () => {
    expect(labelStyle(label({ font: 'Barlow', bold: true }), 1)).toMatchObject({ fontFamily: '"Barlow Bold", "Liberation Sans", Arial, Helvetica, sans-serif', fontWeight: 'normal', fontSynthesis: 'none' })
    expect(labelStyle(label({ font: 'Barlow Medium', bold: true }), 1)).toMatchObject({ fontWeight: 'normal', fontSynthesis: 'none' })
    expect(labelStyle(label({ font: 'Barlow Condensed SemiBold', bold: true }), 1)).toMatchObject({
      fontFamily: '"Barlow Condensed Bold", "Liberation Sans", Arial, Helvetica, sans-serif', fontWeight: 'normal', fontSynthesis: 'none',
    })
    expect(labelStyle(label({ bold: true }), 1)).toMatchObject({ fontWeight: 'normal', fontSynthesis: 'none', letterSpacing: '0.07em' })
  })
  it('turns kerning off with kern', () => {
    expect(labelStyle(label({ kern: false }), 1).fontKerning).toBe('none')
    expect(labelStyle(label(), 1).fontKerning).toBe('normal')
  })
  it('draws every outset shadow, the first listed first', () => {
    const s = labelStyle(label({ shadow: [0, 1, 2, 0, 0, 0, 1], extraShadows: [0, 2, 3, 1, 0, 0, 1] }), 1)
    expect(s.textShadow).toBe('0px 1px 2px rgba(0,0,0,1), 0px 2px 3px rgba(255,0,0,1)')
  })
  it('shears in the label space, under its rotation, y flipped', () => {
    expect(String(labelStyle(label({ shear: [1, 0.5, 0, 1] }), 1).transform)).toMatch(/matrix\(1, 0, -0\.5, 1, 0, 0\)$/)
  })
  it('offsets later shadows along the surface axes, as the game moves their copies; the first turns with the label', () => {
    // Under this shear a label-space (1, 2) lands on the surface's (0, 2).
    const s = labelStyle(label({ shear: [1, 0.5, 0, 1], shadow: [0, 2, 3, 0, 0, 0, 1], extraShadows: [0, 2, 3, 1, 0, 0, 1] }), 1)
    expect(s.textShadow).toBe('0px 2px 3px rgba(0,0,0,1), 1px 2px 3px rgba(255,0,0,1)')
  })
  // M1's mappings (B17), characterized.
  it('spaces letters in hundredths of an em', () => {
    expect(labelStyle(label({ charSpacing: 5 }), 1).letterSpacing).toBe('0.05em')
  })
  it('sets the line height only when there is one', () => {
    expect(labelStyle(label({ lineHeight: 1.2 }), 1).lineHeight).toBe(1.2)
    expect(labelStyle(label({ lineHeight: 0 }), 1)).not.toHaveProperty('lineHeight')
  })
  it('strokes the outline under the fill, scaled by the zoom', () => {
    expect(labelStyle(label({ outlineWidth: 2, outlineColour: [1, 0, 0, 1] }), 2))
      .toMatchObject({ WebkitTextStroke: '4px rgba(255,0,0,1)', paintOrder: 'stroke fill' })
  })
})

describe('clipStyle', () => {
  it('cuts the clip box to its polygon, relative to the box', () => {
    expect(clipStyle(label({ clip: [10, 10, 20, 20], clipPolygon: [10, 10, 30, 10, 30, 30] }), 1).clipPath)
      .toBe('polygon(0px 0px, 20px 0px, 20px 20px)')
  })
  it('is the clip box alone when the clip is a box', () => {
    expect(clipStyle(label({ clip: [10, 10, 20, 20] }), 2))
      .toEqual({ position: 'absolute', left: 20, top: 20, width: 40, height: 40, overflow: 'hidden' })
  })
})

describe('innerStyle', () => {
  const at = (fit: number, align: number, wrap = false) => innerStyle(label({ fit, align, wrap }))
  it('lets a centred or right-aligned line outgrow its box both ways or to the left, as TMP does; keeps the ellipsis on fit 1', () => {
    expect(at(0, 1)).toEqual({ display: 'flex', justifyContent: 'center' })
    expect(at(0, 2)).toEqual({ display: 'flex', justifyContent: 'flex-end' })
    expect(at(0, 0)).toEqual({ overflow: 'inherit', textOverflow: 'inherit' })
    expect(at(1, 2)).toEqual({ overflow: 'inherit', textOverflow: 'inherit' })
    expect(at(2, 1)).toEqual({ overflow: 'inherit', textOverflow: 'inherit' })
    expect(at(0, 1, true)).toEqual({ overflow: 'inherit', textOverflow: 'inherit' })
  })
})

describe('sameLabels', () => {
  const list = () => [label(), label({ text: 'b', clip: [0, 0, 5, 5], shadow: [1, 1, 2, 0, 0, 0, 1] })]
  it('is true for equal lists from different frames', () => {
    expect(sameLabels(list(), list())).toBe(true)
  })
  it('is false when anything a label draws with differs', () => {
    expect(sameLabels(list(), list().slice(1))).toBe(false)
    const changed: Partial<FrameText>[] = [{ x: 11 }, { text: 'c' }, { colour: [1, 1, 1, 0.5] }, { clip: [0, 0, 5, 6] },
      { clip: null }, { shadow: [1, 1, 3, 0, 0, 0, 1] }, { rotation: 1 }, { font: 'code' }, { wrap: true }]
    for (const over of changed) expect(sameLabels(list(), [list()[0], { ...list()[1], ...over }])).toBe(false)
  })
})

describe('drawable', () => {
  it('skips a label whose geometry is not finite', () => {
    expect(drawable(label())).toBe(true)
    for (const k of ['x', 'y', 'w', 'h', 'size'] as const) {
      expect(drawable(label({ [k]: NaN }))).toBe(false)
      expect(drawable(label({ [k]: Infinity }))).toBe(false)
    }
    expect(drawable(label({ clip: [0, 0, NaN, 10] }))).toBe(false)
  })
  it('skips a label whose shear, shadows or clip outline is not finite', () => {
    const bad: Partial<FrameText>[] = [{ shear: [1, NaN, 0, 1] }, { shadow: [0, 0, Infinity, 0, 0, 0, 1] },
      { extraShadows: [0, 0, 1, 0, 0, 0, NaN] }, { insetShadow: [NaN, 0, 1, 0, 0, 0, 1] }, { clip: [0, 0, 9, 9], clipPolygon: [0, 0, 9, -Infinity, 9, 9] }]
    for (const over of bad) expect(drawable(label(over))).toBe(false)
  })
})

describe('toLabel', () => {
  it('turns a surface vector back through the rotation into the box axes', () => {
    const [u, v] = toLabel(label({ rotation: 90 }), 0, 2)   // down the screen is the label's -x when it is turned up
    expect(u).toBeCloseTo(-2)
    expect(v).toBeCloseTo(0)
  })
  it('and through the shear', () => {
    expect(toLabel(label({ shear: [1, 0.5, 0, 1] }), 0, 2)).toEqual([1, 2])
  })
})
