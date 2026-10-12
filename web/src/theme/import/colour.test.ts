import { expect, it } from 'vitest'
import { cssColour } from './colour'

it('colours', () => {
  for (const [text, rgba] of [
    ['#abc', '#AABBCCFF'], ['#abcd', '#AABBCCDD'], ['#abcdef', '#ABCDEFFF'], ['#abcdef12', '#ABCDEF12'],
    ['rgb(255, 0, 128)', '#FF0080FF'], ['rgba(0,0,0,0.55)', '#0000008C'],
    ['rgb(100% 0% 50% / 50%)', '#FF008080'], ['rgba(255 0 128 / .5)', '#FF008080'],
    ['hsl(120 100% 50%)', '#00FF00FF'], ['hsla(.5turn,100%,50%,.5)', '#00FFFF80'],
    // CSS Color 4's sample conversion matrices, rounded to 8-bit sRGB.
    ['oklch(0.7 0.1 150)', '#6FB07DFF'], ['oklab(1 0 0)', '#FFFFFFFF'],
    ['lab(100 0 0)', '#FFFFFFFF'], ['lch(0 0 0)', '#000000FF'],
    ['color(srgb 1 0 .5)', '#FF0080FF'], ['color(srgb-linear .5 0 0)', '#BC0000FF'],
    ['color(display-p3 0 0 0)', '#000000FF'], ['color(a98-rgb 1 1 1)', '#FFFFFFFF'],
    ['color(prophoto-rgb 1 1 1)', '#FFFFFFFF'], ['color(rec2020 1 1 1)', '#FFFFFFFF'],
    ['color(xyz-d50 .9642956764 1 .8251046025)', '#FFFFFFFF'],
    ['color(xyz .9504559271 1 1.0890577508)', '#FFFFFFFF'],
    ['color(xyz-d65 0 0 0)', '#000000FF'], ['rebeccapurple', '#663399FF'], ['transparent', '#00000000'],
  ]) expect(cssColour(text).rgba, text).toBe(rgba)
  expect(cssColour('color(display-p3 1 0 0)')).toEqual({ rgba: '#FF0000FF', outOfGamut: true })
  expect(cssColour('var(--ink, #abc)', name => name === '--ink' ? '#fff' : undefined).rgba).toBe('#FFFFFFFF')
  for (const bad of ['currentColor', 'color-mix(in srgb, red, blue)', 'rgb(1e39 0 0)', 'rgb(1 2)', 'rgb(1, 2 3)', 'lab(NaN 0 0)']) expect(cssColour(bad).rgba, bad).toBeUndefined()
})

it('modern HSL numbers, saturation and angle units', () => {
  expect(cssColour('hsl(120 100 50)').rgba).toBe('#00FF00FF')
  expect(cssColour('hsl(0 200% 75%)')).toEqual({ rgba: '#FF4040FF', outOfGamut: true })
  expect(cssColour('hsla(.5TURN 100% 50% / .5)').rgba).toBe('#00FFFF80')
  expect(cssColour('hsl(0, 100, 50)').rgba).toBeUndefined()
})
