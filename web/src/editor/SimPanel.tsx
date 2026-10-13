// The Sim panel (spec §7): each simulated device and its sources (a slider moves live: transient steps the App sends
// as a sim message, committed on release); adding, duplicating and removing devices and values (spec §7: a role's device is
// made with it, the rest here); the device writes the chip made; what is not simulated; the project's chip settings.
import { useState } from 'react'
import { readableTypes, titleOf, type Catalog } from '../catalog'
import { defaultSource } from '../catalog/defaults'
import type { SimDevice } from '../model/logic'
import type { Project } from '../model/project'
import type { Action } from '../model/store'
import type { DeviceWrite } from '../runtime/bridge'
import { DraftInput, SourceEditor, uniqueName } from './logicUi'
import { Confirm } from '../ui/Confirm'
import { Segmented } from '../ui/Segmented'
import './panels.css'

type Props = { project: Project; dispatch: (a: Action) => void; catalog: Catalog | null; writes: DeviceWrite[]; notes: string[]
  onClearWrites: () => void; onWipePersist: () => void }
const finite = (s: string) => s.trim() !== '' && Number.isFinite(Number(s))
// Spec §7 "Not simulated (shown as notes)".
const NOT_SIMULATED = ['real physics', 'TextMeshPro text shaping', 'multiplayer identity (the player is "preview")', 'power gating of the housing',
  'real save and load timing']

