// Small controls the live-data panels share.
import { useId, useRef, useState } from 'react'
import type { Catalog } from '../catalog'
import { defaultSource } from '../catalog/defaults'
import { checkExpr } from '../codegen/expr'
import { isLuaName, type LogicRef, type LuaName, type SimDevice, type SimSource } from '../model/logic'
import type { Project } from '../model/project'
import { Segmented } from '../ui/Segmented'

export const DATA_NAMES = 'vb-data-names'

/** The names an expression can read, for the inputs' autocomplete (decisions: a datalist, not CodeMirror's). */
export function NamesList({ project }: { project: Project }) {
  return <datalist id={DATA_NAMES}>
    {project.reads.flatMap(r => [`P.${r.id}`, `T.${r.id}`, `H.${r.id}`]).map(n => <option key={n} value={n} />)}
    {project.state.map(s => <option key={s.name} value={`S.${s.name}`} />)}
    {project.roles.flatMap(r => [`R.${r.id}.n`, `R.${r.id}.names`]).map(n => <option key={n} value={n} />)}
    {['X.', 'C.', 'E.v', 'alarms(3)', 'util.clock_time("HH:MM")', 'VB.unbound()'].map(n => <option key={n} value={n} />)}
  </datalist>
}

const KINDS = ['const', 'slider', 'sine', 'ramp', 'walk', 'keys'] as const
const START: Record<SimSource['kind'], SimSource> = { const: { kind: 'const', v: 0 }, slider: { kind: 'slider', v: 0, min: 0, max: 100 },
  sine: { kind: 'sine', mid: 0, amp: 1, period: 10 }, ramp: { kind: 'ramp', from: 0, to: 1, period: 10, loop: true },
  walk: { kind: 'walk', v: 0, step: 1, min: 0, max: 100, seed: 1 }, keys: { kind: 'keys', keys: [[0, 0], [10, 1]], loop: true } }

/** A typing burst publishes accepted values transiently and commits once on blur or Enter. Invalid drafts stay local.
 * Store callers supply onCommit (commitDrag); without it, onChange receives the final value non-transiently. */
export function DraftInput({ label, value, onChange, onCommit, accept = () => true, why, normalize = x => x,
  equivalent = (a, b) => a === b, list, size, placeholder }:
  { label: string; value: string; onChange: (text: string, transient?: boolean) => void; onCommit?: () => void;
    accept?: (text: string) => boolean; why?: (text: string) => string | null; normalize?: (text: string) => string;
    equivalent?: (text: string, value: string) => boolean; list?: string; size?: number; placeholder?: string }) {
  const [draft, setDraft] = useState({ value, text: value })
  const dirty = useRef(false), lastAccepted = useRef(value), id = useId()
  if (draft.value !== value) {
    const echo = equivalent(draft.text, value)
    if (!echo) dirty.current = false
    lastAccepted.current = value
    setDraft({ value, text: echo ? draft.text : value })
  }
  const finish = () => {
    if (!dirty.current) return
    dirty.current = false
    const text = accept(draft.text) ? normalize(draft.text) : lastAccepted.current
    if (accept(draft.text) && text !== draft.text) {
      setDraft({ value, text })
      lastAccepted.current = text
      onChange(text, true)
    }
    if (onCommit) onCommit()
    else onChange(text, false)
  }
  const message = why?.(draft.text)
  return <span className="vb-expr" data-label={label}>
    <input aria-label={label} size={size} list={list} placeholder={placeholder} value={draft.text}
      aria-invalid={message ? true : undefined} aria-describedby={message ? id : undefined}
      onChange={e => {
        const text = e.target.value
        setDraft({ value, text })
        if (accept(text)) { dirty.current = true; lastAccepted.current = text; onChange(text, true) }
      }} onBlur={finish} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); finish() } }} />
    {message && <small id={id} className="vb-expr-why">{message}</small>}
  </span>
}

/** A number draft keeps "-" and "1." as typed; normalization (such as the minimum period) waits for commit. */
function NumField({ label, value, onChange, onCommit, normalize = x => x }:
  { label: string; value: number; onChange: (v: number, transient?: boolean) => void; onCommit?: () => void; normalize?: (v: number) => number }) {
  const finite = (text: string) => text.trim() !== '' && Number.isFinite(Number(text))
  return <DraftInput label={label} size={6} value={String(value)} onChange={(text, transient) => onChange(Number(text), transient)}
    onCommit={onCommit} accept={finite} why={text => finite(text) ? null : 'enter a finite number'}
    normalize={text => String(normalize(Number(text)))}
    equivalent={(text, now) => finite(text) && Number(text) === Number(now)} />
}

/** A simulated source of any of the six kinds (spec §7). A slider's drag is transient (`onChange(s, true)`), committed by
 *  `onCommit` on release. Number and expression typing is transient until blur or Enter; keyframes are taken on commit. */
