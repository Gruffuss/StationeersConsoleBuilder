// The Data panel (spec §6.1): one card per data name the pages send, each bound to a source. Unbound names send their
// sample; "+ new read" makes a read and binds the row in one undo step. Names are never refused.
import { useMemo, useState } from 'react'
import { readableTypes, type Catalog } from '../catalog'
import { namesOf, type NameInfo } from '../codegen/names'
import { AGGS, isLuaName, type Binding } from '../model/logic'
import type { Project } from '../model/project'
import type { Action } from '../model/store'
import type { Theme } from '../theme/types'
import { DraftInput, ExprInput, ltFrom, uniqueName, withPreviewSource } from './logicUi'
import { Segmented } from '../ui/Segmented'
import './panels.css'

type Props = { project: Project; theme: Theme; dispatch: (a: Action) => void; catalog: Catalog | null }
const PRESETS: Record<string, string> = { clock: 'util.clock_time("HH:MM")', crit: 'alarms(3)', warn: 'alarms(2)' }

const valueOf = (b: Binding | undefined) =>
  !b ? '' : b.from === 'read' ? `read${b.part && b.part !== 'value' ? '-' + b.part : ''}:${b.read}` : b.from === 'state' ? `state:${b.state}`
  : b.from === 'log' ? `log:${b.part}` : b.from

export function DataPanel({ project: p, theme, dispatch, catalog }: Props) {
  const rows = useMemo(() => {
    const by = new Map<string, { info: NameInfo; pages: string[] }>()
    for (const page of p.pages) for (const info of namesOf(page, theme)) {
      if (info.runtime) continue
      const row = by.get(info.name)
      if (row) row.pages.push(page.name)
      else by.set(info.name, { info, pages: [page.name] })
    }
    return [...by.values()]
  }, [p.pages, theme])
  const [adding, setAdding] = useState<string | null>(null)
  const bind = (name: string, b: Binding | undefined, transient?: boolean) => {
    const rest = Object.fromEntries(Object.entries(p.bindings).filter(([k]) => k !== name))
    dispatch({ type: 'setLogic', patch: { bindings: b ? { ...rest, [name]: b } : rest }, ...(transient && { transient }) })
  }
  const commit = () => dispatch({ type: 'commitDrag' })
  const choose = (info: NameInfo, v: string) => {
    const ease = p.bindings[info.name]?.ease
    const [kind, id] = v.split(':')
    if (v === 'new') return setAdding(info.name)
    setAdding(null)
    const b: Binding | undefined = v === '' ? undefined
      : kind === 'read' ? { from: 'read', read: id } : kind === 'read-state' ? { from: 'read', read: id, part: 'state' }
      : kind === 'read-history' ? { from: 'read', read: id, part: 'history' } : kind === 'state' ? { from: 'state', state: id }
      : kind === 'log' ? { from: 'log', part: id as 'k' } : kind === 'expr' ? { from: 'expr', expr: '0' }
      : kind === 'export' ? { from: 'export', name: 'value' } : { from: 'const', value: typeof info.sample === 'number' || typeof info.sample === 'string' ? info.sample : 0 }
    bind(info.name, b && ease ? { ...b, ease } : b)
  }
  return <section className="vb-data" aria-label="Data">
    <div className="sechead"><h2 className="ptitle">Data names</h2><span className="unit">{rows.length} names · {rows.filter(({ info }) => !Object.hasOwn(p.bindings, info.name)).length} unbound</span></div>
    {rows.map(({ info, pages }) => {
        const b = Object.hasOwn(p.bindings, info.name) ? p.bindings[info.name] : undefined
        const history = b?.from === 'read' && b.part === 'history' || b?.from === 'log'
        return <article className="raised vb-data-name" key={info.name} data-name={info.name}>
          <div className="vb-data-head"><strong>{info.name}</strong><span className="unit">{pages.join(', ')} · {info.kind} · {info.kind === 'raw' && info.geometry && !history
            ? <label className="chk"><input type="checkbox" aria-label={`ease ${info.name}`} checked={!!b?.ease} disabled={!b}
                onChange={e => b && bind(info.name, e.target.checked ? { ...b, ease: true } : (({ ease: _, ...rest }) => rest)(b))} /> ease</label>
            : info.snap || history ? 'snap' : 'ease'}</span></div>
          <div className="vb-data-source">
            <label className="field left"><span className="lbl">source</span>
            <select aria-label={`source of ${info.name}`} value={adding === info.name ? 'new' : valueOf(b)} onChange={e => choose(info, e.target.value)}>
              <option value="">unbound</option>
              {p.reads.map(r => <option key={r.id} value={`read:${r.id}`}>{`read ${r.id}`}</option>)}
              {p.reads.map(r => <option key={`s${r.id}`} value={`read-state:${r.id}`}>{`read ${r.id} state`}</option>)}
              {p.reads.filter(r => r.history).map(r => <option key={`h${r.id}`} value={`read-history:${r.id}`}>{`read ${r.id} history`}</option>)}
              {p.state.map(s => <option key={s.name} value={`state:${s.name}`}>{`state ${s.name}`}</option>)}
              <option value="expr">expression</option><option value="export">custom export</option><option value="const">constant</option>
              <option value="log:k">log states</option><option value="log:m">log messages</option><option value="log:t">log times</option>
              <option value="new">+ new read</option>
            </select></label>
            {!b && adding !== info.name && <small className="unit"> sends its sample</small>}
            {info.kind === 'state' && b?.from === 'read' && b.part !== 'state' && <small className="unit t-warn"> a state slot reads 0..3: bind the read's state</small>}
          </div>
          <div className="vb-data-editor">
            {b?.from === 'expr' && <ExprInput label={`expression for ${info.name}`} value={b.expr}
              onChange={(expr, transient) => bind(info.name, { ...b, expr }, transient)} onCommit={commit} />}
            {b?.from === 'export' && <DraftInput label={`export for ${info.name}`} value={b.name} accept={isLuaName}
              why={name => isLuaName(name) ? null : 'enter a Lua name: letters, digits and underscores; no leading digit or Lua keyword'}
              onChange={(name, transient) => bind(info.name, { ...b, name }, transient)} onCommit={commit} />}
            {b?.from === 'const' && <DraftInput label={`constant for ${info.name}`} value={String(b.value)}
              onChange={(text, transient) => bind(info.name, { ...b, value: text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text }, transient)}
              onCommit={commit} equivalent={(text, now) => text === now || (text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) === Number(now))} />}
            {info.slot && PRESETS[info.slot] && <button className="btn flat" type="button" aria-label={`preset for ${info.name}`} onClick={() => bind(info.name, { from: 'expr', expr: PRESETS[info.slot!] })}>{PRESETS[info.slot]}</button>}
            {adding === info.name && <NewRead project={p} catalog={catalog} onAdd={(read, simDevices) => {
              dispatch({ type: 'setLogic', patch: { reads: [...p.reads, read], bindings: { ...p.bindings, [info.name]: { from: 'read', read: read.id, ...(b?.ease && { ease: true }) } }, simDevices } })
              setAdding(null)
            }} />}
          </div>
        </article>
      })}
    <p className="vb-recipes unit">Recipes. A weighted fraction is a derived over an earlier read (reads run in list order): read cap = sum of
      Maximum, then read frac = sum of Charge with derived <code>P.cap and P.cap &gt; 0 and x / P.cap or nil</code>. The first device's
      value: <code>{'P.<list read>[1]'}</code>. A count of devices: <code>{'R.<role>.n'}</code>; their Labeller names (a Repeater's name
      slot): <code>{'R.<role>.names'}</code>; roles with no device: <code>VB.unbound()</code>.</p>
  </section>
}

