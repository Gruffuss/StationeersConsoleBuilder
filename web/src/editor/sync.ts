// The code pane's sync with the model, without a view: offsets to node paths and back (through the ranges parseSrc
// recorded), the model's text put into the doc, when a parsed scene is a change, and a check's issues on the text.
import { history } from '@codemirror/commands'
import type { Diagnostic } from '@codemirror/lint'
import { Annotation, Compartment, type EditorState, type Transaction, type TransactionSpec } from '@codemirror/state'
import type { Scene, SrcNode } from '../model/scene'
import { nodeAt } from '../model/store'
import type { Checked, CheckIssue } from '../srctext/check'
import type { Range } from '../srctext/parse'
import { printChecked } from '../srctext/print'

/** The innermost node whose range holds `offset` (both ends included), as a path into the root or DEFS; null outside every node. */
export function pathAtOffset(ranges: Map<SrcNode, Range>, scene: Scene, offset: number): { path: number[]; inDefs: boolean } | null {
  for (const [list, inDefs] of [[scene.root, false], [scene.defs, true]] as const) {
    const path: number[] = []
    for (let nodes: SrcNode[] | undefined = list; nodes;) {
      const k = nodes.findIndex(n => { const r = ranges.get(n); return !!r && r.from <= offset && offset <= r.to })
      if (k < 0) break
      path.push(k)
      nodes = nodes[k].c
    }
    if (path.length) return { path, inDefs }
  }
  return null
}

export function rangeOf(ranges: Map<SrcNode, Range>, scene: Scene, path: number[], inDefs: boolean): Range | null {
  const n = nodeAt(inDefs ? scene.defs : scene.root, path)
  return (n && ranges.get(n)) ?? null
}

export const outside = Annotation.define<true>()   // the pane following the model: no parse, no select back
export const textHistory = new Compartment()       // holds history(), so an outside replace can start it over

/**
 * Puts the model's `text` in the doc, replacing only the part that differs so the caret and the scroll stay. The text
 * history starts over: its steps were made on the user's text, and undoing them over the new text would mix the two.
 * Emptying the compartment drops the history field; filling it again creates a new one.
 */
export function replaceText(target: { state: EditorState; dispatch: (tr: Transaction) => void }, text: string, spec: TransactionSpec = {}) {
  const old = target.state.doc.toString()
  let a = 0, b = 0
  while (a < old.length && old[a] === text[a]) a++
  while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++
  target.dispatch(target.state.update({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) },
    effects: textHistory.reconfigure([]), annotations: outside.of(true) }, spec))
  target.dispatch(target.state.update({ effects: textHistory.reconfigure(history()), annotations: outside.of(true) }))
}

/** Same scene as printed: layout differences do not count. Both are valid (a model scene, a parse that checked clean). */
export const sameScene = (a: Scene, b: Scene) => printChecked(a) === printChecked(b)

/**
 * A check's issues on the text `scene` was parsed from: each on its node's range, one without a node at the start. A scene
 * too large to check here is information, not an error.
 */
export function toDiagnostics(c: Checked, scene: Scene, ranges: Map<SrcNode, Range>, length: number): Diagnostic[] {
  const at = (severity: Diagnostic['severity']) => (i: CheckIssue): Diagnostic => {
    const n = i.ref && nodeAt(i.ref.inDefs ? scene.defs : scene.root, i.ref.path)
    const r = (n && ranges.get(n)) || { from: 0, to: 0 }
    return { severity, message: i.message, from: Math.min(r.from, length), to: Math.min(r.to, length) }
  }
  return [...c.errors.map(at(c.tooLarge ? 'info' : 'error')), ...c.warnings.map(at('warning'))]
}
