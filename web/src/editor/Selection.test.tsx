import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { indexOfNode } from '../model/numbering'
import type { Scene, SrcNode } from '../model/scene'
import { node } from '../model/testing'
import { decodeFrame, type Frame, type FrameText } from '../runtime/frame'
import { label, vbf1 } from '../runtime/testing'
import { Selection } from './Selection'

const element = { id: 'scene', scene: 'p1', x: 0, y: 0, w: 460, h: 460, firstVertex: 0, vertexCount: 0 }
/**
 * The selection's markup for `root`, with `path` selected and these labels in the frame. Its parse index is its written
 * index (no USE here), or `node` when given.
 */
function draw(root: SrcNode[], path: number[], text: FrameText[] = [], geometry: Partial<Frame> = {}, pageId = 'p1',
  node: number | null = indexOfNode(root, path)) {
  const scene: Scene = { header: { w: 460, h: 460 }, defs: [], root }
  const frame = { ...decodeFrame(vbf1(JSON.stringify({ elements: [element], text, problems: [] }))), ...geometry }
  const html = renderToStaticMarkup(<Selection frame={frame} zoom={1} scene={scene} selection={{ pageId, path }} node={node}
    rect={{ w: 460, h: 460 }} handles />)
  const count = (s: string) => html.split(s).length - 1
  return { html, handles: count('vb-handle'), polygons: count('<polygon'), locks: count('vb-lock') }
}

