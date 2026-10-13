import { useEffect, useId, useState } from 'react'
import type { Project } from '../model/project'
import type { Theme } from '../theme'
import { loadTemplates, TEMPLATES, type TemplateData, type TemplateId } from '../project/templates'
import './dialogs.css'

/** The starters by name. Their projects load the first time the dialog is open (`active`), as their own chunk; the tiles
 *  are there from the start and a status line of fixed height says it is loading, so nothing moves when they arrive. */
export function TemplatePicker({ theme, onPick, active = true, load = loadTemplates }:
  { theme: Project['theme'] | Theme; onPick: (p: Project) => void; active?: boolean; load?: () => Promise<TemplateData> }) {
  const [id, setId] = useState<TemplateId | ''>('')
  const [data, setData] = useState<TemplateData | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const uid = useId()
  const selected = TEMPLATES.find(t => t.id === id)
  useEffect(() => {
    if (!active || data) return
    let live = true
    setFailed(null)
    load().then(d => { if (live) setData(d) }, (e: unknown) => { if (live) setFailed(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [active, data, load])
  const status = data ? '' : failed !== null ? `The templates could not load (${failed}). Close this dialog and open it again to retry.`
    : active ? 'Loading templates…' : ''
  return <div className="vb-templates">
    <div className="grid2" role="radiogroup" aria-label="Open template">
      {TEMPLATES.map(t => <label className="raised" key={t.id}>
        <input type="radio" name={uid} value={t.id} checked={id === t.id} aria-describedby={`${uid}-${t.id}`} onChange={() => setId(t.id)} />
        <span className="ptitle">{t.name}</span>
        <span className="unit" id={`${uid}-${t.id}`}>{t.description}</span>
      </label>)}
    </div>
    <div className="vb-templates-foot">
      <span className="unit vb-templates-status" role="status">{status}</span>
      <button className="btn primary" type="button" disabled={!selected || !data} aria-busy={active && !data && failed === null}
        onClick={() => { if (selected && data) { onPick(data.templateProject(selected.id, theme)); setId('') } }}>Open template</button>
    </div>
  </div>
}
