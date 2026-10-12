// The selected node's attributes (the SCENE header when nothing is selected): one row per key the parser reads there,
// grouped as the catalogue groups them, then the node's other keys, raw. An edit is read, checked off the main thread,
// and dispatched only when the scene stays valid; one the page changed under while it was checked is made again on the
// newer scene, or said not applied. The panel refuses nothing the mod reads: what the mod reads otherwise is a note or
// the check's warning. A node with a block offers the group defaults it passes down, whatever its op, each by its exact
// key, as the mod collects them; every key the node holds shows once, in its row or under "other keys".
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Page } from '../model/project'
import type { Scene, SrcNode, Value } from '../model/scene'
import { nodeAt, replaceAt, sameData, type Action, type Selection } from '../model/store'
import { COLOUR_FUNCTIONS, FUNCTIONS, GROUPS, VARIABLES, fieldsFor, passesDown, type Field } from '../schema'
import type { CheckIssue, NodeRef } from '../srctext/check'
import type { SceneChecker } from '../srctext/checker'
import { first, foldKey, textOf } from '../srctext/props'
import { joined } from '../srctext/validate'
import type { Theme } from '../theme'
import { linked, linksOf, unlinked, type StyleLink } from '../theme/links'
import { applyStyle, isStyle } from '../editing/style'
import { expandRoot, putWidget, widgetAt, widgetRootOf } from '../widgets/core'
import { resetPart } from '../widgets/edits'
import { absent, dataNames, modeOf, modesOf, noteOf, ownDefault, passedDown, read, shown, withAttr, type Mode } from './fields'
import { fontsVersion, isKnownFont, knownFonts, subscribeFonts } from './fonts'
import { previewFontWarning } from './fontWarnings'
import { pageFontsVersion, subscribePageFonts } from './pageFonts'
import { PaintFields } from './PaintFields'
import { GradientFields, isGradient, type GradientEdit } from './GradientFields'
import { LayoutFields } from './LayoutFields'
import { layoutOf } from '../editing/layoutRecords'
import { onPath } from '../editing/tree'
import { pictureFile, picturePlaceholder, pictureSource } from '../editing/commands/picture'
import './inspector.css'

/** sceneOf: a page's scene in the store now, so a commit whose check lands late knows whether the page changed. */
type Props = { page: Page; selection: Selection | null; checker: SceneChecker; theme: Theme; dispatch: (a: Action) => void
  sceneOf: (pageId: string) => Scene | undefined }

export const NOT_APPLIED = 'the node changed while this was checked; not applied'
// The node (the header's attributes, for the SCENE) each panel edit was made from: an edit whose check lands after
// another edit of this panel to the same node is made again on top of it (x, then y, typed quickly), while a node the
// code pane or undo put there is not.
const madeFrom = new WeakMap<object, object>()
const descends = (x: object | undefined, from: object) => { for (let y = x; y; y = madeFrom.get(y)) if (y === from) return true; return false }
const byGroup = (a: Field, b: Field) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order
// A flag the mod reads as on above 0.5, but kern as not 0 (SceneModel.cs:2043 at v0.11.118).
// Number(v) and JSON.stringify(v) through joined, which writes a value of any depth without overflowing the stack.
const isOn = (f: Field, v: Value) => { const text = joined(v, String, '', ''), n = text === 'true' ? 1 : text === 'false' ? 0 : Number(text); return foldKey(f.key) === 'KERN' ? n !== 0 : n > 0.5 }
const same = (a: Value | undefined, b: Value | undefined) =>
  a === undefined || b === undefined ? a === b : joined(a, JSON.stringify) === joined(b, JSON.stringify)
const sameRef = (a: NodeRef | undefined, b: NodeRef) =>
  !!a && a.inDefs === b.inDefs && a.path.length === b.path.length && a.path.every((x, i) => x === b.path[i])
// The key a node holds under its exact spelling, or none.
const exactly = (attrs: Record<string, Value>, key: string) => Object.hasOwn(attrs, key) ? key : undefined
/** A row: the key it shows (as the node holds it, else as the catalogue spells it), and whether that key is exact (a group
 *  default passed down, which no other spelling meets). */
