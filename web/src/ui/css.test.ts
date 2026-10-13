import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import catalog from '../catalog/fonts.json'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const cssFiles = readdirSync(new URL('../', import.meta.url), { recursive: true }).filter(f => typeof f === 'string' && f.endsWith('.css')).map(f => f.toString().replace(/\\/g, '/'))
const tokens = Object.fromEntries([...read('./tokens.css').matchAll(/(--f-[\w-]+):\s*([^;]+)/g)].map(m => [m[1], m[2]]))
const scale = Number(/--s:\s*([\d.]+)/.exec(read('./tokens.css'))![1])
// shortcut: inherited sizes use the 12px floor, check the actual parent when introducing smaller relative text.
const fontSize = (value: string, parent = 12, root = 16) => {
  const expanded = value.replace(/var\((--f-[\w-]+)\)/g, (_, key: string) => tokens[key])
    .replace(/calc\(\s*([\d.]+)px\s*\*\s*var\(--s\)\s*\)/g, (_, size: string) => `${Number(size) * scale}px`)
  expect(expanded, 'unsupported font calculation').not.toContain('calc(')
  const size = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|%)/.exec(expanded)
  return size ? Number(size[1]) * ({ px: 1, rem: root, em: parent, '%': parent / 100 }[size[2]]!) : undefined
}

it.each([
  ['0.75rem', 20, 12], ['0.8em', 20, 16], ['75%', 20, 15],
  ['500 calc(24px*var(--s))/1.2 var(--body)', 12, 12],
  ['calc(22px * var(--s))', 12, 11],
])('computes the effective font size of %s', (value, parent, expected) => {
  expect(fontSize(value, parent)).toBe(expected)
})

it('defines the Vanilla + scale and the complete token interface on root', () => {
  const css = read('./tokens.css')
  expect(css).toMatch(/:root\s*\{/)
  expect(css).toMatch(/--s:\s*0\.5\s*;/)
  expect(css).toMatch(/color-scheme:\s*dark/)
  const tokens = ['surface-screen-hi', 'surface-screen', 'surface-screen-lo', 'surface-panel', 'surface-row-hi', 'surface-row', 'surface-row-lo', 'surface-well', 'border', 'border-strong', 'text', 'text-secondary', 'text-muted', 'accent', 'brand-hi', 'brand', 'brand-lo', 'status-ok', 'status-warn', 'status-crit', 'status-idle', 'on-status', 'danger', 'danger-lo', 'display', 'body', 'mono', 'sp1', 'sp2', 'sp3', 'sp4', 'sp5', 'sp6', 'sp7', 'r-xs', 'r-sm', 'r-md', 'r-lg', 'r-xl', 'h-head', 'h-ctl', 'h-row', 'light', 'bar', 'ic', 'well-inset', 'text-drop', 'focus-ring', 'glow-ok', 'glow-warn', 'glow-crit', 'f-hero', 'f-title', 'f-clock', 'f-panel', 'f-button', 'f-chip', 'f-value-lg', 'f-value', 'f-reading', 'f-message', 'f-unit', 'f-code', 'ls-title', 'ls-panel', 'ls-button', 'ls-chip']
  for (const token of tokens) expect(css, token).toContain(`--${token}:`)
  const sizes = [...css.matchAll(/--f-[\w-]+:\s*[^;]*?calc\(\s*(\d+)px\s*\*\s*var\(--s\)\)/g)].map(m => Number(m[1]))
  expect(sizes).toHaveLength(12)
  expect(Math.min(...sizes)).toBe(24)
})

it('isolates the canvas inherited text environment', () => {
  const stage = /\.vb-stage\s*\{([^}]+)\}/.exec(read('./base.css'))![1]
  for (const declaration of ['font: 14px system-ui, sans-serif', 'color: #d6dde6', 'font-variant-numeric: normal', 'text-shadow: none', 'letter-spacing: normal', 'text-transform: none']) expect(stage).toContain(declaration)
})

it('has no sub-12px text or preview family names in chrome CSS', () => {
  expect(cssFiles).toContain('ui/tokens.css')
  for (const file of cssFiles) {
    const css = read(`../${file}`)
    for (const match of css.matchAll(/(?:font-size|font)\s*:\s*([^;{}]+)/g)) {
      const size = fontSize(match[1])
      if (size !== undefined) expect(size, `${file}: ${match[0]}`).toBeGreaterThanOrEqual(12)
    }
    for (const match of css.matchAll(/(?:font-family|font|--display|--body|--mono)\s*:\s*([^;{}]+)/g)) {
      const families = [...match[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')), ...[...match[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1])]
      for (const family of families) expect(catalog.faces.map(f => f.name), file).not.toContain(family)
    }
  }
})
it('keeps native modal dialogs fixed even when the page scrolls', () => {
  expect(read('./base.css')).toMatch(/dialog\.dlg\s*\{[^}]*position:\s*fixed/)
})
it('positions the shell scroll areas, so visually hidden labels scroll inside them instead of stretching the page', () => {
  // A .vh label is position: absolute; with an unpositioned scroll area it is placed against a box outside it and
  // escapes its scrolling (a long Layers tree made the whole page scroll, 2026-10-13).
  const rules = [...read('../app.css').matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ selectors: m[1].split(',').map(s => s.trim()), body: m[2] }))
  for (const area of ['.vb-sidebar', '.vb-inspector', '.vb-statusbar'])
    expect(rules.some(r => r.selectors.includes(area) && /position:\s*relative/.test(r.body)), area).toBe(true)
})