function NewRead({ project: p, catalog, onAdd }: { project: Project; catalog: Catalog | null; onAdd: (r: Project['reads'][number], sims: Project['simDevices']) => void }) {
  const [role, setRole] = useState(p.roles[0]?.id ?? ''), [type, setType] = useState(''), [agg, setAgg] = useState('avg')
  const r = p.roles.find(x => x.id === role), types = r && catalog ? readableTypes(catalog, r.prefabs).types : []
  const lt = ltFrom(type)
  return <div className="vb-new-read sunk grid2">
    {!p.roles.length && <p className="unit">Add a role in the Logic tab first</p>}
    <select aria-label="new read role" value={role} onChange={e => setRole(e.target.value)}>{p.roles.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
    <input aria-label="new read type" list="vb-new-read-types" value={type} onChange={e => setType(e.target.value)} placeholder="LogicType or #id" />
    <datalist id="vb-new-read-types">{types.map(x => <option key={x} value={x} />)}</datalist>
    {r?.mode === 'all' && <Segmented label="new read aggregate" value={agg} onChange={setAgg} options={AGGS.map(value => ({ value, label: value }))} />}
    <button type="button" aria-label="add the read" disabled={!r || !lt} onClick={() => {
      const id = uniqueName(`${role}${type.trim().replace(/^#/, 'x')}`, p.reads.map(x => x.id))
      onAdd({ id, role, of: { lt: lt! }, ...(r!.mode === 'all' && agg !== 'avg' && { agg: agg as 'sum' }) }, withPreviewSource(p, role, lt!, catalog))
    }}>add</button>
  </div>
}
