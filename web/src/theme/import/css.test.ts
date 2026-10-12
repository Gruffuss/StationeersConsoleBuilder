import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseCss, resolveVars, readBorder, readRadii, readShadow, readBackground, readFont, readDeclaration } from './css'

it("the worked example's stylesheet", () => {
  const parsed = parseCss(readFileSync(new URL('../../../test/fixtures/design-systems/vanilla-plus/project/components/bundle.css', import.meta.url), 'utf8'))
  expect(parsed.notes).toEqual([])
  expect(parsed.rules).toHaveLength(79)
  const title = parsed.rules.find(r => r.selectors.some(s => s.text === '.ss-screen-title'))!
  expect(readFont(title.decls.find(d => d.prop === 'font')!.value)).toEqual({ weight: 700, size: 36, lineHeight: 1.1, families: ['var(--font-display)'], italic: false })
})

it('CSS syntax, selectors, variables and conditions', () => {
  const parsed = parseCss(`/* a */ @import url(https://example.test/a); @font-face { src: url(no-fetch); }
    @media (width > 0px) { @supports (display: grid) { button.a\\:b#go[data-x="a,b"]:hover > i::before {
      --a: var(--b); --b: var(--a); content: "x;{}"; color: var(--missing, rgb(1,2,3)) !important; background: url("a;b}"); }
    } }`)
  expect(parsed.rules).toHaveLength(1)
  expect(parsed.rules[0].at).toBe('@media (width > 0px) / @supports (display: grid)')
  expect(parsed.rules[0].selectors[0].parts.map(p => p.kind)).toEqual(['type', 'class', 'id', 'attribute', 'pseudo-class', 'combinator', 'type', 'pseudo-element'])
  expect(parsed.rules[0].selectors[0].parts[1].value).toBe('a:b')
  expect(parsed.rules[0].decls.find(d => d.prop === 'color')).toMatchObject({ important: true })
  expect(parsed.notes.join('\n')).toMatch(/@import/)
  expect(parsed.notes.join('\n')).toMatch(/@font-face/)
  expect(resolveVars('var(--missing, rgb(1,2,3))', () => undefined).value).toBe('rgb(1,2,3)')
  expect(resolveVars('var(--a)', name => ({ '--a': 'var(--b)', '--b': 'var(--a)' })[name]).notes.join(' ')).toMatch(/cycle/)
  expect(resolveVars('"var(--x)" url(var(--x)) var(--x)', () => '#fff').value).toBe('"var(--x)" url(var(--x)) #fff')
  expect(parseCss('a { color: red; broken } b { color: blue }').notes.join(' ')).toMatch(/broken/)
})

it('keeps exactly the authored CSS ramp stops without intermediate compensation', () => {
  expect(readBackground('linear-gradient(90deg, #5FD9A8 0%, #2E8B6E 100%)')).toEqual({ gradient: {
    direction: '90deg', stops: [{ colour: '#5FD9A8FF', position: 0 }, { colour: '#2E8B6EFF', position: 100 }] } })
})

