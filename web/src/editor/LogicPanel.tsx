// The Logic panel (spec §6.2): roles, reads, state, actions and rules in open cards. "wire" turns a
// widget plate's suggested step into a state, an action and the slot's binding in one undo step; adding a role adds its
// simulated device; renaming an id carries every reference (renameLogic, on blur).
import { useId, useState, type ReactNode } from 'react'
import { deviceOf, pulseTypes, readableTypes, titleOf, writableTypes, type Catalog } from '../catalog'
import { defaultSource } from '../catalog/defaults'
import { clickTargets, parseStep, type ClickTarget } from '../codegen/clicks'
import { AGGS, DEVICES_PAGE, UNITS, isLuaName, type Bound, type ClickAction, type Logic, type Pin, type Read, type Role, type Rule, type SimSource, type StateVar,
  type Step } from '../model/logic'
import type { Project } from '../model/project'
import { nodeAt, type Action } from '../model/store'
import type { Theme } from '../theme/types'
import { slotsOf, widgetsIn } from '../widgets/core'
import { DraftInput, ExprInput, ltFrom, ltText, SourceEditor, uniqueName, withPreviewSource } from './logicUi'
import { Segmented } from '../ui/Segmented'
import './panels.css'

type Props = { project: Project; theme: Theme; dispatch: (a: Action) => void; catalog: Catalog | null; roleDevice?: (roleId: string) => ReactNode }
const SLOT_OF = { toggle: 'on', cycle: 'state', set: 'sel', step: 'v' } as const
const wiredState = (p: Project, key: string | undefined, base: string, type: StateVar['type']) => {
  const binding = key ? p.bindings[key] : undefined
  const name = binding?.from === 'state' ? binding.state : base
  return p.state.find(s => s.name === name && s.type === type)
}

/** A plate's suggested step as one patch: the state it drives (reused when wired already), the action, the slot's binding. */
export function wire(p: Project, target: ClickTarget, t: Theme): Partial<Logic> | null {
  const id = uniqueName(`a_${target.id}`, p.actions.map(a => a.id))
  if (target.native) {   // a text input's change sets a string state, which its value shows (native value binding)
    const base = `${target.id}_value`, existing = wiredState(p, `@${target.id}.value`, base, 'string')
    const name = existing?.name ?? uniqueName(base, p.state.map(x => x.name))
    return { state: existing ? p.state : [...p.state, { name, type: 'string', init: '' }],
      actions: [...p.actions, { id, on: target.id, do: [{ op: 'set', state: name, value: 'E.v' }] }],
      bindings: { ...p.bindings, [`@${target.id}.value`]: { from: 'state', state: name } } }
  }
  const s = parseStep(target.step)
  if (s.op === 'none' || s.op === 'index') return null
  if (s.op === 'page') return { actions: [...p.actions, { id, on: target.id, do: [{ op: 'page', page: s.page }] }] }
  const found = p.pages.flatMap(pg => widgetsIn(pg.scene, t).map(w => ({ ...w, scene: pg.scene }))).find(w => w.ref.uid === target.widget)
  const w = found?.ref, root = found && nodeAt(found.scene.root, found.path), slot = root && slotsOf(root, t).find(x => x.slot === SLOT_OF[s.op])
  const base = `${target.widget ?? target.id}_${SLOT_OF[s.op]}`
  const existing = wiredState(p, slot?.key, base, s.op === 'toggle' ? 'bool' : 'number')
  const name = existing?.name ?? uniqueName(base, p.state.map(x => x.name))
  const states = Array.isArray(w?.params.states) ? w.params.states.length : 2
  const state: StateVar = existing ?? (s.op === 'toggle' ? { name, type: 'bool', init: false }
    : s.op === 'cycle' ? { name, type: 'number', init: 0, min: 0, max: states - 1 }
    : s.op === 'step' ? { name, type: 'number', init: s.min, min: s.min, max: s.max } : { name, type: 'number', init: 0 })
  const step: Step = s.op === 'toggle' || s.op === 'cycle' ? { op: s.op, state: name } : s.op === 'set' ? { op: 'set', state: name, value: String(s.value) }
    : { op: 'step', state: name, by: s.by, min: s.min, max: s.max }
  return { state: existing ? p.state : [...p.state, state], actions: [...p.actions, { id, on: target.id, do: [step] }],
    ...(slot && { bindings: { ...p.bindings, [slot.key]: { from: 'state' as const, state: name } } }) }
}

/** A role for `prefab` and one matching simulated device (spec 7), as one patch. */
export function addRole(p: Project, prefab: string, cat: Catalog | null): Partial<Logic> {
  const d = cat && deviceOf(cat, prefab), title = d ? titleOf(d) : prefab
  const id = uniqueName(title.replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase()), p.roles.map(r => r.id))
  const ref = Math.max(1, ...p.simDevices.map(x => x.ref)) + 1
  return { roles: [...p.roles, { id, name: title, prefabs: [prefab], mode: 'one' }],
    simDevices: [...p.simDevices, { id: uniqueName(`sim${ref}`, p.simDevices.map(x => x.id)), prefab, label: title, ref, role: id, values: {} }] }
}

