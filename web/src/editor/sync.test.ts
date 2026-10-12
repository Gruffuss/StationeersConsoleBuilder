import { history, undo } from '@codemirror/commands'
import { EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parseSrc } from '../srctext/parse'
import type { Checked } from '../srctext/check'
import { pathAtOffset, rangeOf, replaceText, sameScene, textHistory, toDiagnostics } from './sync'

const parsed = (text: string) => {
  const r = parseSrc(text)
  expect(r.errors).toEqual([])
  return { scene: r.scene!, ranges: r.ranges }
}

describe('pathAtOffset and rangeOf', () => {
  const text = 'G {\n    R x=1\n}\nC cx=5'
  const { scene, ranges } = parsed(text)

  it('finds the innermost node holding an offset', () => {
    expect(pathAtOffset(ranges, scene, text.indexOf('x=1'))).toEqual({ path: [0, 0], inDefs: false })
    expect(pathAtOffset(ranges, scene, 1)).toEqual({ path: [0], inDefs: false })
    expect(pathAtOffset(ranges, scene, text.indexOf('cx'))).toEqual({ path: [1], inDefs: false })
  })

  it('gives the text range of a path', () => {
    const r = rangeOf(ranges, scene, [0, 0], false)!
    expect(text.slice(r.from, r.to)).toBe('R x=1')
    expect(rangeOf(ranges, scene, [5], false)).toBeNull()
    expect(rangeOf(ranges, scene, [99, 0], false)).toBeNull()
    expect(rangeOf(ranges, scene, [0, 99, 1], false)).toBeNull()
  })

  it('finds nodes inside DEFS', () => {
    const t = 'DEFS { GL id=a }\nR x=1'
    const d = parsed(t)
    expect(pathAtOffset(d.ranges, d.scene, t.indexOf('id=a'))).toEqual({ path: [0], inDefs: true })
    const r = rangeOf(d.ranges, d.scene, [0], true)!
    expect(t.slice(r.from, r.to)).toBe('GL id=a')
  })
})

// A stand-in for the view: what CodeMirror's commands and replaceText need.
const editor = (doc: string, anchor = 0) => {
  const t = { state: EditorState.create({ doc, selection: { anchor }, extensions: textHistory.of(history()) }),
    dispatch(tr: Transaction) { t.state = tr.state } }
  return t
}

describe('replaceText', () => {
  it("starts the text history over, so undo cannot replay the user's steps into the model's text", () => {
    const t = editor('R x=5 y=1')
    const type = (from: number, to: number, insert: string) => t.dispatch(t.state.update({ changes: { from, to, insert }, userEvent: 'input.type' }))
    type(4, 5, '40')                 // the user types 5 -> 40
    replaceText(t, 'R x=5 y=1')      // the model goes back (an app-level undo) and is printed from outside
    expect(t.state.doc.toString()).toBe('R x=5 y=1')
    undo(t)
    expect(t.state.doc.toString()).toBe('R x=5 y=1')
    type(4, 5, '7')                  // new typing is undoable again
    undo(t)
    expect(t.state.doc.toString()).toBe('R x=5 y=1')
  })

  it('replaces only the part that differs, so the caret keeps its place', () => {
    const t = editor('R x=5 y=1\nC cx=2', 15)
    replaceText(t, 'R x=40 y=1\nC cx=2')
    expect(t.state.doc.toString()).toBe('R x=40 y=1\nC cx=2')
    expect(t.state.selection.main.head).toBe(16)
  })
})

describe('sameScene', () => {
  it('ignores layout but not content', () => {
    expect(sameScene(parsed('R x=5   y=1\n\n').scene, parsed('R x=5 y=1').scene)).toBe(true)   // respaced, or typed and reverted
    expect(sameScene(parsed('R x=5 y=1').scene, parsed('R x=5 y=2').scene)).toBe(false)
    expect(sameScene(parsed('R x=5 y=1  # a').scene, parsed('R x=5 y=1  # b').scene)).toBe(false)   // comments are content
  })
})

describe('toDiagnostics', () => {
  const text = 'DEFS { GL id=a }\nG {\n    R x=1\n}'
  const { scene, ranges } = parsed(text)
  const at = (d: { from: number; to: number }) => text.slice(d.from, d.to)
  const order = { ops: [], nodes: [] }

  it("puts an issue on its node's range, in the root or DEFS, and one without a node at the start", () => {
    const c: Checked = { errors: [{ message: 'e', ref: { inDefs: false, path: [0, 0] } }, { message: 'f' }],
      warnings: [{ message: 'w', ref: { inDefs: true, path: [0] } }], src: null, order }
    const d = toDiagnostics(c, scene, ranges, text.length)
    expect(d.map(x => [x.severity, x.message, at(x)])).toEqual([['error', 'e', 'R x=1'], ['error', 'f', ''], ['warning', 'w', 'GL id=a']])
    expect(d[1]).toMatchObject({ from: 0, to: 0 })
  })

  it('gives a scene too large to check here as information, not an error', () => {
    const c: Checked = { errors: [{ message: 'too large' }], warnings: [], src: null, order, tooLarge: true }
    expect(toDiagnostics(c, scene, ranges, text.length).map(x => x.severity)).toEqual(['info'])
  })
})
