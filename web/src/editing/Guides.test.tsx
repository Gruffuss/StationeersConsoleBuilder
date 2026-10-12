import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Guides } from './Guides'

describe('Guides', () => {
  it('draws one line per guide in CSS px, and nothing without guides', () => {
    const css = (u: { x: number; y: number }) => ({ x: u.x * 2, y: u.y * 2 })
    const html = renderToStaticMarkup(<Guides guides={[{ axis: 'x', at: 100, from: 0, to: 50 }, { axis: 'y', at: 5, from: 1, to: 9 }]} css={css} />)
    expect(html).toContain('x1="200" y1="0" x2="200" y2="100"')
    expect(html).toContain('x1="2" y1="10" x2="18" y2="10"')
    expect(renderToStaticMarkup(<Guides guides={[]} css={css} />)).toBe('')
  })
  it('is styled by class in app.css and never takes the pointer', () => {
    const html = renderToStaticMarkup(<Guides guides={[{ axis: 'x', at: 1, from: 0, to: 1 }]} css={u => u} />)
    expect(html).toContain('class="vb-guides"')
    const styles = readFileSync(new URL('../app.css', import.meta.url), 'utf8')
    expect(styles).toMatch(/\.vb-guides \{[^}]*pointer-events: none/)
    expect(styles).toMatch(/\.vb-guides line \{[^}]*stroke:/)
  })
})
