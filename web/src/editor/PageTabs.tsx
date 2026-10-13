// The project's pages: click to show one, double-click or F2 to rename, × to remove (not the last), + to add.
import { useRef, useState, type Dispatch } from 'react'
import type { Page } from '../model/project'
import type { Action } from '../model/store'
import { sizeOf } from '../model/shapes'
import { Icon } from '../ui/icons'
import './sidebar.css'

export function PageTabs({ pages, activeId, dispatch }: { pages: Page[]; activeId: string; dispatch: Dispatch<Action> }) {
  const [editing, setEditing] = useState<string | null>(null)
  const back = useRef<string | null>(null)   // the page whose tab takes the focus back once its rename ends from the keyboard
  const rename = (p: Page, name: string) => {
    setEditing(null)
    if (name.trim()) dispatch({ type: 'renamePage', pageId: p.id, name: name.trim() })
  }
  return <nav className="vb-pages" aria-label="Pages">
    <div className="sechead"><h2 className="ptitle">Pages</h2>
      <button className="ibtn flat" aria-label="Add page" title="Add page" onClick={() => dispatch({ type: 'addPage' })}><Icon name="add" /><span className="vh">+</span></button>
    </div>
    {pages.map(p => <div className={'vb-page-row' + (p.id === activeId ? ' on' : '')} key={p.id}>
      {editing === p.id
        ? <input className="field" aria-label="Page name" defaultValue={p.name} autoFocus onBlur={e => rename(p, e.currentTarget.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') e.currentTarget.value = p.name   // blurring with the old name changes nothing
              if (e.key === 'Enter' || e.key === 'Escape') {
                back.current = p.id
                e.currentTarget.blur()
              }
            }} />
        : <button className={'lrow' + (p.id === activeId ? ' on' : '')} aria-label={p.name} ref={el => { if (el && back.current === p.id) { back.current = null; el.focus() } }} aria-pressed={p.id === activeId} aria-current={p.id === activeId ? 'page' : undefined} title="Double-click or F2 to rename" aria-keyshortcuts="F2"
            onClick={() => dispatch({ type: 'setActivePage', pageId: p.id })}
            onDoubleClick={() => setEditing(p.id)} onKeyDown={e => { if (e.key === 'F2') setEditing(p.id) }}><span>{p.name}</span><span className="unit">{sizeOf(p.shape)?.label ?? 'Custom'}</span></button>}
      <button className="ibtn flat vb-page-remove" aria-label={`Remove page ${p.name}`} title={`Remove page ${p.name}`} disabled={pages.length === 1}
        onClick={() => dispatch({ type: 'removePage', pageId: p.id })}><Icon name="trash" /><span className="vh">×</span></button>
    </div>)}
  </nav>
}
