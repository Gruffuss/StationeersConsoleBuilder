// The device picker (M6 Task 11; OQ13 (a), OQ15 (b)): in a role, pick a real device by its name from the linked chip's
// network (every network when there is no link). A pick writes the device's prefab into the role's prefabs and its name
// into its Labeller name, never its ref (the owner: a device's ref changes when it is rebuilt); the role then finds that
// device by name, as the runtime's scan does. Self-contained: the role row mounts it (hook H4) and writes `onPick`'s role
// as one edit. It asks the game nothing but on a click. No ref, network id or hash is shown.
import { useState } from 'react'
import type { Role } from '../model/logic'
import type { GameLink } from '../runtime/gameLink'
import type { Device, ToolAnswer } from '../runtime/gameMcp'
import { Answer, useAct, useLink, type Names } from './gameText'
import './game.css'

type Row = { name: string; prefab: string; count: number }
/** One row per name and prefab, in the game's order, with how many devices share it. */
const rowsOf = (devices: Device[]): Row[] => {
  const rows = new Map<string, Row>()
  for (const d of devices) {
    const key = JSON.stringify([d.name, d.prefab]), row = rows.get(key)
    if (row) row.count++
    else rows.set(key, { name: d.name, prefab: d.prefab, count: 1 })
  }
  return [...rows.values()]
}
/** The role after picking a device: its prefab (kept when the role lists it already) and its name; nothing else. */
export const pickedRole = (role: Role, d: { name: string; prefab: string }): Role =>
  ({ ...role, prefabs: role.prefabs.includes(d.prefab) ? role.prefabs : [d.prefab], label: d.name })

export function DevicePicker({ role, link, onPick }: { role: Role; link: GameLink; onPick: (role: Role) => void }) {
  const state = useLink(link)!
  // The rows and the network they were read for (null: every network); rows of another network than the link's now are
  // never shown, so a pick never writes a device of a network the link left.
  const [loaded, setLoaded] = useState<{ network: number | null; rows: Row[]; unnamed: number } | null>(null)
  const [failure, setFailure] = useState<ToolAnswer | null>(null)
  const [unanswered, setUnanswered] = useState(false)
  const { busy, act, stop } = useAct()

  const load = () => act(async signal => {
    setFailure(null); setUnanswered(false)
    const network = link.state.linked?.networkId ?? null
    const r = await link.devices(signal)
    if (r.ok) {
      const named = r.devices.filter(d => d.name && d.prefab)
      setLoaded({ network, rows: rowsOf(named), unnamed: r.devices.length - named.length }); return
    }
    setLoaded(null); setFailure(r.answer)
    // No game connected: the request found nobody to answer it (the game's own refusals are answers).
    setUnanswered(link.state.problem !== null)
  })

  const names: Names = new Map(state.linked?.networkId != null ? [[state.linked.networkId, 'the linked network']] : [])
  const current = loaded && loaded.network === (state.linked?.networkId ?? null) ? loaded : null
  const rows = current?.rows ?? null
  const shown = rows && (role.prefabs.length ? rows.filter(r => role.prefabs.includes(r.prefab)) : rows)
  const pinned = role.pin !== undefined || role.ref !== undefined
  return <div className="vb-device-picker" aria-label={`Pick a device for ${role.name}`}>
    <div className="vb-game-actions">
      <button className="btn" type="button" aria-label="Pick a device" disabled={busy} onClick={() => void load()}>Pick a device</button>
      <button className="btn flat" type="button" aria-label="Stop" disabled={!busy} onClick={stop}>Stop</button>
      <span aria-live="polite">{busy ? 'Waiting for the game…' : ''}</span>
    </div>
    {loaded && !current && <p>The link changed: pick a device again.</p>}
    {rows && pinned && <p>This role uses "Pin to one specific device", which overrides the name and prefab a pick sets: the
      pick takes effect once the pin is cleared.</p>}
    {current && current.unnamed > 0 && <p>{current.unnamed === 1 ? '1 device the game listed without a name or prefab is'
      : `${current.unnamed} devices the game listed without a name or prefab are`} not offered.</p>}
    {rows && <p>{state.linked ? `Devices on ${state.linked.name}'s network` : 'Devices on every network the game reaches'}
      {role.prefabs.length ? `, only this role's prefabs (${role.prefabs.join(', ')})` : ''}:</p>}
    {shown && (shown.length ? <ul>
      {shown.map(r => {
        const text = `${r.name} (${r.prefab})`
        const description = text + (r.count > 1 ? `: ${r.count} devices share this name` : '')
        return <li key={text}>
          <span className="vb-device-name" title={description}>{description}</span>
          <button className="btn" type="button" aria-label={`Pick ${text}`} onClick={() => onPick(pickedRole(role, r))}>Pick</button>
        </li>
      })}
    </ul> : <p>No device here is one of this role's prefabs.</p>)}
    {shown?.some(r => r.count > 1) && <p>To tell apart devices that share a name, give one its own name with the Labeller in
      game, then pick again.</p>}
    {failure && failure.ok && <p>The game's device list could not be read.</p>}
    {failure && !failure.ok && (unanswered
      ? <p>No game is connected: {failure.ok ? '' : failure.why} Without the game, point this role at a device with "Pin to one
        specific device".</p>
      : <Answer step={{ label: 'Devices', answer: failure }} names={names} />)}
  </div>
}
