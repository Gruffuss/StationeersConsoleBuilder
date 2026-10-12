import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import type { SrcNode, Value } from '../model/scene'
import type { Field } from '../schema'
import { first } from '../srctext/props'
import { ROLES, type Theme } from '../theme'
import { linksOf, type StyleLink } from '../theme/links'
import { num } from '../widgets/paint'
import { passedDown, shown, type Mode } from './fields'
import { TextField } from './PropertyPanel'
import { Tabs } from '../ui/Tabs'
import { Icon } from '../ui/icons'

export type PaintCommit = (text: string, mode?: Mode, link?: StyleLink) => void
const HEX = /^#[\da-f]{6}(?:[\da-f]{2})?$/i
let sessionColours: string[] = []
let storedColours: string | null | undefined, coloursVersion = 0
const colourListeners = new Set<() => void>()
const subscribeColours = (f: () => void) => { colourListeners.add(f); return () => { colourListeners.delete(f) } }
const pendingColours = new Set<string>()
const notifyColours = () => { coloursVersion++; colourListeners.forEach(f => f()) }

export function PendingColours() {
  useSyncExternalStore(subscribeColours, () => coloursVersion)
  return pendingColours.size > 0 && <span role="status">Pending picker colours: {[...pendingColours].join(', ')}. Choose from Recent colours to apply.{' '}
    <button type="button" aria-label="Discard pending picker colours" onMouseDown={e => e.preventDefault()} onClick={() => { pendingColours.clear(); notifyColours() }}>Discard</button>
  </span>
}
function recentColours() {
  try {
    const raw = localStorage.getItem('vb.recentColours')
    if (raw !== storedColours) {
      const saved: unknown = JSON.parse(raw ?? 'null')
      sessionColours = Array.isArray(saved) ? [...new Set(saved.filter((s): s is string => typeof s === 'string' && HEX.test(s)))].slice(0, 12) : []
      storedColours = raw
    }
  } catch { /* Storage is optional; the session still keeps recent literals. */ }
  return sessionColours
}