const num = (s: string) => s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : Number(s)
const modelNumber = (v: number | undefined) => v !== undefined && Math.abs(v) > 1e12 ? 'Must be between -1e12 and 1e12' : undefined
const positive = (v: number | undefined) => modelNumber(v) ?? (v !== undefined && v <= 0 ? 'Must be greater than zero; leave empty to clear' : undefined)
const positiveInt = (v: number | undefined) => v !== undefined && (!Number.isInteger(v) || v < 1) ? 'Must be an integer of at least 1; leave empty to clear' : undefined
const nonnegativeInt = (v: number | undefined) => v !== undefined && (!Number.isInteger(v) || v < 0) ? 'Must be a non-negative integer' : undefined
const words = (text: string) => text.split(',').map(x => x.trim()).filter(Boolean)
const typeFrom = (text: string) => {
  const lt = ltFrom(text)
  return lt && ('name' in lt || Number.isInteger(lt.id)) ? lt : null
}
const readFrom = (text: string): Read['of'] | null => {
  const m = /^(\d+):(\w+)$/.exec(text.trim())
  if (m) return Number.isInteger(Number(m[1])) ? { slot: Number(m[1]), lst: m[2] } : null
  const lt = typeFrom(text)
  return lt ? { lt } : null
}
function NumInput({ label, value, onChange, onCommit, why = modelNumber }: { label: string; value: number | undefined;
  onChange: (v: number | undefined, transient?: boolean) => void; onCommit: () => void; why?: (v: number | undefined) => string | undefined }) {
  const errorOf = (text: string) => text.trim() && num(text) === undefined ? 'Enter a finite number' : why(num(text))
  return <DraftInput label={label} size={6} value={value === undefined ? '' : String(value)}
    onChange={(text, transient) => onChange(num(text), transient)} onCommit={onCommit}
    accept={text => !errorOf(text)} why={text => errorOf(text) ?? null}
    equivalent={(text, now) => num(text) !== undefined && num(text) === num(now) || text === now} />
}
/** Lists and LogicTypes are drafts until commit: separators and partial names never enter the model. */
function CommitInput({ label, value, onCommit, why, list, placeholder }: { label: string; value: string; onCommit: (text: string) => void;
  why?: (text: string) => string | undefined; list?: string; placeholder?: string }) {
  // No onCommit prop: DraftInput reports the final text with transient=false. Validation sees that final draft,
  // rather than a parsed or last-accepted prefix. The model receives exactly one discrete patch.
  return <DraftInput label={label} size={10} list={list} placeholder={placeholder} value={value} why={text => why?.(text) ?? null}
    onChange={(text, transient) => { if (!transient && !why?.(text)) onCommit(text) }} />
}
function RenameInput({ label, value, onRename, why }: { label: string; value: string; onRename: (to: string) => void; why?: (to: string) => string | undefined }) {
  return <CommitInput label={label} value={value} onCommit={to => { if (to !== value) onRename(to) }} why={why} />
}
/** A "lo..hi" range typed in one field and taken on leaving it (either order); empty clears it. */
function RangeInput({ label, value, onChange, why }: { label: string; value: [number, number] | undefined;
  onChange: (v: [number, number] | undefined) => void; why?: (v: [number, number] | undefined) => string | undefined }) {
  const text = value ? `${value[0]}..${value[1]}` : ''
  const rangeFrom = (t: string): [number, number] | undefined => {
    const m = /^(-?[\d.]+(?:e[+-]?\d+)?)\s*\.\.\s*(-?[\d.]+(?:e[+-]?\d+)?)$/i.exec(t.trim())
    const a = Number(m?.[1]), b = Number(m?.[2])
    return m && Number.isFinite(a) && Number.isFinite(b) ? a <= b ? [a, b] : [b, a] : undefined
  }
  return <CommitInput label={label} placeholder="lo..hi" value={text} why={t => {
    const range = rangeFrom(t)
    if (t.trim() && !range) return 'Enter two finite numbers as lo..hi'
    return (range && (modelNumber(range[0]) ?? modelNumber(range[1]))) || why?.(range)
  }} onCommit={t => { if (t.trim() || value) onChange(rangeFrom(t)) }} />
}
/** A step bound: a number, or a Lua expression evaluated when the step runs. */
function BoundInput({ label, value, onChange, onCommit, why }: { label: string; value: Bound; onChange: (b: Bound, transient?: boolean) => void;
  onCommit: () => void; why: (b: Bound) => string | undefined }) {
  const [draft, setDraft] = useState({ value, text: String(value) })
  if (draft.value !== value) setDraft({ value, text: num(draft.text) === value ? draft.text : String(value) })
  const error = why(num(draft.text) ?? draft.text)
  return <span><ExprInput label={label} value={draft.text} onCommit={onCommit} onChange={(text, transient) => {
    setDraft({ value, text })
    const bound = num(text) ?? text
    if (!why(bound)) onChange(bound, transient)
  }} />{error && <small role="alert">{error}</small>}</span>
}
function EnumInit({ label, value, options, onChange }: { label: string; value: number; options: string[]; onChange: (v: number) => void }) {
  const [error, setError] = useState(''), id = useId()
  return <span className="vb-expr" data-label={label}><select aria-label={label} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? id : undefined}
    onChange={e => {
      const v = num(e.target.value)
      if (v === undefined || !Number.isInteger(v) || v < 0 || v >= options.length) { setError('Choose an initial index within the options'); return }
      setError(''); onChange(v)
    }}>{options.map((o, i) => <option key={i} value={i}>{o}</option>)}</select>
    {error && <small id={id}>{error}</small>}</span>
}
const luaNameWhy = (text: string) => isLuaName(text) ? undefined : 'Use a Lua name: letters, digits and _, not a keyword'
function sourceWhy(s: SimSource): string | undefined {
  if (Object.values(s).some(v => typeof v === 'number' && (!Number.isFinite(v) || Math.abs(v) > 1e12))) return 'Source numbers must be finite and within -1e12..1e12'
  if ('period' in s && s.period <= 0) return 'Source period must be greater than zero'
  if ('min' in s && (s.min > s.max || s.v < s.min || s.v > s.max)) return 'Source min must be no greater than max, and its value must be within the range'
  if (s.kind === 'walk' && (s.step < 0 || !Number.isInteger(s.seed) || Math.abs(s.seed) > 2 ** 31 - 1)) return 'Source walk step must be non-negative and seed a 32-bit integer'
  if (s.kind === 'keys' && (!s.keys.length || s.keys.some(k => k.some(v => !Number.isFinite(v) || Math.abs(v) > 1e12)))) return 'Source keys need finite times and values within -1e12..1e12'
  return undefined
}
/** One step of an action, every field of its op editable (spec §6.2). */
function StepEditor({ label, step: s, project: p, onChange, onCommit }: { label: string; step: Step; project: Project;
  onChange: (s: Step, transient?: boolean) => void; onCommit: () => void }) {
  const state = (x: Extract<Step, { state: string }>) => <select aria-label={`${label} state`} value={x.state} onChange={e => onChange({ ...x, state: e.target.value })}>
    {[...new Set([x.state, ...p.state.map(v => v.name)])].map(n => <option key={n}>{n}</option>)}</select>
  switch (s.op) {
    case 'page': return <select aria-label={`${label} page`} value={s.page} onChange={e => onChange({ ...s, page: e.target.value })}>
      {[...new Set([s.page, ...p.pages.map(x => x.id), DEVICES_PAGE])].map(id => <option key={id} value={id}>{p.pages.find(x => x.id === id)?.name ?? (id === DEVICES_PAGE ? 'Devices' : id)}</option>)}</select>
    case 'set': return <>{state(s)}<ExprInput label={`${label} value`} value={s.value} onChange={(value, transient) => onChange({ ...s, value }, transient)} onCommit={onCommit} /></>
    case 'toggle': case 'cycle': return state(s)
    case 'step': return <>{state(s)}<NumInput label={`${label} by`} value={s.by} onCommit={onCommit}
      onChange={(by, transient) => by !== undefined && onChange({ ...s, by }, transient)} />
      <BoundInput label={`${label} min`} value={s.min} onChange={(min, transient) => onChange({ ...s, min }, transient)} onCommit={onCommit}
        why={min => typeof min === 'number' && typeof s.max === 'number' && min > s.max ? 'Min bound must be no greater than max' : undefined} />
      <BoundInput label={`${label} max`} value={s.max} onChange={(max, transient) => onChange({ ...s, max }, transient)} onCommit={onCommit}
        why={max => typeof max === 'number' && typeof s.min === 'number' && max < s.min ? 'Max bound must be no less than min' : undefined} /></>
    case 'command': return <CommitInput label={`${label} flag`} value={s.flag} why={luaNameWhy} onCommit={flag => onChange({ ...s, flag })} />
    case 'log': return <><ExprInput label={`${label} text`} value={s.text} onChange={(text, transient) => onChange({ ...s, text }, transient)} onCommit={onCommit} />
      <Segmented label={`${label} level`} value={String(s.level ?? 1)} onChange={level => onChange({ ...s, level: Number(level) as 0 | 1 | 2 | 3 })}
        options={[0, 1, 2, 3].map(l => ({ value: String(l), label: String(l) }))} /></>
    case 'call': return <CommitInput label={`${label} fn`} value={s.fn} why={luaNameWhy} onCommit={fn => onChange({ ...s, fn })} />
  }
}

