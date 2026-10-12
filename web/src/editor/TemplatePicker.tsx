import { useId, useState } from 'react'
import type { Project } from '../model/project'
import type { Theme } from '../theme'
import { TEMPLATES, templateProject, type TemplateId } from '../project/templates'
import './dialogs.css'
export function TemplatePicker({ theme, onPick }: { theme: Project['theme'] | Theme; onPick: (p: Project) => void }) {
  const [id, setId] = useState<TemplateId | ''>('')
  const uid = useId()
  const selected = TEMPLATES.find(t => t.id === id)
  return <div className="vb-templates">
    <div className="grid2" role="radiogroup" aria-label="Open template">
      {TEMPLATES.map(t => <label className="raised" key={t.id}>
        <input type="radio" name={uid} value={t.id} checked={id === t.id} aria-describedby={`${uid}-${t.id}`} onChange={() => setId(t.id)} />
        <span className="ptitle">{t.name}</span>
        <span className="unit" id={`${uid}-${t.id}`}>{t.description}</span>
      </label>)}
    </div>
    <button className="btn primary" type="button" disabled={!selected} onClick={() => { if (selected) { onPick(templateProject(selected.id, theme)); setId('') } }}>Open template</button>
  </div>
}