/** Also used for shadow and gradient stop colours, which are literals rather than linked node keys. */
export function ColourFields({ label, value, commit, theme, role = '', gradient, inline = false }:
  { label: string; value: Value | undefined; commit: PaintCommit; theme?: Theme; role?: string; gradient?: ReactNode; inline?: boolean }) {
  useSyncExternalStore(subscribeColours, () => coloursVersion)
  const id = useId(), button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false), [tab, setTab] = useState(theme ? 'theme' : 'custom')
  const close = () => { setOpen(false); button.current?.focus() }
  const tabs = [...(theme ? [{ id: 'theme', label: 'Theme' }] : []), { id: 'custom', label: 'Custom' },
    ...(gradient ? [{ id: 'gradient', label: 'Gradient' }] : [])]
  const recent = recentColours(), [error, setError] = useState('')
  const [picker, setPicker] = useState<{ value: Value | undefined; text: string } | null>(null)
  if (picker && (picker.value !== value || !pendingColours.has(picker.text))) setPicker(null)
  const hex = typeof value === 'string' && HEX.test(value) ? value : null
  const write = (text: string) => {
    if (!HEX.test(text)) return setError('Use #rrggbb or #rrggbbaa')
    setError(''); commit(text, 'literal')
    const next = sessionColours = [text, ...recentColours().filter(x => x !== text)].slice(0, 12)
    try { const saved = JSON.stringify(next); localStorage.setItem('vb.recentColours', saved); storedColours = saved } catch { /* Kept for this session. */ }
    pendingColours.delete(text); notifyColours()
  }
  const alpha = hex ? (hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) : ''
  const finishPicker = () => {
    if (!picker || picker.value !== value) return
    setPicker(null)
    write(picker.text)
  }
  const recentValues = [...pendingColours].filter(c => !recent.includes(c)).concat(recent)
  const recentAt = recentValues.findIndex(c => c === value)
  const radioKeys = (e: KeyboardEvent<HTMLDivElement>) => {
          const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]'))
            .filter(radio => !radio.closest('details') || radio.closest('details')!.open)
          const at = radios.indexOf(e.target as HTMLButtonElement)
          if (at < 0) return
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1
            : ['ArrowRight', 'ArrowDown'].includes(e.key) ? (at + 1) % radios.length
            : ['ArrowLeft', 'ArrowUp'].includes(e.key) ? (at + radios.length - 1) % radios.length : -1
          if (next >= 0) { e.preventDefault(); radios[next].focus(); radios[next].click() }
        }
  const swatches = (names: string[]) => <div className="vb-colour-swatches">{names.map(name =>
    <button key={name} type="button" className={`ibtn sw ${role === name ? 'sel' : ''}`} role="radio" aria-checked={role === name}
      aria-label={name} title={`${name} ${theme!.colors[name]}`} style={{ background: theme!.colors[name] }}
      tabIndex={role === name || !Object.hasOwn(theme!.colors, role) && name === ROLES.find(key => Object.hasOwn(theme!.colors, key)) ? 0 : -1}
      onClick={() => commit(theme!.colors[name], 'literal', { role: name })} />)}</div>
  return <div className="vb-paint-fields vb-colour-fields" onKeyDown={e => {
    if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
  }}>
    {!inline && <button ref={button} type="button" className="ibtn sw" aria-label={`${label} colour panel`} aria-expanded={open} aria-controls={`${id}-colour-panel`}
      title={`${label} colour panel`} style={{ background: hex ?? 'var(--surface-well)' }}
      onMouseDown={e => e.preventDefault()} onClick={() => open ? close() : setOpen(true)} />}
    <div id={`${id}-colour-panel`} className={inline ? 'vb-colour-inline' : 'float vb-colour-panel'} hidden={!open && !inline}
      onBlurCapture={e => { if (e.relatedTarget === button.current) e.stopPropagation() }}>
      <Tabs label={`${label} colour`} tabs={tabs} value={tab} onChange={setTab} idPrefix={id} />
      {theme && <div role="tabpanel" id={`${id}-panel-theme`} aria-labelledby={`${id}-tab-theme`} hidden={tab !== 'theme'}>
        <div role="radiogroup" aria-label={`${label} theme swatch`} onKeyDown={radioKeys}>
          <p className="unit">UI roles</p>{swatches(ROLES.filter(name => Object.hasOwn(theme.colors, name)))}
          <p className="unit">{theme.name} roles</p>{swatches(Object.keys(theme.colors).filter(name => !ROLES.includes(name) && !name.startsWith('gas.')))}
          <details className="disc"><summary><span className="unit">Game gas colours</span></summary>
            {swatches(Object.keys(theme.colors).filter(name => name.startsWith('gas.')))}
          </details>
        </div>
      </div>}
      <div role="tabpanel" id={`${id}-panel-custom`} aria-labelledby={`${id}-tab-custom`} hidden={tab !== 'custom'}>
        <div className="grid2">
          <label>Colour <input type="color" aria-label={`${label} colour`} value={picker?.text.slice(0, 7) ?? hex?.slice(0, 7) ?? '#000000'}
            onChange={e => {
              const text = e.target.value + (hex?.length === 9 ? hex.slice(7) : '')
              if (picker) pendingColours.delete(picker.text)
              pendingColours.add(text); notifyColours()
              setPicker({ value, text })
            }}
            onBlur={finishPicker}
            onKeyDown={e => { if (e.key === 'Enter') finishPicker() }} /></label>
          <label>Hex <TextField label={`${label} hex`} now={hex ?? ''} placeholder="#rrggbb[aa]" multiline={false} commit={write} /></label>
          <label>Alpha <span aria-disabled={!hex}><TextField label={`${label} alpha`} now={String(alpha)} placeholder="0–1" multiline={false}
            commit={text => {
              const a = Number(text)
              if (!hex || !text.trim() || !Number.isFinite(a) || a < 0 || a > 1) return setError('Alpha must be between 0 and 1')
              write(hex.slice(0, 7) + Math.round(a * 255).toString(16).padStart(2, '0'))
            }} disabled={!hex} /></span></label>
          <div role="radiogroup" aria-label={`${label} recent colours`} onKeyDown={radioKeys}><span className="unit">Recent colours</span>
            {recentValues.map((c, i) => <button key={c} type="button" role="radio" className="mi" aria-label={c} aria-checked={value === c} tabIndex={i === (recentAt < 0 ? 0 : recentAt) ? 0 : -1} onMouseDown={e => e.preventDefault()} onClick={() => write(c)}>{pendingColours.has(c) && !recent.includes(c) ? 'Pending ' : ''}{c}</button>)}</div>
        </div>
        <PendingColours />
        {error && <div role="alert">{error}</div>}
      </div>
      {gradient && <div role="tabpanel" id={`${id}-panel-gradient`} aria-labelledby={`${id}-tab-gradient`} hidden={tab !== 'gradient'}>{gradient}</div>}
    </div>
  </div>
}

