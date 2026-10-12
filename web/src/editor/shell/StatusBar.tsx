import { useSyncExternalStore, type ReactNode } from 'react'
import type { Ctx } from '../../editing/types'
import { Icon } from '../../ui/icons'
import { checkSummary, type Message } from './messages'
import { pointerStore } from './pointer'

export function StatusBar(p: { ctx: Ctx; play: boolean; setViewSlot(el: HTMLDivElement | null): void; gap: string; onGap(v: string): void; source: boolean; onSource(v: boolean): void; game?: ReactNode; status: { shown: string; spoken: string }; messages: readonly Message[]; messagesOpen: boolean; onMessages(v: boolean): void }) {
  const point = useSyncExternalStore(pointerStore.subscribe, pointerStore.get), summary = checkSummary(p.messages), settings = p.ctx.settings()
  return <footer className="vb-statusbar vb-status" onMouseDown={e => { if ((e.target as Element).closest('button')) e.preventDefault() }}>
    <div className="vb-view-slot" ref={p.setViewSlot}>{p.play && <span className="unit">Zoom, fit and pan are off while playing.</span>}</div>
    <span className="vb-pointer unit" hidden={p.play}>X {point ? Math.round(point.x) : '—'} Y {point ? Math.round(point.y) : '—'}</span>
    <button className="btn" aria-pressed={settings.snap} onClick={() => p.ctx.setSettings({ snap: !settings.snap })}><Icon name="check" />Snap</button>
    <label className="field">Grid<input aria-label="Grid" type="number" min={0} step={1} value={settings.grid} onChange={e => { const grid = Math.round(Number(e.target.value)); if (e.target.value !== '' && Number.isFinite(grid) && grid >= 0) p.ctx.setSettings({ grid }) }} /></label>
    <label className="field">Gap<input aria-label="Gap" type="number" step="any" value={p.gap} onChange={e => p.onGap(e.target.value)} /></label>
    <button className="btn" aria-label="Source" aria-pressed={p.source} onClick={() => p.onSource(!p.source)}><Icon name="code" />Source</button>
    <span className="vb-status-game" hidden={p.game === undefined}>{p.game}</span><span className="vb-spacer" />
    <span className="vb-run-line unit" title={p.status.shown}>{p.status.shown.replaceAll('\n', ' · ')}</span>
    <button className="btn" onClick={() => p.onMessages(true)}><span className={`chip ${summary.level}`}>{summary.level.toUpperCase()}</span>{summary.text}</button>
    <button className="btn" aria-expanded={p.messagesOpen} aria-controls="vb-messages" onClick={() => p.onMessages(!p.messagesOpen)}>Messages</button>
    <div className="vh" aria-live="polite">{p.status.spoken}</div>
  </footer>
}
