// The selected widget's form (owner decision Q2: a widget is edited as a whole): its parameters, its data names and the
// values the preview sends for them. An edit re-expands the widget and is checked off the main thread before it is
// dispatched, as the property panel's are. Detach turns it into plain nodes; Delete removes it.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { iconKeys, loadCatalog, type Catalog } from '../catalog'
import type { Page } from '../model/project'
import type { Scene } from '../model/scene'
import { nodeAt, type Action } from '../model/store'
import type { SceneChecker } from '../srctext/checker'
import { shortestFloat } from '../srctext/print'
import type { Theme } from '../theme/types'
import { expandRoot, indexOf, markerOf, nativeAt, putWidget, sanitize, slotsOf, widgetOf } from '../widgets/core'
import { resetPart } from '../widgets/edits'
import { plainTextProblem } from '../widgets/paint'
import { WIDGETS } from '../widgets/registry'
import { iconWarning } from '../widgets/modules/icon'
import type { Json, Param, Params, Slot, WidgetRef } from '../widgets/types'
import { TextField } from './PropertyPanel'
import { WidgetParam } from './WidgetParam'
export { readParam } from './WidgetParam'
import { LayoutFields } from './LayoutFields'
import { layoutOf } from '../editing/layoutRecords'
import { onPath } from '../editing/tree'
import { stripRichText } from './text'
import { Icon } from '../ui/icons'
import './inspector.css'

/** Why `s` (read as `n`) is no number a float32 holds, or null. */
const notNumber = (s: string, n: number) => s === '' || !Number.isFinite(n) ? 'a number is expected'
  : Number.isFinite(Math.fround(n)) ? null : 'too large: a float32 holds at most 3.4e38 either way'
const NUMBERS = new Set(['number', 'state', 'flag', 'count'])
// A decimal number as typed: digits, a point, an exponent. Not hex, Infinity or blank, which Number() would also read.
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const f32 = (x: unknown) => typeof x === 'number' && Number.isFinite(Math.fround(x))
/** A preview value typed for a slot: a number or a string by its kind, a JSON list for an array slot; '' clears it, but
 *  for a string slot, where it is the empty string (a value: it draws nothing). A text slot (labels alone read it) takes
 *  both: a decimal number a float32 holds is stored as a number, any other text as a string, as typed. Reset clears any. */
export function readSample(text: string, s: Slot): { value: Json | undefined } | { error: string } {
  const t = text.trim()
  if (s.kind === 'string') return { value: text }
  if (s.kind === 'text') return { value: DECIMAL.test(t) && f32(Number(t)) ? Number(t) : text }
  if (t === '') return { value: undefined }
  if (NUMBERS.has(s.kind)) { const n = Number(t), why = notNumber(t, n); return why ? { error: why } : { value: n } }
  let v: unknown
  try { v = JSON.parse(t) } catch { v = undefined }
  const strings = Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string'), numbers = Array.isArray(v) && v.length > 0 && v.every(f32)
  if (s.kind === 'strings' ? strings : s.kind === 'texts' ? strings || numbers : numbers) return { value: v as Json }
  return { error: s.kind === 'strings' ? 'a list of strings, such as ["Item 1", "Item 2"]'
    : s.kind === 'texts' ? 'a list of strings or a list of numbers, such as ["Item 1", "Item 2"] or [1, 2, 0]' : 'a list of numbers, such as [1, 2, 0]' }
}
export const shownSample = (v: Json) => typeof v === 'string' ? v : JSON.stringify(v)
// A text the widget would keep otherwise than typed (sanitize: a label's leading $, a format's brace): said, not swapped.
const NOT_KEPT = 'the widget cannot keep this text as typed'
/** Said when the widget a commit was made for is gone by the time its check lands: deleted, detached, or another type. */
export const WIDGET_GONE = 'the widget was deleted, detached or replaced while this was checked; not applied'
// A rename a slot would not read back (keyOf): an expression reads letters, digits, _ and characters beyond U+FFFF (vector
// 0.11.98); a label's binding reads more.
export const EXPR_NAME = 'an expression reads this data name: letters, digits, _ and characters beyond U+FFFF only'
export const LABEL_NAME = 'a label reads this data name and would read another: no } in it, no : or [ where a format or an index follows, no [index] at its end'
/** A control's element id, for its row's label: the row id with its spaces made dashes. */
const idOf = (id: string) => `vb-w-${id.replaceAll(' ', '-')}`