export function PaintFields({ node, field, commit, theme, gradient }:
  { node: SrcNode; field: Field; commit: PaintCommit; theme: Theme; gradient?: ReactNode }) {
  const [speed, setSpeed] = useState('20'), [time, setTime] = useState('0'), [error, setError] = useState('')
  const value = passedDown(field) ? node.attrs[field.key] : first(node, field.key.toUpperCase())
  if (field.type === 'paint' || field.key === 'oc') {
    const link = linksOf(node)[field.key]
    return <ColourFields label={field.key} value={value} theme={theme} role={link && 'role' in link ? link.role : ''} commit={commit} gradient={gradient} />
  }
  if (field.key === 'join') return <p className="vb-prop-info unit">Joins use a clamped miter; round and bevel are hints, not true round or bevel geometry.</p>
  if (field.key === 'dofs') {
    const dash = first(node, 'DASH'), literal = Array.isArray(dash) && dash.every(x => typeof x === 'number' && Number.isFinite(x))
    const sum = literal ? (dash as number[]).reduce((a, b) => a + Math.max(0, b), 0) * (dash.length % 2 ? 2 : 1) : 0
    const animation = typeof value === 'string' ? /^=mod\(t\*(-?[\d.]+),([\d.]+)\)$/.exec(value) : null
    const n = Number(speed), t = Number(time), canAnimate = sum > 0 && Number.isFinite(Math.fround(sum)) && speed.trim() !== '' && Number.isFinite(Math.fround(n))
    return <div className="vb-paint-fields grid2">
      <label>Speed (units/s) <TextField label="Dash speed" now={speed} placeholder="units per second" multiline={false} commit={setSpeed} /></label>
      <button aria-label="Animate dash" disabled={!canAnimate} onClick={() => commit(`=mod(t*${num(n)},${num(sum)})`, 'expr')}>Animate</button>
      <label>Stop at t (seconds) <TextField label="Stop time t" now={time} placeholder="seconds" multiline={false} commit={setTime} /></label>
      <button aria-label="Stop dash" disabled={!animation || !time.trim() || !Number.isFinite(t)} onClick={() => {
        const phase = ((t * Number(animation![1])) % Number(animation![2]) + Number(animation![2])) % Number(animation![2])
        if (!Number.isFinite(Math.fround(phase))) return setError('The phase is not a finite number')
        commit(String(Math.fround(Number(phase.toFixed(3)))), 'literal')
      }}>Stop</button>
      {!literal && <p className="vb-prop-info">Animate needs a finite literal dash list; the mod counts negative entries as 0.</p>}
      {error && <div role="alert">{error}</div>}
    </div>
  }
  if (field.key !== 'sh') return null
  const rows = Array.isArray(value) ? (value.every(Array.isArray) ? value as Value[][] : [value]) : []
  const write = (next: Value[][]) => commit(shown(next), 'literal')
  const change = (i: number, k: number, v: Value) => write(rows.map((row, j) => j === i ? row.map((x, at) => at === k ? v : x) : row))
  const move = (i: number, to: number) => { const next = rows.slice(); [next[i], next[to]] = [next[to], next[i]]; write(next) }
  return <div className="vb-paint-fields">
    {rows.map((row, i) => <fieldset className="raised" key={i}><legend>Shadow {i + 1}</legend>
      <div className="grid2">
        {['dx', 'dy', 'blur', 'spread'].map((k, at) => <label key={k}>{k} <TextField label={`Shadow ${i + 1} ${k}`} now={shown(row[at])}
          placeholder="0" multiline={false} commit={s => {
            const v = Math.fround(Number(s))
            if (!s.trim() || !Number.isFinite(v)) return setError('A finite number is expected')
            setError(''); change(i, at, v)
          }} /></label>)}
      </div>
      <ColourFields label={`Shadow ${i + 1}`} value={row[4]} commit={s => change(i, 4, s)} />
      <label>Inset <input type="checkbox" aria-label={`Shadow ${i + 1} inset`} checked={row[5] === 'inset'} onChange={e =>
        write(rows.map((r, j) => j === i ? [...r.slice(0, 5), ...(e.target.checked ? ['inset'] : [])] : r))} /></label>
      <button className="ibtn flat" title="Up" aria-label={`Shadow ${i + 1} up`} disabled={i === 0} onClick={() => move(i, i - 1)}><Icon name="chevron-up" /><span className="vh">Up</span></button>
      <button className="ibtn flat" title="Down" aria-label={`Shadow ${i + 1} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}><Icon name="chevron-down" /><span className="vh">Down</span></button>
      <button className="ibtn flat" title="Remove" aria-label={`Shadow ${i + 1} remove`} onClick={() => write(rows.filter((_, j) => j !== i))}><Icon name="trash" /><span className="vh">Remove</span></button>
    </fieldset>)}
    <button aria-label="Add shadow" disabled={value !== undefined && !Array.isArray(value)} onClick={() => write([...rows, [0, 0, 4, 0, '#00000080']])}>Add shadow</button>
    {error && <div role="alert">{error}</div>}
  </div>
}