type Shown = { key: string; exact: boolean }
// A warning about one key carries it as written (traps.ts, validate.ts): it goes beside the row showing that key, else
// beside one whose key folds alike (the mod compares keys so), never an exact one; with neither it goes at the top.
const homeOf = (w: CheckIssue, rows: Shown[]) => w.key === undefined ? undefined
  : rows.find(r => r.key === w.key) ?? rows.find(r => !r.exact && foldKey(r.key) === foldKey(w.key!))
const LABEL: Record<Mode, string> = { literal: 'value', data: '$data', expr: '=expr', gradient: '@gradient', colourExpr: '=colour' }
/** The suggestions a field offers in a mode (a paint's expr is $name[expr], so it starts with a data name). */
const listOf = (f: Field, mode: Mode) => f.type === 'font' ? 'vb-fonts' : mode === 'colourExpr' ? 'vb-colour'
  : mode === 'literal' ? (f.type === 'paint' || f.type === 'colour' ? 'vb-swatches' : undefined)
  : mode === 'data' || (mode === 'expr' && f.type === 'paint') ? 'vb-data' : mode === 'gradient' ? undefined : 'vb-expr'

// A text field that keeps its focus across commits: it shows `now` again whenever the committed value changes (an edit
// here, the code pane, undo), and otherwise holds what is typed, so an error leaves the text to fix. It commits on Enter,
// and on blur what was typed (unchanged text after a mode switch stays unwritten until Enter), and what is typed and not
// committed goes in when the field goes away too (a canvas click selects another node): a focused input that is removed
// gets no blur in every browser. `multiline` is a textarea, for a text that may
// hold a line break (an input drops it); Shift+Enter breaks the line there.
export function TextField({ now, commit, label, placeholder, list, multiline, id, disabled }:
  { now: string; commit: (text: string) => void; label: string; placeholder: string; list?: string; multiline: boolean; id?: string; disabled?: boolean }) {
  const [text, setText] = useState(now)
  useEffect(() => setText(now), [now])
  const left = useRef({ text, now, commit })
  left.current = { text, now, commit }
  useEffect(() => () => { const l = left.current; if (l.text !== l.now) l.commit(l.text) }, [])
  const common = { id, disabled, 'aria-label': label, placeholder, value: text, onBlur: () => { if (text !== now) commit(text) } }
  return multiline
    ? <textarea {...common} rows={text.split('\n').length} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(text) } }} />
    : <input type="text" {...common} list={list} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commit(text) }} />
}

/** The panel. Each node gets a fresh set of fields: modes and errors start over. */
export function PropertyPanel(props: Props) {
  const s = props.selection
  return <Fields key={`${props.page.id}/${s?.inDefs ? 'defs' : 'root'}/${s?.path.join('.') ?? ''}`} {...props} />
}

