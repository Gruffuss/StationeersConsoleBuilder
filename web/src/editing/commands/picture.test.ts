// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { initialState, reducer } from '../../model/store'
import { newProject } from '../../model/project'
import { parseSrc } from '../../srctext/parse'
import { pictureFile, pictureSource } from './picture'

describe('picture source', () => {
  it('accepts the six-byte GIF prefix the mod sniffs without requiring GIF8', async () => {
    await expect(pictureFile(new File(['GIFbad'], 'picture.gif'))).resolves.toMatchObject({ src: 'data:image/gif;base64,R0lGYmFk' })
  })
  it('counts what the page grows by: the data URL text, not the decoded file', async () => {
    const { src, bytes } = await pictureFile(new File(['GIFbad'], 'picture.gif'))
    expect(bytes).toBe(src.length)
    expect(bytes).toBe(30)
  })
  it('replaces a nested placeholder in one undo step and restores its paints and comments', () => {
    const p = newProject()
    p.pages[0].scene = parseSrc('SCENE w=480 h=480\nG {\n# image\n# style {"f":{"role":"accent"}}\n# keep\nR x=10 y=20 w=80 h=45 rx=6 f=#fff s=#000 sw=2 dash=[8,6] sh=[1,1,2,0,#000] id=pic v=1 click=1\n}').scene!
    const before = p.pages[0].scene, n = before.root[0].c![0]
    const state = reducer(initialState(p), { type: 'setScene', pageId: 'p1', scene: {
      ...before, root: [{ ...before.root[0], c: [pictureSource(n, 'https://example.com/a.png')] }],
    } })
    expect(state.project.pages[0].scene.root[0].c![0]).toEqual({ ...n, op: 'IMG',
      attrs: { x: 10, y: 20, w: 80, h: 45, rx: 6, id: 'pic', v: 1, click: 1, src: 'https://example.com/a.png' }, comments: ['keep'] })
    expect(state.past).toHaveLength(1)
    expect(reducer(state, { type: 'undo' }).project.pages[0].scene).toEqual(before)
  })
  it('keeps a lock, expressions, pointer keys and non-marker comments', () => {
    const n = { op: 'R', attrs: { x: '=$x', y: '$y', w: '=80+1', h: 45, rx: 6, id: 'a', v: '$v', press: 1, f: '#fff' },
      comments: [' lock', ' Image ', ' style {}', ' image credit'] }
    expect(pictureSource(n, 'file:///a.bmp')).toEqual({ ...n, op: 'IMG',
      attrs: { x: '=$x', y: '$y', w: '=80+1', h: 45, rx: 6, id: 'a', v: '$v', press: 1, src: 'file:///a.bmp' },
      comments: [' lock', ' image credit'] })
  })
  it('sets an existing IMG source without losing image attributes, and ignores ordinary rectangles', () => {
    const n = { op: 'IMG', attrs: { SRC: 'old', fit: 'cover', uv: [0, 0, 1, 1] } }
    expect(pictureSource(n, 'new').attrs).toEqual({ SRC: 'new', fit: 'cover', uv: [0, 0, 1, 1] })
    const r = { op: 'R', attrs: { f: '#fff' } }
    expect(pictureSource(r, 'new')).toBe(r)
  })
})