export function SimPanel({ project: p, dispatch, catalog, writes, notes, onClearWrites, onWipePersist }: Props) {
  const devices = (simDevices: SimDevice[], transient = false) => dispatch({ type: 'setLogic', ...(transient && { transient: true }), patch: { simDevices } })
  const setDevice = (k: number, d: SimDevice, transient = false) => devices(p.simDevices.map((x, i) => i === k ? d : x), transient)
  // A new device's id and ref: the next free ref (the housing is 1), its id from it.
  const fresh = () => {
    const ref = Math.max(1, ...p.simDevices.map(x => x.ref)) + 1
    return { id: uniqueName(`sim${ref}`, p.simDevices.map(x => x.id)), ref }
  }
  const [prefab, setPrefab] = useState(''), [adding, setAdding] = useState<Record<string, string>>({})
  const [wipe, setWipe] = useState(false)
  const ltName = new Map(catalog?.enums.LogicType.map(m => [m.value, m.name]) ?? [])
  const deviceName = (d: SimDevice) => d.label || d.prefab || 'Device'
  const writeNames = new Map(p.simDevices.map(d => [d.ref, deviceName(d)]))
  const settings = p.settings
  const commit = () => dispatch({ type: 'commitDrag' })
  const num = (label: string, value: number, put: (v: number) => Project['settings']) =>
    <DraftInput label={label} value={String(value)} accept={finite} why={s => finite(s) ? null : 'enter a finite number'}
      normalize={s => String(Number(s))} equivalent={(s, now) => finite(s) && Number(s) === Number(now)} onCommit={commit}
      onChange={(s, transient) => dispatch({ type: 'setLogic', transient, patch: { settings: put(Number(s)) } })} />
  return <section className="vb-sim" aria-label="Sim">
    <datalist id="vb-sim-prefabs">{catalog?.devices.map(d => <option key={d.name} value={d.name}>{titleOf(d)}</option>)}</datalist>
    <details className="disc" open><summary><span className="ptitle">Simulated devices</span><span className="unit">{p.simDevices.length}</span></summary>
    {p.simDevices.map((d, k) => {
      const types = catalog ? readableTypes(catalog, [d.prefab]).types : [], want = (adding[d.id] ?? '').trim(), name = deviceName(d)
      return <details key={d.id} className="raised vb-sim-device" open>
        <summary><strong>{deviceName(d)}</strong><span className="unit">{d.prefab} · {d.pin === undefined ? 'no pin' : `d${d.pin}`}</span></summary>
        <div className="grid2">
        <DraftInput label={`${name} label`} value={d.label} onChange={(label, transient) => setDevice(k, { ...d, label }, transient)} onCommit={commit} />
        <Segmented label={`${name} pin`} value={d.pin === undefined ? '' : String(d.pin)}
          onChange={value => setDevice(k, value === '' ? (({ pin: _, ...x }) => x)(d) : { ...d, pin: Number(value) as SimDevice['pin'] })}
          options={[{ value: '', label: 'no pin' }, ...[0, 1, 2, 3, 4, 5].map(x => ({ value: String(x), label: `d${x}` }))]} />
        <button type="button" aria-label={`duplicate ${name}`} onClick={() => devices([...p.simDevices, { ...d, ...fresh(), pin: undefined, label: '' }])}>duplicate</button>
        <button type="button" aria-label={`remove ${name}`} onClick={() => devices(p.simDevices.filter((_, i) => i !== k))}>remove</button>
        </div>
        {Object.entries(d.values).map(([key, s]) => <div key={key} className="vb-sim-value">
          <div className="vb-sim-value-head"><strong className="code">{key}</strong>
            <button type="button" aria-label={`remove ${name} ${key}`} onClick={() => {
              const { [key]: _, ...values } = d.values
              setDevice(k, { ...d, values })
            }}>remove value</button></div>
          <SourceEditor label={`${name} ${key}`} value={s} onChange={(x, transient) => setDevice(k, { ...d, values: { ...d.values, [key]: x } }, transient)}
            onCommit={() => dispatch({ type: 'commitDrag' })} />
          </div>)}
        <div className="grid2">
        <input aria-label={`${name} new value`} list={`vb-sim-types-${d.id}`} placeholder="LogicType" value={adding[d.id] ?? ''}
          onChange={e => setAdding({ ...adding, [d.id]: e.target.value })} />
        <datalist id={`vb-sim-types-${d.id}`}>{types.map(x => <option key={x} value={x} />)}</datalist>
        <button type="button" aria-label={`add value to ${name}`} disabled={!want || (catalog !== null && !(catalog.lt.includes(want) || types.includes(want) || /^#\d+$/.test(want))) || Object.hasOwn(d.values, want)} onClick={() => {
          setDevice(k, { ...d, values: { ...d.values, [want]: defaultSource(want) } })
          setAdding({ ...adding, [d.id]: '' })
        }}>add value</button>
        </div>
      </details>
    })}
    <input aria-label="new device prefab" list="vb-sim-prefabs" value={prefab} onChange={e => setPrefab(e.target.value)} placeholder="prefab" />
    <button type="button" aria-label="add device" disabled={!prefab} onClick={() => {
      const c = catalog?.byName.get(prefab)
      devices([...p.simDevices, { ...fresh(), prefab, label: c ? titleOf(c) : prefab, values: {} }])
      setPrefab('')
    }}>add device</button>
    </details>
    <h3 className="ptitle">Writes</h3>
    <ul className="code vb-writes">{writes.map((w, k) => <li key={k}>{`${writeNames.get(w.ref) ?? 'Device no longer in this project'}: ${ltName.get(w.lt) ?? `#${w.lt}`}${w.slot >= 0 ? ` slot ${w.slot}` : ''} ← ${w.value} (${w.stored ? 'stored' : 'not stored'})`}</li>)}</ul>
    <button type="button" aria-label="reset written values" onClick={onClearWrites}>reset written values</button>
    <details className="disc" open><summary><span className="ptitle">Not simulated</span><span className="unit">{NOT_SIMULATED.length + notes.length}</span></summary>
    <ul className="unit vb-not-simulated">{[...NOT_SIMULATED, ...notes].map((x, k) => <li key={k}>{x}</li>)}</ul>
    </details>
    <h3 className="ptitle">Chip</h3>
    <div className="grid2">
    <label>budget at load {num('budget at load', settings.budgets.load, load => ({ ...settings, budgets: { ...settings.budgets, load } }))}</label>
    <label>budget per tick {num('budget per tick', settings.budgets.tick, tick => ({ ...settings, budgets: { ...settings.budgets, tick } }))}</label>
    <label><input type="checkbox" aria-label="assume beta mods" checked={settings.beta} onChange={e => dispatch({ type: 'setLogic', patch: { settings: { ...settings, beta: e.target.checked } } })} /> assume beta mods</label>
    <label>day length (s) {num('day length', settings.day.length, length => ({ ...settings, day: { ...settings.day, length } }))}</label>
    <label>day starts at {num('day start', settings.day.start, start => ({ ...settings, day: { ...settings.day, start } }))}</label>
    <label><input type="checkbox" aria-label="wipe persist on re-export" checked={settings.wipeOnReexport}
      onChange={e => dispatch({ type: 'setLogic', patch: { settings: { ...settings, wipeOnReexport: e.target.checked } } })} /> wipe persist on re-export</label>
    </div>
    <button className="btn danger" type="button" aria-label="wipe persist" onClick={() => setWipe(true)}>wipe persist now</button>
    <Confirm open={wipe} title="Wipe saved values?" confirmLabel="Wipe persist" onCancel={() => setWipe(false)} onConfirm={() => { setWipe(false); onWipePersist() }}>
      The simulated chip's persist values are cleared, and the running preview is told at once. Consoles in the game are not touched.
    </Confirm>
  </section>
}