export function LogicPanel({ project: p, theme, dispatch, catalog, roleDevice }: Props) {
  const set = (patch: Partial<Logic>, transient = false) => dispatch({ type: 'setLogic', patch, ...(transient && { transient: true }) })
  const commit = () => dispatch({ type: 'commitDrag' })
  const [sourceErrors, setSourceErrors] = useState<Record<string, string | undefined>>({})
  const swap = <T,>(list: T[], k: number, x: T | null) => x === null ? list.filter((_, i) => i !== k) : list.map((y, i) => i === k ? x : y)
  const move = <T,>(list: T[], k: number, by: -1 | 1) => {
    const j = k + by, out = [...list]
    if (j < 0 || j >= list.length) return list
    ;[out[k], out[j]] = [out[j], out[k]]
    return out
  }
  const targets = p.pages.flatMap(pg => clickTargets(pg, theme))
  // A raw id several pages hold: an action takes one page's node, or every page's (ruling P18). Widget and native uids are
  // project-wide, so their targets are never scoped.
  const pagesOf = (id: string) => targets.filter(t => t.id === id).map(t => t.page)
  const scoped = (t: ClickTarget) => !t.widget && !t.native && pagesOf(t.id).length > 1
  const choices = [...targets.map(t => ({ on: t.id, page: scoped(t) ? t.page : undefined })), ...targets.filter(scoped).map(t => ({ on: t.id, page: undefined }))]
    .filter((c, i, all) => all.findIndex(x => x.on === c.on && x.page === c.page) === i)
  const choiceText = (c: { on: string; page?: string }) => c.page !== undefined ? `${p.pages.find(x => x.id === c.page)?.name ?? c.page}: ${c.on}`
    : pagesOf(c.on).length > 1 ? `${c.on} (every page)` : c.on
  const [prefab, setPrefab] = useState('')
  const sim = (r: Read) => p.simDevices.find(d => d.role === r.role)
  const ltKey = (r: Read) => 'lt' in r.of ? ltText(r.of.lt) : r.of.lst
  const idWhy = (to: string, current: string, ids: string[]) => !to.trim() ? 'An id cannot be empty'
    : to !== current && ids.includes(to) ? `${to} exists already` : undefined
  const nameWhy = (to: string, current: string, ids: string[]) => !isLuaName(to) ? 'Use a Lua name: letters, digits and _, not a keyword'
    : idWhy(to, current, ids)
  const typesOf = (roleId: string, f: typeof readableTypes) => { const role = p.roles.find(x => x.id === roleId); return role && catalog ? f(catalog, role.prefabs).types : [] }
  return <section className="vb-logic" aria-label="Logic">
    <datalist id="vb-prefabs">{catalog?.devices.map(d => <option key={d.name} value={d.name}>{`${titleOf(d)}${d.origin === 'mod' ? ' (mod)' : ''}`}</option>)}</datalist>

    <details className="disc" open><summary><span className="ptitle">Roles</span><span className="unit">{p.roles.length}</span></summary>
    {p.roles.map((r, k) => {
      const put = (x: Role, transient = false) => set({ roles: swap(p.roles, k, x) }, transient)
      return <details key={r.id} className="raised" open>
        <summary><strong>{r.name}</strong><span className="unit">{r.mode} · {r.pin === undefined ? 'Scan' : `d${r.pin}`}</span></summary>
        <div className="grid2">
        <RenameInput label={`role id ${r.id}`} value={r.id} onRename={to => dispatch({ type: 'renameLogic', kind: 'role', from: r.id, to })}
          why={to => nameWhy(to, r.id, p.roles.map(x => x.id))} />
        <DraftInput label={`role name ${r.id}`} value={r.name} onChange={(name, transient) => put({ ...r, name }, transient)} onCommit={commit}
          accept={text => !!text} why={text => text ? null : 'A role needs a name'} />
        <CommitInput label={`role prefabs ${r.id}`} list="vb-prefabs" value={r.prefabs.join(', ')}
          onCommit={text => put({ ...r, prefabs: words(text) })} />
        <DraftInput label={`role label ${r.id}`} placeholder="Labeller name" value={r.label ?? ''} onCommit={commit}
          onChange={(label, transient) => put(label ? { ...r, label } : (({ label: _, ...x }) => x)(r), transient)} />
        <Segmented label={`role mode ${r.id}`} value={r.mode} onChange={mode => put({ ...r, mode })} options={(['one', 'all'] as const).map(value => ({ value, label: value }))} />
        <Segmented label={`role pin ${r.id}`} value={r.pin === undefined ? '' : String(r.pin)} onChange={value => {
          // The role's simulated devices move to the same pin, so the preview reads them there.
          const pin = value === '' ? undefined : Number(value) as Pin
          set({ roles: swap<Role>(p.roles, k, pin === undefined ? (({ pin: _, ...x }) => x)(r) : { ...r, pin }),
            simDevices: p.simDevices.map(d => d.role !== r.id ? d : pin === undefined ? (({ pin: _, ...x }) => x)(d) : { ...d, pin }) })
        }} options={[{ value: '', label: 'Scan' }, ...[0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `d${n}` }))]} />
        <details className="vb-role-device"><summary><span className="chip idle">Advanced</span> Pin to one specific device</summary>
        <NumInput label={`role ref ${r.id}`} value={r.ref} onCommit={commit}
          why={v => positiveInt(v) ?? (v !== undefined && v > Number.MAX_SAFE_INTEGER ? 'Must be a safe integer ReferenceId' : undefined)}
          onChange={(v, transient) => put(v !== undefined ? { ...r, ref: v } : (({ ref: _, ...x }) => x)(r), transient)} />
        </details>
        {roleDevice?.(r.id)}
        <label><input type="checkbox" aria-label={`role optional ${r.id}`} checked={!!r.optional}
          onChange={e => put(e.target.checked ? { ...r, optional: true } : (({ optional: _, ...x }) => x)(r))} /> optional</label>
        <button type="button" aria-label={`remove role ${r.id}`} onClick={() => set({ roles: swap(p.roles, k, null) })}>remove</button>
        </div>
      </details>
    })}
    <input aria-label="new role prefab" list="vb-prefabs" value={prefab} onChange={e => setPrefab(e.target.value)} placeholder="prefab" />
    <button type="button" aria-label="add role" disabled={!prefab} onClick={() => { set(addRole(p, prefab, catalog)); setPrefab('') }}>add role</button>
    </details>

    <details className="disc" open><summary><span className="ptitle">Reads</span><span className="unit">{p.reads.length}</span></summary>
    {p.reads.map((r, k) => {
      const put = (x: Read, transient = false) => set({ reads: swap(p.reads, k, x) }, transient), d = sim(r), key = ltKey(r)
      const slot = 'slot' in r.of ? String(r.of.slot) : undefined
      const src = d ? (slot === undefined ? d.values[key] : d.slots?.[slot]?.[key]) ?? defaultSource(key) : undefined
      const setSrc = (s: SimSource, all = false, transient = false) => {
        const error = sourceWhy(s)
        setSourceErrors(errors => ({ ...errors, [r.id]: error }))
        if (error) return
        set({ simDevices: p.simDevices.map(x => x.role !== r.role || (!all && x !== d) ? x
          : slot === undefined ? { ...x, values: { ...x.values, [key]: s } }
          : { ...x, slots: { ...x.slots, [slot]: { ...x.slots?.[slot], [key]: s } } }) }, transient)
      }
      const clampTo = (v?: [number, number]) => put(v ? { ...r, clamp: v } : (({ clamp: _, ...x }) => x)(r))
      const validTo = (v?: [number, number]) => put(v ? { ...r, valid: v } : (({ valid: _, ...x }) => x)(r))
      return <details key={r.id} className="raised" open>
        <summary><strong>{r.id}</strong><span className="unit">{'lt' in r.of ? ltText(r.of.lt) : `${r.of.slot}:${r.of.lst}`}</span></summary>
        <div className="grid2">
        <RenameInput label={`read id ${r.id}`} value={r.id} onRename={to => dispatch({ type: 'renameLogic', kind: 'read', from: r.id, to })}
          why={to => nameWhy(to, r.id, p.reads.map(x => x.id))} />
        <select aria-label={`read role ${r.id}`} value={r.role} onChange={e => put({ ...r, role: e.target.value })}>{p.roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <CommitInput label={`read type ${r.id}`} list={`vb-readable-${r.id}`} value={'lt' in r.of ? ltText(r.of.lt) : `${r.of.slot}:${r.of.lst}`}
          why={text => readFrom(text) ? undefined : 'Use a LogicType name, integer #id or slot:LogicSlotType'} onCommit={text => {
          const of = readFrom(text)
          if (!of) return
          if ('lt' in of) set({ reads: swap(p.reads, k, { ...r, of }), simDevices: withPreviewSource(p, r.role, of.lt, catalog) })
          else put({ ...r, of })
        }} />
        <datalist id={`vb-readable-${r.id}`}>{typesOf(r.role, readableTypes).map(x => <option key={x} value={x} />)}</datalist>
        {p.roles.find(role => role.id === r.role)?.mode === 'all' && <Segmented label={`read aggregate ${r.id}`} value={r.agg ?? 'avg'} onChange={agg => put({ ...r, agg })} options={AGGS.map(value => ({ value, label: value }))} />}
        <RangeInput label={`read valid ${r.id}`} value={r.valid} onChange={validTo} />
        <select aria-label={`read unit ${r.id}`} value={r.unit ?? ''} onChange={e => put(e.target.value ? { ...r, unit: e.target.value as Read['unit'] } : (({ unit: _, ...x }) => x)(r))}>
          <option value="">no unit</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select>
        <NumInput label={`read scale ${r.id}`} value={r.scale} onChange={(v, transient) => put({ ...r, scale: v }, transient)} onCommit={commit} />
        <NumInput label={`read offset ${r.id}`} value={r.offset} onChange={(v, transient) => put({ ...r, offset: v }, transient)} onCommit={commit} />
        <RangeInput label={`read clamp ${r.id}`} value={r.clamp} onChange={clampTo} />
        <RangeInput label={`read map ${r.id}`} value={r.scale && r.scale > 0 && r.clamp?.[0] === 0 && r.clamp[1] === 1 ? [-(r.offset ?? 0) / r.scale, (1 - (r.offset ?? 0)) / r.scale] : undefined}
          why={v => {
            if (!v) return undefined
            const width = v[1] - v[0]
            if (!width) return 'Map range must have different endpoints'
            return [1 / width, -v[0] / width].some(n => !Number.isFinite(n) || !!modelNumber(n))
              ? 'Map scale and offset must be finite and within -1e12..1e12' : undefined
          }}
          onChange={v => v && v[1] > v[0] && put({ ...r, scale: 1 / (v[1] - v[0]), offset: -v[0] / (v[1] - v[0]), clamp: [0, 1] })} />
        <NumInput label={`read smooth ${r.id}`} value={r.smooth} why={positive} onChange={(v, transient) => put({ ...r, smooth: v }, transient)} onCommit={commit} />
        <ExprInput optional label={`read derived ${r.id}`} value={r.derived ?? ''} onChange={(v, transient) => put(v ? { ...r, derived: v } : (({ derived: _, ...x }) => x)(r), transient)} onCommit={commit} />
        {(['critBelow', 'warnBelow', 'warnAbove', 'critAbove', 'hyst'] as const).map(edge =>
          <NumInput key={edge} label={`read ${edge} ${r.id}`} value={r.th?.[edge]} why={edge === 'hyst' ? positive : modelNumber}
            onChange={(v, transient) => put({ ...r, th: { ...r.th, [edge]: v } }, transient)} onCommit={commit} />)}
        <DraftInput label={`read log ${r.id}`} placeholder="log as" value={r.th?.log ?? ''} onCommit={commit}
          onChange={(log, transient) => put({ ...r, th: log ? { ...r.th, log } : (({ log: _, ...x }: NonNullable<Read['th']>) => x)(r.th ?? {}) }, transient)} />
        <NumInput label={`read history ${r.id}`} value={r.history?.n} why={positiveInt} onCommit={commit}
          onChange={(v, transient) => put(v !== undefined ? { ...r, history: { ...r.history, n: v } } : (({ history: _, ...x }) => x)(r), transient)} />
        {r.history && <NumInput label={`read history every ${r.id}`} value={r.history.every} onCommit={commit}
          why={positiveInt} onChange={(v, transient) => put({ ...r, history: v !== undefined ? { ...r.history!, every: v } : { n: r.history!.n } }, transient)} />}
        {src && <div className="vb-read-preview"> preview <SourceEditor label={`read source ${r.id}`} value={src} onChange={(s, transient) => setSrc(s, false, transient)}
            onCommit={commit} />{sourceErrors[r.id] && <small role="alert">{sourceErrors[r.id]}</small>}
          <button type="button" aria-label={`read source to all ${r.id}`} onClick={() => setSrc(src, true)}>apply to all</button></div>}
        <button type="button" aria-label={`remove read ${r.id}`} onClick={() => set({ reads: swap(p.reads, k, null) })}>remove</button>
        </div>
      </details>
    })}
    </details>

    <details className="disc" open><summary><span className="ptitle">State</span><span className="unit">{p.state.length}</span></summary>
    {p.state.map((s, k) => {
      const put = (x: StateVar, transient = false) => set({ state: swap(p.state, k, x) }, transient)
      return <details key={s.name} className="raised" open>
        <summary><strong>{s.name}</strong><span className="unit">{s.type}</span></summary>
        <div className="grid2">
        <RenameInput label={`state name ${s.name}`} value={s.name} onRename={to => dispatch({ type: 'renameLogic', kind: 'state', from: s.name, to })}
          why={to => nameWhy(to, s.name, p.state.map(x => x.name))} />
        <Segmented label={`state type ${s.name}`} value={s.type} onChange={type => {
          // Range, options and mirrored units belong to their type; `save` does not, so a type change keeps it.
          put({ name: s.name, type, init: type === 'bool' ? false : type === 'string' ? '' : 0, ...(type === 'enum' && { options: ['a', 'b'] }),
            ...(s.save === false && { save: false }) })
        }} options={(['number', 'bool', 'enum', 'string'] as const).map(value => ({ value, label: value }))} />
        {s.type === 'number' && <NumInput label={`state init ${s.name}`} value={Number(s.init)} onChange={(v, transient) => v !== undefined && put({ ...s, init: v }, transient)} onCommit={commit} />}
        {s.type === 'bool' && <label><input type="checkbox" aria-label={`state init ${s.name}`} checked={s.init === true} onChange={e => put({ ...s, init: e.target.checked })} /> on at start</label>}
        {s.type === 'enum' && <EnumInit label={`state init ${s.name}`} value={Number(s.init)} options={s.options ?? []} onChange={init => put({ ...s, init })} />}
        {s.type === 'string' && <><DraftInput label={`state init ${s.name}`} value={String(s.init)} onChange={(init, transient) => put({ ...s, init }, transient)} onCommit={commit} />
          <NumInput label={`state units ${s.name}`} value={s.mirrorBytes} onCommit={commit}
            why={nonnegativeInt}
            onChange={(v, transient) => put(v !== undefined ? { ...s, mirrorBytes: v } : (({ mirrorBytes: _, ...x }) => x)(s), transient)} /></>}
        {s.type === 'enum' && <CommitInput label={`state options ${s.name}`} value={(s.options ?? []).join(', ')}
          why={text => !words(text).length ? 'An enum needs at least one option' : Number(s.init) >= words(text).length ? 'Keep an option for the initial index, or change init first' : undefined}
          onCommit={text => put({ ...s, options: words(text) })} />}
        {s.type === 'number' && <><NumInput label={`state min ${s.name}`} value={s.min}
          why={v => modelNumber(v) ?? (v !== undefined && s.max !== undefined && v > s.max ? 'Min must be no greater than max' : undefined)}
          onChange={(v, transient) => put({ ...s, min: v }, transient)} onCommit={commit} />
          <NumInput label={`state max ${s.name}`} value={s.max}
            why={v => modelNumber(v) ?? (v !== undefined && s.min !== undefined && v < s.min ? 'Max must be no less than min' : undefined)}
            onChange={(v, transient) => put({ ...s, max: v }, transient)} onCommit={commit} /></>}
        <label><input type="checkbox" aria-label={`state save ${s.name}`} checked={s.save !== false} onChange={e => put({ ...s, save: e.target.checked })} /> saved</label>
        <button type="button" aria-label={`remove state ${s.name}`} onClick={() => set({ state: swap(p.state, k, null) })}>remove</button>
        </div>
      </details>
    })}
    <button type="button" aria-label="add state" onClick={() => set({ state: [...p.state, { name: uniqueName('state', p.state.map(s => s.name)), type: 'number', init: 0 }] })}>add state</button>
    </details>

    <details className="disc" open><summary><span className="ptitle">Actions</span><span className="unit">{p.actions.length}</span></summary>
    {targets.map(t => {
      const w = wire(p, t, theme), has = p.actions.some(a => a.on === t.id && (a.page === undefined || a.page === t.page))
      return <div key={`${t.page}/${t.id}`} className="raised vb-target-row">
        <code>{t.id}</code> <small>{t.step || (t.native ? 'on change' : 'click')}{t.press ? ' (press)' : ''}{scoped(t) ? ` on ${t.page}` : ''}</small>
        {!has && (w ? <button type="button" aria-label={`wire ${t.id}`} onClick={() => set(w)}>wire</button>
          : <button type="button" aria-label={`add action ${t.page}/${t.id}`} onClick={() => set({ actions: [...p.actions,
              { id: uniqueName(`a_${t.id}`, p.actions.map(a => a.id)), on: t.id, ...(scoped(t) && { page: t.page }), do: [] }] })}>add action</button>)}
      </div>
    })}
    {p.actions.map((a, k) => {
      const put = (x: ClickAction, transient = false) => set({ actions: swap(p.actions, k, x) }, transient)
      const at = choices.findIndex(c => c.on === a.on && c.page === a.page)
      return <details key={a.id} className="raised" open>
        <summary><strong>{a.id}</strong><span className="unit">{choiceText(a)}</span></summary>
        <div className="grid2">
        <RenameInput label={`action id ${a.id}`} value={a.id} onRename={id => put({ ...a, id })}
          why={to => idWhy(to, a.id, p.actions.map(x => x.id))} />
        <select aria-label={`action on ${a.id}`} value={at < 0 ? '' : String(at)} onChange={e => {
          const c = choices[Number(e.target.value)]
          if (c) put({ ...(({ page: _, ...x }) => x)(a), on: c.on, ...(c.page !== undefined && { page: c.page }) })
        }}>
          {at < 0 && <option value="">{a.page !== undefined ? `${a.page}: ${a.on}` : a.on}</option>}
          {choices.map((c, i) => <option key={i} value={i}>{choiceText(c)}</option>)}</select>
        <ExprInput optional label={`action when ${a.id}`} value={a.when ?? ''} onChange={(v, transient) => put(v ? { ...a, when: v } : (({ when: _, ...x }) => x)(a), transient)} onCommit={commit} />
        {a.do.map((s, j) => <div key={j} className="vb-step">
          <StepEditor label={`step ${j} of ${a.id}`} step={s} project={p} onChange={(x, transient) => put({ ...a, do: a.do.map((y, i) => i === j ? x : y) }, transient)} onCommit={commit} />
          <button type="button" aria-label={`remove step ${j} of ${a.id}`} onClick={() => put({ ...a, do: a.do.filter((_, i) => i !== j) })}>×</button></div>)}
        <select aria-label={`add step to ${a.id}`} value="" onChange={e => {
          const st = p.state[0]?.name, op = e.target.value
          const step: Step | null = op === 'command' ? { op, flag: 'go' } : op === 'log' ? { op, text: '"pressed"' } : op === 'page' ? { op, page: p.pages[0].id }
            : op === 'call' ? { op, fn: 'f' } : st && op === 'set' ? { op, state: st, value: '0' } : st && (op === 'toggle' || op === 'cycle') ? { op, state: st }
            : st && op === 'step' ? { op, state: st, by: 1, min: 0, max: 10 } : null
          if (step) put({ ...a, do: [...a.do, step] })
        }}><option value="">+ step</option>{['page', 'set', 'toggle', 'cycle', 'step', 'command', 'log', 'call'].map(x => <option key={x}>{x}</option>)}</select>
        <button type="button" aria-label={`remove action ${a.id}`} onClick={() => set({ actions: swap(p.actions, k, null) })}>remove</button>
        </div>
      </details>
    })}
    </details>

    <details className="disc" open><summary><span className="ptitle">Rules</span><span className="unit">{p.rules.length}</span></summary>
    {p.rules.map((r, k) => {
      const role = p.roles.find(x => x.id === r.role), types = typesOf(r.role, writableTypes)
      const put = (x: Rule, transient = false) => set({ rules: swap(p.rules, k, x) }, transient)
      return <details key={r.id} className="raised" open>
        <summary><strong>{r.id}</strong><span className="unit">{r.role}</span></summary>
        <div className="grid2">
        <RenameInput label={`rule id ${r.id}`} value={r.id} onRename={id => put({ ...r, id })}
          why={to => idWhy(to, r.id, p.rules.map(x => x.id))} />
        <select aria-label={`rule role ${r.id}`} value={r.role} onChange={e => put({ ...r, role: e.target.value })}>{p.roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <CommitInput label={`rule ${r.id} type`} list={`vb-writable-${r.id}`} value={ltText(r.lt)}
          why={text => typeFrom(text) ? undefined : 'Use a LogicType name or integer #id'} onCommit={text => {
          const lt = typeFrom(text)
          if (!lt) return
          const pulse = !!(role && catalog && 'name' in lt && pulseTypes(catalog, role.prefabs).types.includes(lt.name))
          const { pulse: _, ...rest } = r
          put({ ...rest, lt, ...(pulse && { pulse: true as const }) })
        }} />
        <datalist id={`vb-writable-${r.id}`}>{types.map(x => <option key={x} value={x}>{pulseTypes(catalog!, role!.prefabs).types.includes(x) ? `${x} (pulse)` : x}</option>)}</datalist>
        <ExprInput label={`rule value ${r.id}`} value={r.value} onChange={(value, transient) => put({ ...r, value }, transient)} onCommit={commit} />
        <label><input type="checkbox" aria-label={`rule pulse ${r.id}`} checked={!!r.pulse}
          onChange={e => put(e.target.checked ? { ...r, pulse: true } : (({ pulse: _, ...x }) => x)(r))} /> pulse</label>
        <label><input type="checkbox" aria-label={`rule skip boot ${r.id}`} checked={!!r.skipBoot} onChange={e => put({ ...r, skipBoot: e.target.checked })} /> skip boot</label>
        <button type="button" aria-label={`rule up ${r.id}`} disabled={k === 0} onClick={() => set({ rules: move(p.rules, k, -1) })}>↑</button>
        <button type="button" aria-label={`rule down ${r.id}`} disabled={k === p.rules.length - 1} onClick={() => set({ rules: move(p.rules, k, 1) })}>↓</button>
        <button type="button" aria-label={`remove rule ${r.id}`} onClick={() => set({ rules: swap(p.rules, k, null) })}>remove</button>
        </div>
      </details>
    })}
    {p.roles.length > 0 && <button type="button" aria-label="add rule" onClick={() => set({ rules: [...p.rules,
      { id: uniqueName('rule', p.rules.map(r => r.id)), role: p.roles[0].id, lt: { name: 'On' }, value: '0' }] })}>add rule</button>}
    </details>
  </section>
}
