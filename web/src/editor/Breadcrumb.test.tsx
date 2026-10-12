// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Scene } from '../model/scene'
import { node } from '../model/testing'
import { Breadcrumb } from './Breadcrumb'
import { mount } from '../testing'

describe('Breadcrumb', () => {
  it('separates the unchanged crumb text with hidden chevrons', () => {
    const scene: Scene = { header: {}, defs: [], root: [node('G', { id: 'outer' }, [node('G', { id: 'inner' }, [node('R', { id: 'box' })])])] }
    const ui = mount(<Breadcrumb scene={scene} selection={{ pageId: 'p1', path: [0, 0, 0] }} dispatch={() => {}} />)
    try {
      expect(Array.from(ui.container.querySelectorAll('button')).map(b => b.textContent)).toEqual(['G#outer', 'G#inner', 'R#box'])
      const chevrons = Array.from(ui.container.querySelectorAll('svg'))
      expect(chevrons).toHaveLength(2)
      expect(chevrons.every(svg => svg.getAttribute('aria-hidden') === 'true')).toBe(true)
      expect(ui.container.querySelector('nav.raised')).not.toBeNull()
    } finally { ui.unmount() }
  })
  it('shows the entered group even with no selection', () => {
    const scene: Scene = { header: {}, defs: [], root: [node('G', { id: 'outer' }, [node('G', { id: 'inner' }, [node('R')])])] }
    const html = renderToStaticMarkup(<Breadcrumb scene={scene} selection={null} entered={{ pageId: 'p1', path: [0, 0] }} dispatch={() => {}} />)
    expect(html).toContain('G#outer')
    expect(html).toContain('G#inner')
    expect(html).toContain('entered')
  })
  it('says as text why the selected node cannot move; nothing for one a move moves on one axis (M2c moveBy)', () => {
    const scene: Scene = { header: {}, defs: [], root: [node('R', { x: '=i', y: '$y', w: 1, h: 1 }), node('R', { x: '=i', y: 0, w: 1, h: 1 })] }
    const html = (path: number[]) => renderToStaticMarkup(<Breadcrumb scene={scene} selection={{ pageId: 'p1', path }} dispatch={() => {}} />)
    expect(html([0])).toContain('locked: x is an expression; y is an expression')
    expect(html([1])).not.toContain('locked')
  })
})