it('CSS shorthands and decorations', () => {
  expect(readBorder('2px solid rebeccapurple')).toEqual({ width: 2, style: 'solid', colour: '#663399FF' })
  expect(readRadii('1px 2px 3px')).toEqual({ radii: [1, 2, 3, 2], notes: [] })
  expect(readRadii('2px / 4px').notes.join(' ')).toMatch(/elliptical/)
  expect(readShadow('inset 0 2px 6px rgba(0,0,0,.55)')).toEqual([{ dx: 0, dy: 2, blur: 6, spread: 0, colour: '#0000008C', inset: true }])
  expect(readBackground('linear-gradient(45deg, #f00 20%, #00f 80%)')).toEqual({ gradient: { direction: '45deg', stops: [{ colour: '#FF0000FF', position: 20 }, { colour: '#0000FFFF', position: 80 }] } })
  expect(readFont('italic bold 20px/24px "A B", sans-serif')).toEqual({ italic: true, weight: 700, size: 20, lineHeight: 24, families: ['A B', 'sans-serif'] })
  expect(readDeclaration('clip-path', 'polygon(0 0, 100% 0, 100% 100%)').value).toEqual({ polygon: [[0, 0], ['100%', 0], ['100%', '100%']] })
  expect(readDeclaration('transform', 'rotate(.25turn)').value).toBe(90)
  for (const [prop, value] of [['left','10%'], ['inset','0 2px'], ['display','none'], ['content','""'], ['position','absolute'], ['text-transform','uppercase'], ['letter-spacing','2px'], ['color','red'], ['outline','1px solid red'], ['border-left','1px solid red'], ['width','10px']]) expect(readDeclaration(prop, value).value, prop).toBeDefined()
  const css = parseCss('.a { col\\6f r: red !/**/important; content: "a\\;b"; }')
  expect(css.notes).toEqual([])
  expect(css.rules[0].decls[0]).toEqual({ prop: 'color', value: 'red', important: true })
  expect(readFont('normal 400 20px / 1.1 "A"')).toMatchObject({ size: 20, lineHeight: 1.1 })
  expect(readRadii('-1px').radii).toBeUndefined()
  expect(readBorder('nonsense')).toBeUndefined()
  expect(readDeclaration('clip-path', 'polygon(0 0, 1e39px 0, 10px 10px)').notes).not.toEqual([])
  expect(readDeclaration('rotate', '10deg').notes).not.toEqual([])
  for (const bad of ['linear-gradient()', 'linear-gradient(#f00,)', 'linear-gradient(45deg,)', 'linear-gradient(#f00)']) expect(readBackground(bad), bad).toBeUndefined()
})

it('variables use fallback when a referenced custom property is invalid', () => {
  const vars = (name: string) => new Map([['--cycle', 'var(--cycle)'], ['--missing', 'var(--absent)']]).get(name)
  expect(resolveVars('var(--cycle, #fff)', vars)).toMatchObject({ value: '#fff' })
  expect(resolveVars('var(--missing, #000)', vars)).toMatchObject({ value: '#000' })
  expect(resolveVars('var(--none,)', vars).value).toBe('')
  expect(resolveVars('var(--none, "a,b")', vars).value).toBe('"a,b"')
  const cycle = (name: string) => new Map([['--a','var(--b, red)'], ['--b','var(--a, blue)']]).get(name)
  expect(resolveVars('var(--a, #fff)',cycle).value).toBe('#fff')
  expect(resolveVars('var(--a)',cycle).value).toBeUndefined()
  const chain = new Map(Array.from({ length: 2000 },(_,i) => ['--x' + i, i === 1999 ? '#fff' : 'var(--x' + (i+1) + ')']))
  expect(resolveVars('var(--x0)',name => chain.get(name)).value).toBe('#fff')
})

it.each([18, 30])('variable expansion at %i doubling levels stops without using a fallback', depth => {
  const vars = new Map(Array.from({ length: depth + 1 }, (_, i) => ['--v' + i, i === depth ? '#fff' : 'var(--v' + (i+1) + ') var(--v' + (i+1) + ')']))
  const result = resolveVars('var(--v0, #000)', name => vars.get(name))
  expect(result.notes.join('\n')).toContain('too large to resolve here')
  expect(result.value).toBeUndefined()
  expect(result.notes.join('\n')).not.toMatch(/invalid/)
})

it('empty variable substitutions still spend the expansion work budget', () => {
  const vars = new Map(Array.from({ length: 21 }, (_, i) => ['--v' + i, i === 20 ? '' : 'var(--v' + (i+1) + ')var(--v' + (i+1) + ')']))
  const result = resolveVars('var(--v0)', name => vars.get(name))
  expect(result.notes.join('\n')).toContain('too large to resolve here')
  expect(result.value).toBeUndefined()
})