export function SourceEditor({ label, value: s, onChange, onCommit }:
  { label: string; value: SimSource; onChange: (s: SimSource, transient?: boolean) => void; onCommit?: () => void }) {
  const num = (name: string, v: number, put: (x: number) => SimSource, normalize?: (v: number) => number) =>
    <label key={`${s.kind}-${name}`}>{name} <NumField label={`${label} ${name}`} value={v}
      onChange={(x, transient) => onChange(put(x), transient)} onCommit={onCommit} normalize={normalize} /></label>
  const loop = (on: boolean, put: (x: boolean) => SimSource) =>
    <label><input type="checkbox" aria-label={`${label} loop`} checked={on} onChange={e => onChange(put(e.target.checked))} /> loop</label>
  const keysText = s.kind === 'keys' ? s.keys.map(([t, v]) => `${t}:${v}`).join(', ') : ''
  return <div className="vb-source-editor">
    <Segmented label={`${label} kind`} value={s.kind} onChange={kind => onChange(START[kind])} options={KINDS.map(value => ({ value, label: value }))} />
    <div className="grid3">
    {s.kind === 'const' && num('value', s.v, v => ({ ...s, v }))}
    {s.kind === 'slider' && <>
      <input type="range" aria-label={`${label} value`} min={s.min} max={s.max} step="any" value={s.v}
        onChange={e => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange({ ...s, v }, true) }} onPointerUp={onCommit}
        onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) onCommit?.() }} />
      {num('min', s.min, min => ({ ...s, min }))}{num('max', s.max, max => ({ ...s, max }))}</>}
    {s.kind === 'sine' && <>{num('mid', s.mid, mid => ({ ...s, mid }))}{num('amp', s.amp, amp => ({ ...s, amp }))}
      {num('period', s.period, period => ({ ...s, period }), v => Math.max(0.1, v))}</>}
    {s.kind === 'ramp' && <>{num('from', s.from, from => ({ ...s, from }))}{num('to', s.to, to => ({ ...s, to }))}
      {num('period', s.period, period => ({ ...s, period }), v => Math.max(0.1, v))}{loop(s.loop, x => ({ ...s, loop: x }))}</>}
    {s.kind === 'walk' && <>{num('start', s.v, v => ({ ...s, v }))}{num('step', s.step, v => ({ ...s, step: Math.abs(v) }), Math.abs)}
      {num('min', s.min, min => ({ ...s, min }))}{num('max', s.max, max => ({ ...s, max }))}{num('seed', s.seed, v => ({ ...s, seed: Math.trunc(v) }), Math.trunc)}</>}
    {s.kind === 'keys' && <>
      <DraftInput label={`${label} keys`} placeholder="t:v, t:v" value={keysText} onChange={(text, transient) => {
        if (transient) return
        const keys = text.split(',').flatMap(x => {
          const m = /^\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*$/.exec(x)
          const t = m ? Number(m[1]) : NaN, v = m ? Number(m[2]) : NaN
          return Number.isFinite(t) && Number.isFinite(v) ? [[t, v] as [number, number]] : []
        })
        if (keys.length) onChange({ ...s, keys: keys.sort((a, b) => a[0] - b[0]) })
      }} />
      {loop(s.loop, x => ({ ...s, loop: x }))}</>}
    </div>
  </div>
}

/** Expressions are kept as typed, including guarded text. Store callers forward transient and commitDrag onCommit. */
export function ExprInput({ label, value, onChange, onCommit, optional = false }:
  { label: string; value: string; onChange: (v: string, transient?: boolean) => void; onCommit?: () => void; optional?: boolean }) {
  return <DraftInput label={label} list={DATA_NAMES} value={value} onChange={onChange} onCommit={onCommit} why={s => optional && !s.trim() ? null : checkExpr(s)} />
}

/** `base` made a Lua name, with the smallest number that makes it free. */
export function uniqueName(base: string, taken: Iterable<string>): LuaName {
  const used = new Set(taken), clean = base.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') || 'x'
  const root = isLuaName(clean) ? clean : `${clean}_`
  if (!used.has(root)) return root
  let k = 2
  while (used.has(`${root}${k}`)) k++
  return `${root}${k}`
}

export const ltFrom = (text: string): LogicRef | null =>
  /^#\d+$/.test(text.trim()) ? { id: Number(text.trim().slice(1)) } : /^\w+$/.test(text.trim()) ? { name: text.trim() } : null
export const ltText = (r: LogicRef) => 'name' in r ? r.name : `#${r.id}`

/** The simulated devices with the role's first one given a starting source for `lt` when it has none (a read's preview source,
 *  spec §6.1: a view of the device's value). */
export function withPreviewSource(p: Project, roleId: string, lt: LogicRef, cat: Catalog | null): SimDevice[] {
  const key = ltText(lt), k = p.simDevices.findIndex(d => d.role === roleId)
  if (k < 0 || Object.hasOwn(p.simDevices[k].values, key) || !cat) return p.simDevices
  return p.simDevices.map((d, i) => i === k ? { ...d, values: { ...d.values, [key]: defaultSource('name' in lt ? lt.name : '') } } : d)
}
