// The active page's src text, two-way synced with the model (spec §4 "Code pane"). Typing parses after 300 ms of quiet
// and a valid text becomes the page's scene; a scene changed from outside is printed back, unless the pane holds a draft
// (text that is not the scene yet), which it keeps, saying so. Scenes are checked in the checker's worker, so a result
// that lands after the doc, the page or the scene moved on is dropped. The caret and the model's selection follow each
// other without fighting the user.
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { lintGutter, setDiagnostics, forEachDiagnostic, type Diagnostic } from '@codemirror/lint'
import { StateEffect, StateField, type Text } from '@codemirror/state'
import { Decoration, EditorView, keymap, lineNumbers, type DecorationSet } from '@codemirror/view'
import { classHighlighter } from '@lezer/highlight'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Scene, SrcNode } from '../model/scene'
import type { Action, Selection } from '../model/store'
import type { Checked } from '../srctext/check'
import type { SceneChecker } from '../srctext/checker'
import { parseSrc, type Issue, type ParseResult, type Range } from '../srctext/parse'
import { printChecked } from '../srctext/print'
import { srcLanguage } from './srcLanguage'
import { outside, pathAtOffset, rangeOf, replaceText, sameScene, textHistory, toDiagnostics } from './sync'

const QUIET_MS = 300

// The selected node's lines.
const mark = StateEffect.define<Range | null>()
const selLine = Decoration.line({ class: 'vb-code-sel' })
const marked = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    d = d.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(mark)) continue
      const doc = tr.state.doc, r = e.value, lines = []
      for (let n = r ? doc.lineAt(r.from).number : 1, end = r ? doc.lineAt(r.to).number : 0; n <= end; n++) lines.push(selLine.range(doc.line(n).from))
      d = Decoration.set(lines)
    }
    return d
  },
  provide: f => EditorView.decorations.from(f),
})

// The doc's parse while the doc matches the model (the scene the pane sent or printed), with its node ranges.
type Synced = { text: Text; scene: Scene; ranges: Map<SrcNode, Range> }

const keyOf = (s: Selection | null) => s ? `${s.pageId}\n${s.inDefs ? 'defs' : 'root'}\n${s.path.join('.')}` : ''

// Lints the doc from its parse `r` and the check `c` of that scene (or of one that prints the same): the parse's issues,
// then the check's on their nodes.
function lint(view: EditorView, r: ParseResult, c: Checked | null, afterLint: (view: EditorView) => void) {
  const len = view.state.doc.length
  const at = (severity: Diagnostic['severity']) => (i: Issue): Diagnostic => ({ severity, message: i.message, from: Math.min(i.from, len), to: Math.min(i.to, len) })
  view.dispatch(setDiagnostics(view.state, [...r.errors.map(at('error')), ...r.warnings.map(at('warning')),
    ...(c && r.scene ? toDiagnostics(c, r.scene, r.ranges, len) : [])]))
  afterLint(view)
}

// Parses `doc` (the view's now), checks it, and lints it if the view still shows it when the check lands. Returns the
// parse when the text is a valid scene, or one too large to check here (a budget never calls a scene invalid: it lands,
// and the preview keeps the last scene it showed while the reason stands as information), else null; a caller compares
// its `text` with the view's doc.
async function check(view: EditorView, checker: SceneChecker, afterLint: (view: EditorView) => void, doc = view.state.doc): Promise<Synced | null> {
  const r = parseSrc(doc.toString())
  const c = r.scene ? await checker.check(r.scene) : null
  if (view.state.doc === doc) lint(view, r, c, afterLint)
  return r.scene && (c?.src != null || c?.tooLarge) && !r.errors.length ? { text: doc, scene: r.scene, ranges: r.ranges } : null
}

