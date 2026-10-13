import { useState } from 'react'
import { SIZES, type ShapeKind } from '../model/shapes'

export function AdoptOffer({ busy, onAdopt, onStop }: {
  busy: boolean; onAdopt: (shape: ShapeKind) => void; onStop: () => void
}) {
  const [shape, setShape] = useState<Exclude<ShapeKind, 'custom'>>('square')
  return <section className="vb-adopt-offer" aria-label="Script adoption">
    <p>This script has no embedded builder project. Adopt its captured artwork as editable pages. Its original Lua will be kept as a comment that never runs.</p>
    <label>Capture console shape <select aria-label="Capture console shape" value={shape} disabled={busy}
      onChange={e => setShape(e.target.value as Exclude<ShapeKind, 'custom'>)}>
      {SIZES.map(s => <option key={s.keys[0]} value={s.keys[0]}>{s.label}</option>)}
    </select></label>
    <button type="button" aria-label="Adopt this script" disabled={busy} onClick={() => onAdopt(shape)}>Adopt this script</button>
    {busy && <><span role="status">Capturing script…</span><button type="button" aria-label="Stop adopting script" onClick={onStop}>Stop</button></>}
  </section>
}
