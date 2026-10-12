import type { PictureNote } from './pictures'
export function PictureControls({ notes, canLoad, onLoad }: { notes: PictureNote[]; canLoad: boolean; onLoad: () => void }) {
  return <section aria-label="Pictures" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3>Pictures</h3>
    <button disabled={!canLoad} onClick={onLoad}>Load pictures</button>
    {!!notes.length && <ul aria-live="polite">{notes.map(n => <li key={n.src}>
      {n.src.toLowerCase().startsWith('data:') ? 'Embedded picture' : n.src}: {n.message}
    </li>)}</ul>}
  </section>
}