export function CodePane({ scene, pageId, selection, dispatch, checker, onDiagnostics }: {
  scene: Scene; pageId: string; selection: Selection | null; dispatch: (a: Action) => void; checker: SceneChecker
  onDiagnostics?: (counts: { errors: number; warnings: number }) => void
}) {
  const reported = useEffectEvent((v: EditorView) => {
    const counts = { errors: 0, warnings: 0 }
    forEachDiagnostic(v.state, diagnostic => {
      if (diagnostic.severity === 'error') counts.errors++
      if (diagnostic.severity === 'warning') counts.warnings++
    })
    onDiagnostics?.(counts)
  })
  const host = useRef<HTMLDivElement>(null)
  // Undo restores scene object identities; weak keys keep typed layouts only while those scenes survive.
  const layouts = useRef(new WeakMap<Scene, string>())
  const [view, setView] = useState<EditorView | null>(null)
  const [draft, setDraft] = useState(false)   // the doc holds text that is not the scene, kept over an outside change
  // view: the live view (a result for a destroyed one is dropped). page: the page shown. sent: the scene the pane last
  // dispatched or printed. key: the model's selection as far as the pane knows (the last one it dispatched or received).
  // timer: the pending parse.
  const sync = useRef({ view: null as EditorView | null, page: '', sent: null as Scene | null, synced: null as Synced | null, key: '', timer: 0 })
  const latest = useRef({ scene, pageId })   // what a result that lands later is measured against
  latest.current = { scene, pageId }
  const fresh = (v: EditorView) => sync.current.synced?.text === v.state.doc ? sync.current.synced : null

  // The caret moved: select its node, unless the model has it already. Not while the text differs from the model.
  const moved = useEffectEvent((v: EditorView) => {
    const s = sync.current, d = fresh(v)
    if (!d) return
    const hit = pathAtOffset(d.ranges, d.scene, v.state.selection.main.head), sel = hit && { pageId, ...hit }
    if (keyOf(sel) === s.key) return
    s.key = keyOf(sel)
    dispatch({ type: 'select', selection: sel })
  })

  // The selected node's lines are marked. A selection from outside, other than the pane's own and other than one the
  // caret is already in, moves the caret to the node's start and into view, without focus. Selecting the whole node
  // would let the next keystroke overwrite it. Not while an outside change waits for its check: show() follows then.
  const follow = useEffectEvent(() => {
    const s = sync.current
    if (!view || s.page !== pageId || s.sent !== scene) return
    const d = fresh(view), key = keyOf(selection)
    const range = d && selection?.pageId === pageId ? rangeOf(d.ranges, d.scene, selection.path, !!selection.inDefs) : null
    const head = view.state.selection.main.head
    const jump = range && key !== s.key && (head < range.from || head > range.to) ? { selection: { anchor: range.from }, scrollIntoView: true } : {}
    s.key = key
    view.dispatch({ ...jump, effects: mark.of(range), annotations: outside.of(true) })
  })

  // Puts the model scene's `text` in the doc, replacing only the part that differs, so the caret and the scroll stay;
  // `top` (another page) starts at the top. The text history starts over (see replaceText). The text is the model's, so
  // it is in sync at once, and linted from the model scene's check `c` (its paths are the text's), or from its own.
  const show = useEffectEvent((v: EditorView, printed: string, c: Checked | undefined, top: boolean) => {
    // Without the printer's last line end, which the pane would show as an empty last line: typed text has none, so the
    // first outside print (a panel edit) adding one, and undo keeping it, looked like an edit of its own.
    const text = layouts.current.get(scene) ?? (printed.endsWith('\n') ? printed.slice(0, -1) : printed)
    replaceText(v, text, top ? { selection: { anchor: 0 }, effects: EditorView.scrollIntoView(0) } : {})
    const r = parseSrc(text)
    sync.current.synced = { text: v.state.doc, scene: r.scene!, ranges: r.ranges }
    setDraft(false)
    if (c) lint(v, r, c, reported)
    else void check(v, checker, reported)
    follow()
  })

  // A valid text that changes the scene becomes the page's scene (an unchanged one would be an empty undo step). The doc
  // is not reprinted: the user's layout stays. Then, while the pane has focus, the caret's node is selected again, since
  // the reducer may have moved the selection with the scene. A parse on blur leaves the selection to the click that took
  // the focus (a canvas click selects its own node). A valid text ends a draft. The check is a worker's round trip, so the
  // page may change meanwhile (a page tab's click blurs the pane first): the text then still becomes its own page's
  // scene, so leaving the pane keeps the last keystrokes.
  const parse = useEffectEvent(async (v: EditorView, focused: boolean) => {
    const s = sync.current, page = s.page, doc = v.state.doc, base = s.sent
    clearTimeout(s.timer)
    s.timer = 0
    const synced = await check(v, checker, reported, doc)
    if (s.view !== v) return
    const here = v.state.doc === doc, now = latest.current
    if (here) s.synced = synced
    if (!synced) return
    if (now.pageId !== page) {
      layouts.current.set(base && sameScene(synced.scene, base) ? base : synced.scene, doc.toString())
      if (base && !sameScene(synced.scene, base)) dispatch({ type: 'setScene', pageId: page, scene: synced.scene })
      return
    }
    if (!here || s.page !== page) return   // typed on meanwhile: the next parse speaks
    setDraft(false)
    const changed = !sameScene(synced.scene, now.scene)
    layouts.current.set(changed ? synced.scene : now.scene, doc.toString())
    if (changed) {
      s.sent = synced.scene
      dispatch({ type: 'setScene', pageId: page, scene: s.sent })
    }
    if (!focused) return
    if (changed) s.key = '\0'
    moved(v)
  })

  useEffect(() => {
    const s = sync.current
    const v = new EditorView({ parent: host.current!, extensions: [
      lineNumbers(), textHistory.of(history()), keymap.of([...defaultKeymap, ...historyKeymap]), srcLanguage,
      syntaxHighlighting(classHighlighter), lintGutter(), marked, EditorView.darkTheme.of(true),
      EditorView.contentAttributes.of({ 'aria-label': 'Scene source' }),
      EditorView.updateListener.of(u => {
        if (u.transactions.some(t => t.annotation(outside))) return
        if (u.docChanged) {
          clearTimeout(s.timer)
          s.timer = window.setTimeout(() => void parse(u.view, u.view.hasFocus), QUIET_MS)
        }
        if (u.selectionSet) moved(u.view)
      }),
      EditorView.domEventHandlers({ blur: (_, v) => { if (s.timer) void parse(v, false) } }),   // leaving the pane keeps the last keystrokes
    ] })
    s.view = v
    s.page = ''
    setView(v)
    return () => {
      clearTimeout(s.timer)
      s.timer = 0
      s.view = null
      v.destroy()
    }
  }, [])

  // Another page, or a scene the pane did not send: show it printed, once checked. While the doc holds text that is not
  // the scene (it does not check, or typing is not parsed yet), an outside change on the same page keeps the text and
  // says so; a pending parse still runs, and a valid text then becomes the scene (the outside change one undo step back).
  // Another page discards the draft.
  useEffect(() => {
    const s = sync.current
    if (!view || (scene === s.sent && pageId === s.page)) return
    const kept = () => {
      if (pageId !== s.page || fresh(view)) return false
      s.sent = scene
      setDraft(true)
      return true
    }
    if (kept()) return
    clearTimeout(s.timer)
    s.timer = 0
    void checker.check(scene).then(c => {
      const now = latest.current
      if (s.view !== view || now.scene !== scene || now.pageId !== pageId || (scene === s.sent && pageId === s.page) || kept()) return
      const top = pageId !== s.page
      s.page = pageId
      s.sent = scene
      show(view, c.src ?? printChecked(scene), c, top)   // model scenes are valid: one too large to check here is printed here
    })
  }, [view, scene, pageId, checker])

  useEffect(() => follow(), [view, selection, scene, pageId])

  // Back to the scene: the draft is dropped.
  const revert = () => {
    const s = sync.current
    if (!view) return
    clearTimeout(s.timer)
    s.timer = 0
    const c = checker.get(scene)
    show(view, c?.src ?? printChecked(scene), c, false)
  }

  return <div className="vb-code">
    {draft && <div role="status" className="vb-code-draft raised"><span className="chip warn">WARN</span> The scene changed elsewhere; your text was kept.
      <button type="button" onClick={revert}>Revert to the scene</button></div>}
    <div ref={host} className="vb-code-editor" />
  </div>
}
