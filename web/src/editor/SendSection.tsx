// The Export dialog's Send to chip section (M6 Task 6, OQ1 (a)): hidden until the per-browser "Show Send to chip
// (advanced)" is ticked. It is ExportControls' `send` slot (hook H1), so the panel only ever gets the exact artifact
// Download and Copy give, or null while they are disabled.
import { useState } from 'react'
import { loadSendEnabled, saveSendEnabled } from '../runtime/gameMcp'
import type { GameLink } from '../runtime/gameLink'
import { SendToChip } from './SendToChip'
import './game.css'

/** `scenes`: the vector scene ids of the export `ready` is (the project's pages, and its Devices page when generated). */
export function SendSection({ ready, scenes, link }: { ready: { lua: string; name: string } | null; scenes: readonly string[]; link: GameLink }) {
  const [on, setOn] = useState(() => loadSendEnabled())
  return <div className="vb-send-section">
    <label><input type="checkbox" aria-label="Show Send to chip (advanced)" checked={on} onChange={e => {
      setOn(e.target.checked); saveSendEnabled(e.target.checked)
    }} /> Show Send to chip (advanced)</label>
    {on && <SendToChip artifact={ready && { ...ready, scenes }} link={link} />}
  </div>
}