/** sceneOf, themeNow: a page's scene (PropertyPanel's) and the project's theme in the store now, so a commit whose check
 *  lands late, even after the panel is gone, knows whether the page or the theme changed. pageNow: the page in the store
 *  now, which a native's commit edits (the page prop may be a render behind). */
type Props = { page: Page; pages: { id: string; name: string }[]; widget: WidgetRef; checker: SceneChecker; theme: Theme
  dispatch: (a: Action) => void; sceneOf: (pageId: string) => Scene | undefined; themeNow: () => Theme; native?: boolean; boundName?: boolean
  pageNow: (pageId: string) => Page | undefined }
export function WidgetPanel({ page, pages, widget, checker, theme, dispatch, sceneOf, themeNow, native, boundName, pageNow }: Props) {
  const m = WIDGETS[widget.type]
  // What is said about a row: an error, or information (`info`: a scene too large to check here, which still lands).
  const [errors, setErrors] = useState<Record<string, { message: string; info?: true }>>({})
  const say = (id: string, e: string, info?: true) =>
    setErrors(x => (x[id]?.message ?? '') === e && x[id]?.info === info ? x : { ...x, [id]: { message: e, ...(info && { info }) } })
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const icon = widget.type === 'icon', kind = String(widget.params.kind)
  useEffect(() => {
    if (icon && kind === 'prefab') void loadCatalog().then(setCatalog)
      .catch(e => say('name', `catalogue failed to load: ${e instanceof Error ? e.message : e}`, true))
  }, [icon, kind])
  const names = icon ? [...new Set([...(iconKeys[kind] ?? []), ...(kind === 'prefab' ? catalog?.devices.map(d => d.name) ?? [] : [])])].sort() : []
  const root = indexOf(page.scene, widget.uid, theme), slots = root ? slotsOf(nodeAt(page.scene.root, root)!, theme) : []   // cached by root
  const keys = (widget.params.keys ?? {}) as Record<string, string>
  const expansion = native ? undefined : expandRoot(widget, theme).exp
  const parts = expansion?.parts ?? {}, dormant = new Set(expansion?.dormant ?? [])
  // The commits not landed yet. Detach and Delete wait for them: a field typed in and left by pressing one of them
  // commits on its blur, and that edit lands first rather than being dropped on a widget that is gone.
  const pending = useRef<Promise<unknown>>(Promise.resolve())

  // `id` names the row that speaks for the edit (a top-level param's key); `edit` makes the new params from the widget's.
  // Made on the page's scene; if the page changed while the check ran (this panel's last edit, a drag, the code pane,
  // undo), made again on the newer one, from the widget as it stands there, as long as it is still there (else not
  // applied: deleted or detached). A commit can land after the panel is gone (TextField's unmount), so the store says.
  // A theme switched meanwhile makes it again in the new theme: expanded in the old one, setScene would detach it.
  // A scene too large to check here lands all the same (final-wave ruling 1: a budget never calls a scene invalid); its
  // reason is information, and the preview keeps the last scene it showed (App sends nothing while it stands).
  // A native (Q10) is not in the scene: nothing to check; the edit is made on the native as the store holds it now (a
  // commit landing late must not undo a newer move), and its params go to the store as they are.
  const land = async (id: string, edit: (w: WidgetRef) => WidgetRef) => {
    for (let base = page.scene, t = native ? themeNow() : theme; ;) {
      const at = native ? null : indexOf(base, widget.uid, t)
      const was = native ? nativeAt(pageNow(page.id) ?? {}, widget.uid, t) : at ? widgetOf(nodeAt(base.root, at)!, t) : null
      if (was?.type !== widget.type) return say(id, WIDGET_GONE)
      const edited = edit(was), params = edited.params, clean = sanitize(m, params, t), typed = params[id], ref = { ...edited, params: clean }
      if (typeof typed === 'string' && clean[id] !== typed) return say(id, NOT_KEPT)
      const same = markerOf(ref) === markerOf(was)
      // A derived number (a height that follows the rows, a minimum height): the module's fix sets it, not what was typed.
      const held = typeof typed === 'number' && clean[id] !== Math.fround(typed)
        ? `${same ? 'kept at' : 'set to'} ${shortestFloat(clean[id] as number)}: the widget sets it from its other parameters` : ''
      if (same) return say(id, held)   // nothing changes (a blur, Enter again): no history entry
      if (native) { say(id, held); return dispatch({ type: 'setWidget', pageId: page.id, ref }) }
      const next = putWidget(base, ref, t), c = await checker.check(next)
      const now = sceneOf(page.id), tNow = themeNow()
      if (now === undefined) return   // the page is gone
      if (now !== base || tNow !== t) { base = now; t = tNow; continue }
      if (c.tooLarge) say(id, c.errors[0].message, true)
      else if (c.errors.length) return say(id, c.errors[0].message)
      else say(id, held)
      return dispatch({ type: at && onPath(base.root, at, layoutOf) ? 'editScene' : 'setScene', pageId: page.id, scene: next })
    }
  }
  const commit = (id: string, edit: (ps: Params, w: WidgetRef) => Params) => {
    const p = land(id, w => ({ ...w, params: edit(w.params, w) }))
    pending.current = pending.current.then(() => p)
    return p
  }
  const after = (a: Action) => () => void pending.current.then(() => dispatch(a))
  // Font tags use real preview faces; other TMP styling is omitted (spec §5.3).
  const rich = (p: Param, v: Json) => (p.type === 'template' || p.type === 'text' || p.type === 'fmt') && !native && typeof v === 'string'
    && stripRichText(v) !== v ? <div className="vb-prop-info">The preview uses real font, bold, italic and weight faces; missing styles use faux bold. Other TMP rich-text styling is omitted.</div> : null
  const control = (p: Param, v: Json, id: string, put: (v: Json) => void) => <>
    <WidgetParam param={p} value={v} label={id} id={idOf(id)} theme={theme} pages={pages} onChange={put} onError={message => say(id, message)}
      list={icon && id === 'name' ? 'vb-icon-names' : undefined} multiline={!(icon && id === 'name') && (p.type === 'text' || p.type === 'template')} />
    {icon && id === 'name' && <datalist id="vb-icon-names">{names.map(name => <option key={name} value={name} />)}</datalist>}
    {rich(p, v)}</>
  const said = (id: string) => {
    const warning = icon && id === 'name' && !boundName ? iconWarning(kind, String(widget.params.name)) : undefined
    const message = errors[id]?.message || warning, info = errors[id]?.message ? errors[id].info : true
    return message && (info ? <div role="status" className="vb-prop-info">{message}</div> : <div role="alert">{message}</div>)
  }
  const row = (id: string, name: string, c: ReactNode) =>
    <div key={id} className="vb-prop"><div className="field"><label htmlFor={idOf(id)}>{name}</label>{c}</div>{said(id)}</div>
  const list = (p: Extract<Param, { type: 'list' }>) => {
    const items = widget.params[p.key] as Params[]
    const put = (f: (items: Params[], w: WidgetRef) => Params[]) => void commit(p.key, (ps, w) => ({ ...ps, [p.key]: f(ps[p.key] as Params[], w) }))
    // A new row copies the last, each number one past the largest (an Option group's value), so it is told apart.
    // ponytail: every num item field counts up; a list whose numbers are not ids needs a per-param flag.
    const add = (l: Params[], w: WidgetRef) => {
      // Dormant overrides reserve their item keys, so a new item cannot inherit an old item's look.
      const reserved = Object.keys(w.edit?.parts ?? {}).flatMap(name => {
        const m = /^(?:state|option|tab|row)\.(.+)$/.exec(name)
        if (!m) return []
        const k = Number(m[1]), key = Number.isFinite(k) ? k : Number(m[1].slice(0, m[1].lastIndexOf('.')))
        return Number.isFinite(key) ? [key] : []
      })
      const used = new Set([...reserved, ...l.map(x => x.key as number)])
      let key = Math.fround([...used].reduce((a, k) => Math.max(a, k), -1) + 1)
      if (!Number.isFinite(key) || used.has(key)) { key = 0; while (used.has(key)) key++ }
      return [...l, { ...l[l.length - 1], ...Object.fromEntries(p.item.filter(q => q.type === 'num')
        .map(q => [q.key, q.key === 'key' ? key : l.reduce((a, x) => Math.max(a, x[q.key] as number), -Infinity) + 1])) }]
    }
    // A Remove takes the item clicked, found again by its fields where the commit lands: a second Remove clicked before
    // the first lands takes its own item, not the one that moved up into its place (none, if that item is gone already).
    // An item whose fields changed meanwhile (one of them typed and left by pressing this Remove) is the one at the place
    // clicked, while the list holds as many items as it did. The renames of the slots the item owns go with it
    // (itemSlots: a Key–value row's), so no later item takes them up. The rows from it on move up: their messages go,
    // rather than land on the row that takes their place; those of the rows before it stay.
    const remove = (item: Params, at: number) => {
      const moved = (id: string) => id.startsWith(`${p.key} `) && Number(id.slice(p.key.length + 1).split(' ')[0]) > at   // 1-based
      setErrors(x => Object.fromEntries(Object.entries(x).filter(([id]) => !moved(id))))
      void commit(p.key, ps => {
        const l = ps[p.key] as Params[], found = l.findIndex(x => JSON.stringify(x) === JSON.stringify(item))
        const k = found < 0 && l.length === items.length ? at : found
        if (k < 0 || l.length <= p.min) return ps   // already gone, or at the minimum (a second Remove landing on the first's scene)
        const owned = new Set(m.itemSlots?.(p.key, l[k]) ?? []), keys = (ps.keys ?? {}) as Record<string, string>
        return { ...ps, [p.key]: l.filter((_, j) => j !== k),
          ...(owned.size && { keys: Object.fromEntries(Object.entries(keys).filter(([s]) => !owned.has(s))) }) }
      })
    }
    return <fieldset key={p.key} className="vb-widget-list raised"><legend>{p.key}</legend>
      {items.map((item, k) => <div key={k} className="vb-widget-item raised">
        {p.item.map(q => row(`${p.key} ${k + 1} ${q.key}`, q.key,
          control(q, item[q.key], `${p.key} ${k + 1} ${q.key}`, v => put(l => l.map((x, j) => j === k ? { ...x, [q.key]: v } : x)))))}
        <button type="button" disabled={items.length <= p.min} onClick={() => remove(item, k)}>Remove</button>
      </div>)}
      <button type="button" onClick={() => put(add)}>Add</button>
      {said(p.key)}
    </fieldset>
  }
  // The data names a player renames: a slot whose name is its <uid>_<slot> or its rename (the Text widget's are its
  // template's: `$<name>` slots, never renamed). The field shows the name in force, blank for the default.
  const own = (s: Slot) => `${widget.uid}_${s.slot}`
  const named = m.params.some(p => p.type === 'keys') ? slots.filter(s => !s.runtime && (s.key === own(s) || (Object.hasOwn(keys, s.slot) && s.key === keys[s.slot]))) : []
  // Whether the slot reads `name` back where it reads it (keyOf), with the widget's params as shown.
  const fits = (slot: string, name: string) =>
    m.expand(sanitize(m, { ...widget.params, keys: { ...keys, [slot]: name } }, theme), theme, widget.uid).slots.some(x => x.slot === slot && x.key === name)
  // One preview value per data name: two slots renamed to one name share it, read by the kind of a snapped slot among
  // them (the per-tick contract: a name a snapped slot reads is sent snapped), else the first's.
  const values = slots.filter((s, i) => slots.findIndex(o => o.key === s.key) === i)
    .map(s => s.snap ? s : slots.find(o => o.key === s.key && o.snap) ?? s)
  const pinned = (key: string) => !!page.preview && Object.hasOwn(page.preview, key)
  return <aside className="vb-props" aria-label="Widget">
    <h2 className="vh">{m.label} <code>{widget.uid}</code></h2>
    <div className="vb-widget-actions">
      {!native && <button type="button" className="ibtn flat" title="Detach" onClick={after({ type: 'detachWidget', pageId: page.id, uid: widget.uid })}><Icon name="detach" /><span className="vh">Detach</span></button>}
      <button type="button" className="ibtn flat" title="Delete" onClick={after({ type: 'deleteWidget', pageId: page.id, uid: widget.uid })}><Icon name="trash" /><span className="vh">Delete</span></button>
    </div>
    {expansion?.notes?.map(note => <p key={note} role="status">{note}</p>)}
    {!native && root && <LayoutFields page={page} path={root} theme={theme} checker={checker} dispatch={dispatch} sceneOf={sceneOf} />}
    {!native && <details className="disc" open><summary><span className="ptitle">Parts</span><span className="unit">{Object.keys(widget.edit?.parts ?? {}).length}</span></summary>
      {Object.entries(widget.edit?.parts ?? {}).map(([name, edit]) => <div className="lrow" key={name}>
        <span>{name}{!Object.hasOwn(parts, name) && ' (dormant)'}</span>{' '}
        <span>{[...Object.keys(edit.attrs ?? {}), ...['dx', 'dy', 'dw', 'dh'].filter(k => Object.hasOwn(edit, k))]
          .map(k => k + (expansion?.dormantReasons?.[`${name}.${k}`] ? ` (not applied: ${expansion.dormantReasons[`${name}.${k}`]})`
            : dormant.has(`${name}.${k}`) ? ' (not applied in this theme)' : '')).join(', ')}</span>{' '}
        <button type="button" onClick={() => { const p = land(name, w => resetPart(w, name)); pending.current = pending.current.then(() => p) }}>Reset part</button>
        {said(name)}
      </div>)}
      {!Object.keys(widget.edit?.parts ?? {}).length && <p>No part overrides</p>}
    </details>}
    <details className="disc" open><summary><span className="ptitle">Transform</span><span className="unit">4</span></summary>
      <div className="grid2">{m.params.slice(0, 4).map(p => row(p.key, p.key,
        control(p, widget.params[p.key], p.key, v => void commit(p.key, ps => ({ ...ps, [p.key]: v })))))}</div>
    </details>
    <details className="disc" open><summary><span className="ptitle">parameters</span><span className="unit">{m.params.slice(4).filter(p => p.type !== 'keys').length}</span></summary>
      {m.params.slice(4).map(p => p.type === 'list' ? list(p) : p.type === 'keys' ? null
        : row(p.key, p.key, control(p, widget.params[p.key], p.key, v => void commit(p.key, ps => ({ ...ps, [p.key]: v })))))}
    </details>
    {named.length > 0 && <details className="disc" open id="vb-widget-data-names"><summary><span className="ptitle">data names</span><span className="unit">{named.length}</span></summary>{named.map(s => row(`${s.slot} data name`, s.slot,
      <TextField id={idOf(`${s.slot} data name`)} label={`${s.slot} data name`} now={s.key === own(s) ? '' : s.key} placeholder={own(s)}
        multiline={false} commit={text => {
          // Any name the slot reads back (final-wave ruling 2: `constructor`, `room kPa` in a label); one it would not, said.
          const name = text.trim(), id = `${s.slot} data name`
          if (name && !fits(s.slot, name)) return say(id, s.labels ? LABEL_NAME : EXPR_NAME)
          void commit(id, ps => {
            // In place: the slot keeps its position, so an unchanged name gives the same marker (commit's no-op guard).
            const k = { ...(ps.keys ?? {}) as Record<string, string> }
            if (name) k[s.slot] = name
            else delete k[s.slot]
            return { ...ps, keys: k }
          })
        }} />))}</details>}
    {values.length > 0 && <details className="disc" open><summary><span className="ptitle">preview values</span><span className="unit">{values.length}</span></summary>{values.map(s => {
      const id = `${s.key} preview value`, now = shownSample(pinned(s.key) ? page.preview![s.key] : s.sample)
      return row(id, s.key, <>
        <TextField id={idOf(id)} label={id} placeholder="" multiline={false} now={now} commit={text => {
          if (text === now) return say(id, '')   // nothing typed (a blur): an unset value keeps following the sample
          const r = readSample(text, s)
          if ('error' in r) return say(id, r.error)
          say(id, '')
          dispatch({ type: 'setPreview', pageId: page.id, key: s.key, value: r.value })
        }} />
        {pinned(s.key) && <button type="button" onClick={() => { say(id, ''); dispatch({ type: 'setPreview', pageId: page.id, key: s.key, value: undefined }) }}>Reset</button>}
      </>)
    })}</details>}
  </aside>
}