describe('Selection', () => {
  it('outlines a widget root by its box, with only the handles its module allows, and no padlock', () => {
    const scene: Scene = { header: { w: 460, h: 460 }, defs: [], root: [node('G', { id: 'w1' }, [node('R', { x: 1, y: 2, w: 3, h: 4 })])] }
    const frame = decodeFrame(vbf1(JSON.stringify({ elements: [element], text: [], problems: [] })))
    const html = renderToStaticMarkup(<Selection frame={frame} zoom={1} scene={scene} selection={{ pageId: 'p1', path: [0] }} node={0}
      rect={{ w: 460, h: 460 }} handles widget={{ box: { x: 10, y: 10, w: 100, h: 54 }, handles: ['e', 'w'] }} />)
    expect(html.split('<polygon').length - 1).toBe(2)
    expect(html).toContain('points="10,10 110,10 110,64 10,64"')
    expect(html.split('vb-handle').length - 1).toBe(2)
    expect(html).toContain('vb-knob')
    expect(html).not.toContain('vb-lock')
  })
  it('draws a widget root\'s handles only when told to, and none under # lock; the outline stays', () => {
    const draw = (handles: boolean, comments?: string[]) => {
      const root = [{ ...node('G', { id: 'w1' }, [node('R', { x: 1, y: 2, w: 3, h: 4 })]), ...(comments && { comments }) }]
      const frame = decodeFrame(vbf1(JSON.stringify({ elements: [element], text: [], problems: [] })))
      return renderToStaticMarkup(<Selection frame={frame} zoom={1} scene={{ header: { w: 460, h: 460 }, defs: [], root }}
        selection={{ pageId: 'p1', path: [0] }} node={0} rect={{ w: 460, h: 460 }} handles={handles}
        widget={{ box: { x: 10, y: 10, w: 100, h: 54 }, handles: ['e', 'w'] }} />)
    }
    expect(draw(false).split('vb-handle').length - 1).toBe(0)
    const locked = draw(true, ['lock', 'widget bar w1 {}'])
    expect(locked.split('vb-handle').length - 1).toBe(0)
    expect(locked.split('<polygon').length - 1).toBe(2)
  })

  it('draws nothing over a frame from another page', () => {
    expect(draw([node('R', { x: 1, y: 2, w: 3, h: 4 })], [0], [], {}, 'p2').html).toBe('')
  })

  it('outlines a literal box without a parse index (a structural edit waits for its check), and nothing else then', () => {
    const d = draw([node('R', { x: 1, y: 2, w: 3, h: 4 })], [0], [], {}, 'p1', null)
    expect(d.polygons).toBe(2)
    expect(d.handles).toBe(8)
    expect(draw([node('USE', { ref: 's' })], [0], [], {}, 'p1', null).html).toBe('')
  })
  it('outlines a group by its children\'s box in its own frame, with handles and a knob; no handles when told not to', () => {
    const d = draw([node('G', { t: [10, 0] }, [node('R', { x: 1, y: 2, w: 3, h: 4 })])], [0], [], {}, 'p1', null)
    expect(d.html).toContain('points="11,2 14,2 14,6 11,6"')
    expect(d.handles).toBe(8)
    expect(d.html).toContain('vb-knob')
    const scene: Scene = { header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 1, y: 2, w: 3, h: 4 })] }
    const frame = decodeFrame(vbf1(JSON.stringify({ elements: [element], text: [], problems: [] })))
    const html = renderToStaticMarkup(<Selection frame={frame} zoom={1} scene={scene} selection={{ pageId: 'p1', path: [0] }} node={0}
      rect={{ w: 460, h: 460 }} handles={false} />)
    expect(html.split('vb-handle').length - 1).toBe(0)
  })

  it('outlines a literal box through its chain, with resize handles', () => {
    const d = draw([node('R', { x: 1, y: 2, w: 3, h: 4 })], [0])
    expect(d.polygons).toBe(2)
    expect(d.handles).toBe(8)
    expect(d.locks).toBe(0)
  })

  it('shows neither handles nor a padlock when only the resize is locked', () => {
    const d = draw([node('T', { x: 1, y: 2, w: '$w', h: 4, text: 'hi' })], [0], [label({ node: 0 })])
    expect(d.handles).toBe(0)
    expect(d.locks).toBe(0)
    expect(d.html).toContain('vb-sel-over')
  })

  it('shows neither handles nor a padlock on a box whose resize alone is locked, outlined by its spans', () => {
    // One opaque triangle of node 0, so the span box (and an anchor for a padlock) exists.
    const d = draw([node('R', { x: 1, y: 2, w: '$w', h: 4 })], [0], [], { positions: Float32Array.of(10, 10, 30, 10, 10, 30),
      coverage: Float32Array.of(1, 1, 1), colours: new Uint8Array(12).fill(255), indices: Uint32Array.of(0, 1, 2), spans: Int32Array.of(0, 0, 0, 3) })
    expect(d.html).toContain('x="10" y="10" width="20" height="20"')
    expect(d.handles).toBe(0)
    expect(d.locks).toBe(0)
  })

  it('draws no handles and no knob on a node under # lock (a press on them only says so); the outline stays', () => {
    const d = draw([{ ...node('R', { x: 1, y: 2, w: 3, h: 4 }), comments: ['lock'] }], [0], [], {}, 'p1', null)
    expect(d.handles).toBe(0)
    expect(d.html).not.toContain('vb-knob')
    expect(d.polygons).toBe(2)
  })
  it('draws the knob where a press reaches it: below a node at the top of the page, where above is off the surface', () => {
    expect(draw([node('R', { x: 1, y: 2, w: 3, h: 4 })], [0], [], {}, 'p1', null).html).toContain('<circle class="vb-knob" cx="2.5" cy="30"')
    expect(draw([node('R', { x: 1, y: 40, w: 3, h: 4 })], [0], [], {}, 'p1', null).html).toContain('<circle class="vb-knob" cx="2.5" cy="16"')
  })
  it('shows a padlock with the reason when a move moves nothing of it; none where one axis moves (M2c moveBy)', () => {
    const d = draw([node('T', { x: '=i', y: '=j', w: 10, h: 10, text: 'hi' })], [0], [label({ node: 0 })])
    expect(d.locks).toBe(1)
    expect(d.html).toContain('<title>x is an expression; y is an expression</title>')
    expect(d.handles).toBe(0)
    expect(draw([node('T', { x: '=i', y: 0, w: 10, h: 10, text: 'hi' })], [0], [label({ node: 0 })]).locks).toBe(0)
  })

  it('outlines a T by the label TextLayer draws, not the sheared box, and keeps its handles', () => {
    const d = draw([node('G', { m: [1, 0, -0.4, 1, 0, 0] }, [node('T', { x: 10, y: 20, w: 30, h: 40, text: 'hi' })])], [0, 0],
      [label({ node: 1 })])
    expect(d.polygons).toBe(0)
    expect(d.html).toContain('x="10" y="20" width="30" height="40"')
    expect(d.handles).toBe(8)
  })

  it('outlines a sheared label slanted as TextLayer draws it, about its centre', () => {
    const d = draw([node('G', { m: [1, 0, -0.4, 1, 0, 0] }, [node('T', { x: 10, y: 20, w: 30, h: 40, text: 'hi' })])], [0, 0],
      [label({ node: 1, shear: [1, 0.4, 0, 1] })])
    expect(d.html).toContain('transform="translate(25 40) matrix(1 0 -0.4 1 0 0) translate(-25 -40)"')
  })

  it('outlines a T under a similarity chain by its attribute box, not the label (exact while a drag runs)', () => {
    const d = draw([node('G', { t: [5, 0] }, [node('T', { x: 10, y: 20, w: 30, h: 40, text: 'hi' })])], [0, 0], [label({ node: 1, x: 99 })])
    expect(d.html).toContain('points="15,20 45,20 45,60 15,60"')
    expect(d.html).not.toContain('x="99"')
  })

  it('outlines a T with no label in the frame by its box through the chain', () => {
    const d = draw([node('T', { x: 10, y: 20, w: 30, h: 40, text: '' })], [0])
    expect(d.polygons).toBe(2)
    expect(d.handles).toBe(8)
  })
})
