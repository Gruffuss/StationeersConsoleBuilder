import type { Theme } from '../theme'
import { Icon } from '../ui/icons'

export function ThemeList({ provided, imported, library, value, notes, onChoose, onAdd, onRemove, onSave, onRemoveLibrary }: {
  provided: readonly Theme[]; imported: readonly Theme[]; library: readonly Theme[]; value: string; notes: readonly string[]
  onChoose: (id: string) => void; onAdd: (theme: Theme) => void; onRemove: (id: string) => void
  onSave: (theme: Theme) => void; onRemoveLibrary: (id: string) => void
}) {
  const held = new Set([...provided, ...imported].map(t => t.id))
  const choice = (t: Theme, choose: () => void) => <button type="button" className="mi" role="menuitemradio" aria-label={t.name} aria-checked={value === t.id} onClick={choose}>{t.name}{value === t.id && <Icon name="check" />}</button>
  return <div>
    <div role="group" aria-label="Provided"><div className="mgroup">Provided</div>{provided.map(t => <div key={t.id}>{choice(t, () => onChoose(t.id))}</div>)}</div>
    {imported.length > 0 && <div role="group" aria-label="Project themes"><div className="mgroup">Project</div>{imported.map(t => <div key={t.id}>
      {choice(t, () => onChoose(t.id))}
      <button type="button" className="mi" role="menuitem" aria-label={`Save ${t.name} to browser`} onClick={() => onSave(t)}>Save {t.name} to browser</button>
      <button type="button" className="mi" role="menuitem" aria-label={`Remove ${t.name} from project`} onClick={() => onRemove(t.id)}>Remove {t.name} from project</button>
    </div>)}</div>}
    {library.length > 0 && <div role="group" aria-label="Browser themes"><div className="mgroup">This browser</div>{library.map(t => <div key={t.id}>
      {!held.has(t.id) ? choice(t, () => onAdd(t)) : <span className="unit">{t.name}</span>}
      <button type="button" className="mi" role="menuitem" aria-label={`Remove ${t.name} from browser`} onClick={() => onRemoveLibrary(t.id)}>Remove from browser</button>
    </div>)}</div>}
    {notes.length > 0 && <p role="status">{notes.join('; ')}</p>}
  </div>
}