function Fields({ page, selection, checker, theme, dispatch, sceneOf }: Props) {
  useSyncExternalStore(subscribePageFonts, pageFontsVersion, pageFontsVersion)
  useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)   // an imported font joins the list, and its note goes
  useSyncExternalStore(checker.subscribe, () => checker.version)   // a landed check brings its warnings
  const scene = page.scene
  const sel: NodeRef | null = selection?.pageId === page.id ? { inDefs: !!selection.inDefs, path: selection.path } : null
  const ref = sel && nodeAt(sel.inDefs ? scene.defs : scene.root, sel.path) ? sel : null   // no such node: the SCENE
  // The edited node in a scene (the header as a SCENE node), and a scene with it replaced.
  const holder = (s: Scene): SrcNode | undefined => ref ? nodeAt(ref.inDefs ? s.defs : s.root, ref.path) : { op: 'SCENE', attrs: s.header }
  const put = (s: Scene, n: SrcNode): Scene => !ref ? { ...s, header: n.attrs }
    : ref.inDefs ? { ...s, defs: replaceAt(s.defs, ref.path, n)! } : { ...s, root: replaceAt(s.root, ref.path, n)! }
  const node = holder(scene)!
  const root = ref && !ref.inDefs ? widgetRootOf(scene, ref.path, theme) : null
  const rawStyle = !!ref && !root
  const widget = root && ref!.path.length > root.length ? widgetAt(scene, root, theme) : null
  const part = widget && Object.entries(expandRoot(widget, theme).exp.parts!).find(([, p]) => p.join() === ref!.path.slice(root!.length).join())?.[0]
  const land = (next: Scene) => {
    const layout = ref && !ref.inDefs && onPath(scene.root, ref.path, layoutOf)
    dispatch({ type: widget || layout ? 'editScene' : 'setScene', pageId: page.id, scene: next })
    const actual = sceneOf(page.id), n = actual && holder(actual), made = holder(next)
    // The store re-expands a part edit; quick commits still descend from this panel's checked node.
    if (widget && n && made && n !== made && sameData(n.attrs, made.attrs)) madeFrom.set(idOf(n), idOf(made))
  }
  const idOf = (n: SrcNode): object => ref ? n : n.attrs
  const op = foldKey(node.op), attrs = node.attrs
  // The key a field's row edits: a group default passed down by its exact key (ParseStyle collects it so, and another
  // spelling does nothing there); any other the first that folds alike, as the mod's PropValue finds it.
  const keyOf = (f: Field) => passedDown(f) ? exactly(attrs, f.key) : Object.keys(attrs).find(k => foldKey(k) === foldKey(f.key))
  const own = fieldsFor(op), have = new Set(own.map(f => foldKey(f.key)))
  const passed = node.c?.length && op !== 'G' && op !== 'SCENE' ? fieldsFor('G').filter(f => passesDown(op, f.key) && !have.has(foldKey(f.key))) : []
  const all = [...own, ...passed].sort(byGroup), fields = all.filter(f => !f.hidden && (f.key !== 'ml' || !first(node, 'JOIN') || first(node, 'JOIN') === 'miter'))
  const [errors, setErrors] = useState<Record<string, { message: string; info?: true }>>({})
  const [modes, setModes] = useState<Record<string, Mode>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const [pictureSize, setPictureSize] = useState<{ src: string; bytes: number }>()
  // Whatever the check says about this node (with nothing selected, about no node). While a new scene's check is pending,
  // the last one's stay as long as this node is the one they were about (this panel's own edits keep it); after an undo
  // or a code-pane edit the path may hold another node, so none show until the check lands.
  const landed = checker.get(scene), last = useRef<{ scene: Scene; warnings: CheckIssue[] } | null>(null)
  if (landed) last.current = { scene, warnings: landed.warnings }
  const was = last.current, wasNode = was && holder(was.scene)
  const warnings = was && (landed || (wasNode && descends(idOf(node), idOf(wasNode))))
    ? was.warnings.filter(w => ref ? sameRef(w.ref, ref) : !w.ref) : []
  const data = useMemo(() => dataNames(scene), [scene])

  const say = (key: string, message: string, info?: true) => setErrors(e => (e[key]?.message ?? '') === message && e[key]?.info === info ? e
    : { ...e, [key]: { message, ...(info && { info }) } })
  // exact: the key is found by its own spelling only (a group default passed down, or a key under "other keys").
  const commit = async (key: string, text: string, mode: Mode, f: Field, exact: boolean, link?: StyleLink) => {
    if (ref?.inDefs && isGradient(node) && String(first(node, 'ID') ?? '').startsWith('theme_')) return say(key, 'Select a shape that uses this theme gradient; its first edit makes an independent copy')
    const r = read(text, mode, f)
    if ('error' in r) return say(key, r.error)
    // Made on `scene`. If the page changed while the check ran, made again on the newer scene, as long as the edited node
    // is the same object there or one this panel made from it (the change was elsewhere, or another of its edits); a node
    // that already holds the value needs nothing (a repeat). A scene too large to check here is made all the same (M2b
    // final-wave ruling 1, which replaces M2a plan ruling 2): a budget never calls a scene invalid, so its reason is
    // information, and the preview keeps the last scene it showed (App sends nothing while a page is too large to check).
    for (let base = scene; ;) {
      const n = holder(base), k = n && (exact ? exactly(n.attrs, key) : Object.keys(n.attrs).find(x => foldKey(x) === foldKey(key)))
      if (n && same(k === undefined ? undefined : n.attrs[k], r.value) && !link) return say(key, '')   // no history entry for nothing
      if (!n || !descends(idOf(n), idOf(node))) return say(key, NOT_APPLIED)
      const made = link ? linked(n, key, link, theme) : withAttr(unlinked(n, [key]), key, r.value, exact), next = put(base, made)
      madeFrom.set(idOf(made), idOf(n))
      const c = await checker.check(next)
      const now = sceneOf(page.id)
      if (now === undefined) return   // the page is gone
      if (now !== base) { base = now; continue }
      if (c.tooLarge) say(key, c.errors[0].message, true)
      else if (c.errors.length) return say(key, c.errors[0].message)
      else {
        const overwrote = link ? applyStyle(n, { [key]: made.attrs[key] }).overwrote : 0
        say(key, overwrote ? `${overwrote} expression or data value${overwrote > 1 ? 's' : ''} replaced` : '', overwrote ? true : undefined)
      }
      return land(next)
    }
  }
  const detachStyle = async () => {
    const made = unlinked(node), next = put(scene, made), c = await checker.check(next)
    if (sceneOf(page.id) !== scene) return say('style', NOT_APPLIED)
    if (c.errors.length && !c.tooLarge) return say('style', c.errors[0].message)
    land(next)
  }
  const sourcePicture = async (src: string, from = node) => {
    for (let base = scene; ;) {
      const n = holder(base)
      if (!n || !descends(idOf(n), idOf(from))) return say('picture', NOT_APPLIED)
      if (first(n, 'SRC') === src && foldKey(n.op) === 'IMG') return say('picture', '')
      const made = pictureSource(n, src), next = put(base, made)
      madeFrom.set(idOf(made), idOf(n))
      const c = await checker.check(next), now = sceneOf(page.id)
      if (!now) return
      if (now !== base) { base = now; continue }
      if (c.errors.length && !c.tooLarge) return say('picture', c.errors[0].message)
      say('picture', c.tooLarge ? c.errors[0].message : '', c.tooLarge ? true : undefined)
      return land(next)
    }
  }
  const commitGradient = async (key: string, edit: GradientEdit) => {
    const next = put({ ...scene, defs: edit.defs }, edit.node)
    if (edit.node !== node) madeFrom.set(idOf(edit.node), idOf(node))
    const c = await checker.check(next)
    if (sceneOf(page.id) !== scene) return say(key, NOT_APPLIED)
    if (c.errors.length && !c.tooLarge) return say(key, c.errors[0].message)
    say(key, c.tooLarge ? c.errors[0].message : '', c.tooLarge ? true : undefined)
    land(next)
  }
  const reset = async () => {
    if (!widget || !part) return
    const base = sceneOf(page.id), current = base && widgetAt(base, root!, theme)
    if (!base || current?.uid !== widget.uid) return say('part', NOT_APPLIED)
    const next = putWidget(base, resetPart(current, part), theme), c = await checker.check(next)
    if (sceneOf(page.id) !== base) return say('part', NOT_APPLIED)
    if (c.errors.length && !c.tooLarge) return say('part', c.errors[0].message)
    land(next)
  }

  // raw: a key under "other keys", shown and edited as the node spells it.
  const row = (f: Field, raw = false) => {
    const exact = raw || passedDown(f), key = raw ? f.key : keyOf(f) ?? f.key
    const v = attrs[key], derived = modeOf(v, f), mode = modes[key] ?? derived, options = modesOf(f), now = shown(v)
    const fallback = absent(f)
    // Unchanged text in its own mode is no edit: it only clears what was said about an earlier one.
    const commitText = (text: string) => text === now && mode === derived ? say(key, '') : void commit(key, text, mode, f, exact)
    // A word the mod may not know is still shown. A flag passed down (on a group, ownDefault none) can go back to inherited.
    const choices = f.enum ?? (f.type === 'flag' && ownDefault(f) === undefined ? ['1', '0'] : undefined)
    const words = choices && (now && !choices.includes(now) ? [...choices, now] : choices)
    const control = words && mode === 'literal'
      ? <select aria-label={f.key} value={now} onChange={e => void commit(key, e.target.value, 'literal', f, exact)}>
          <option value="">(default{fallback && `: ${fallback}`})</option>
          {words.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      : f.type === 'flag' && mode === 'literal'
        ? <input type="checkbox" aria-label={f.key} checked={v === undefined ? ownDefault(f) === 1 : isOn(f, v)}
            onChange={e => void commit(key, e.target.checked ? '1' : '0', 'literal', f, exact)} />
        : <TextField label={f.key} now={now} placeholder={fallback} list={listOf(f, mode)} multiline={f.type === 'text'} commit={commitText} />
    const font = f.type === 'font' ? textOf(v) : null
    const note = font && !isKnownFont(font) ? previewFontWarning(scene, [font], []) : noteOf(f, v)
    const colour = f.type === 'paint' || f.key === 'oc'
    const paint = (colour || f.group === 'stroke' || f.key === 'sh') && <PaintFields node={node} field={f} theme={theme}
      gradient={f.type === 'paint' ? <GradientFields scene={scene} node={node} paintKey={key} theme={theme} commit={edit => void commitGradient(key, edit)} /> : undefined}
      commit={(text, mode = 'literal', link) => void commit(key, text, mode, f, exact, link)} />
    return <div key={f.key} className={`vb-prop ${f.type === 'text' ? 'vb-prop-text' : ''}`}>
      <div className="field">
        <label title={f.note}>{f.key}</label>
        {control}
        {colour && paint}
        {options.length > 1 && <select aria-label={`${f.key} mode`} value={mode} onChange={e => {
          setModes(m => ({ ...m, [key]: e.target.value as Mode }))
          say(key, '')
        }}>
          {options.map(m => <option key={m} value={m}>{m === 'expr' && f.type === 'paint' ? '$data[…]' : LABEL[m]}</option>)}
        </select>}
      </div>
      {!colour && paint}
      {rawStyle && isStyle(node.op, key) && f.type === 'colour' && f.key !== 'oc' && <select aria-label={`${f.key} theme swatch`}
        value={'role' in (linksOf(node)[key] ?? {}) ? (linksOf(node)[key] as { role: string }).role : ''}
        onChange={e => { if (e.target.value) void commit(key, theme.colors[e.target.value], 'literal', f, exact, { role: e.target.value }) }}>
        <option value="">Theme swatch</option>
        {Object.keys(theme.colors).map(role => <option key={role} value={role}>{role}</option>)}
      </select>}
      {errors[key]?.message && (errors[key].info ? <div role="status" className="vb-prop-info">{errors[key].message}</div>
        : <div role="alert">{errors[key].message}</div>)}
      {warnings.filter(w => homeOf(w, shownRows)?.key === key).map((w, k) => <div key={k} className="vb-prop-warning">{w.message}</div>)}
      {note && <div className="vb-prop-info">{note}</div>}
    </div>
  }

  // Every key a row of the catalogue holds, hidden ones too, so a hidden key never shows as a raw "other key"; any other
  // key the node holds is one (an F= on a G beside its f, say).
  const held = new Set(all.map(keyOf).filter(k => k !== undefined))
  const fixed = all.filter(f => f.hidden && keyOf(f) !== undefined)
  const others = Object.keys(attrs).filter(k => !held.has(k))
  const raw = (key: string): Field => ({ op, key, kind: 'S', type: 'map', group: 'other', order: 0 })   // read by the real parser
  const shownRows: Shown[] = [...fields.map(f => ({ key: keyOf(f) ?? f.key, exact: passedDown(f) })), ...others.map(key => ({ key, exact: false }))]
  return <aside className="vb-props" aria-label="Properties">
    <h2 className="vh">{node.op}</h2>
    {(op === 'IMG' || picturePlaceholder(node)) && <details className="disc" open><summary><span className="ptitle">Picture</span><span className="unit">1</span></summary>
      <label>Picture URL<TextField label="Picture URL" now={textOf(first(node, 'SRC')) ?? ''} placeholder="https://, file:// or data:"
        multiline={false} commit={text => void sourcePicture(text)} /></label>
      <button onClick={() => fileInput.current?.click()}>Choose picture file…</button>
      <input ref={fileInput} type="file" aria-label="Picture file" hidden onChange={async e => {
        const file = e.target.files?.[0], from = node
        e.target.value = ''
        if (!file) return
        try { const p = await pictureFile(file); await sourcePicture(p.src, from); setPictureSize(p) }
        catch (error) { say('picture', error instanceof Error ? error.message : 'the picture file could not be read') }
      }} />
      {pictureSize && first(node, 'SRC') === pictureSize.src && <div role="status">{pictureSize.bytes} bytes added to the page</div>}
      {errors.picture?.message && <div role={errors.picture.info ? 'status' : 'alert'}>{errors.picture.message}</div>}
    </details>}
    {ref && !ref.inDefs && <LayoutFields page={page} path={ref.path} theme={theme} checker={checker} dispatch={dispatch} sceneOf={sceneOf} />}
    {part && widget && <p>part {part} of {widget.uid}{' '}<button aria-label="Reset part" onClick={() => void reset()}>Reset part</button></p>}
    {errors.part?.message && <div role="alert">{errors.part.message}</div>}
    {rawStyle && Object.keys(linksOf(node)).length > 0 && <button aria-label="Detach style" onClick={() => void detachStyle()}>Detach style</button>}
    {errors.style?.message && <div role="alert">{errors.style.message}</div>}
    {ref?.inDefs && String(first(node, 'ID') ?? '').startsWith('theme_') && <div className="vb-prop-info">
      A theme_ gradient is the builder's: a theme switch, a load, or an edit of a widget that paints with it, writes it again in the theme's colours.</div>}
    {warnings.filter(w => homeOf(w, shownRows) === undefined).map((w, k) => <div key={k} className="vb-prop-warning">{w.message}</div>)}
    {fixed.length > 0 && <details className="disc" open><summary><span className="ptitle">read-only</span><span className="unit">{fixed.length}</span></summary>{fixed.map(f =>
      <div key={f.key} className="vb-prop"><div className="field"><label>{f.key}</label><output>{shown(attrs[keyOf(f)!])}</output></div></div>)}</details>}
    {[...new Set(fields.map(f => f.group))].map(g => <details className="disc" open key={g}>
      <summary><span className="ptitle">{g}</span><span className="unit">{fields.filter(f => f.group === g).length}</span></summary>
      <div className={g === 'geometry' || g === 'transform' ? 'grid2' : undefined}>{fields.filter(f => f.group === g).map(f => row(f))}</div>
    </details>)}
    {others.length > 0 && <details className="disc" open><summary><span className="ptitle">other keys</span><span className="unit">{others.length}</span></summary>{others.map(k => row(raw(k), true))}</details>}
    <datalist id="vb-swatches">{Object.entries(theme.colors).map(([role, hex]) => <option key={role} value={hex}>{role}</option>)}</datalist>
    <datalist id="vb-data">{data.map(n => <option key={n} value={'$' + n} />)}</datalist>
    <datalist id="vb-expr">{[...new Set([...VARIABLES, 'i2'])].map(x => '=' + x).concat(Object.keys(FUNCTIONS).filter(x => !COLOUR_FUNCTIONS.has(x))
      .map(x => `=${x}(`), data.map(n => '=$' + n)).map(x => <option key={x} value={x} />)}</datalist>
    <datalist id="vb-colour">{[...new Set(['=mix(', '=if(', ...Object.values(theme.colors).map(hex => '=' + hex)])].map(x => <option key={x} value={x} />)}</datalist>
    <datalist id="vb-fonts">{knownFonts().map(n => <option key={n} value={n} />)}</datalist>
  </aside>
}
