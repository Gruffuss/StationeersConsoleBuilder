import { useEffect, useState, type ReactNode } from 'react'
import type { Page } from '../../model/project'
import type { Action } from '../../model/store'
import { Icon } from '../../ui/icons'
import { ColourFields } from '../PaintFields'
import { PageShape } from '../PageShape'
import { designSize } from '../geometry'

export function PageSettings(p: { page: Page; pages: Page[]; dispatch(a: Action): void; children: ReactNode }) {
  const [name, setName] = useState(p.page.name), size = designSize(p.page.scene.header)
  useEffect(() => setName(p.page.name), [p.page.name, p.page.id])
  const commit = () => { if (name.trim() && name.trim() !== p.page.name) p.dispatch({ type: 'renamePage', pageId: p.page.id, name: name.trim() }) }
  const background = p.page.background
  const setBackground = (background: string[] | undefined) => p.dispatch({ type: 'setPageBackground', pageId: p.page.id, background })
  const colour = (index: number, text: string) => {
    const next = [...(p.page.background ?? [])]; next[index] = text
    setBackground(next)
  }
  return <section className="vb-page-settings" aria-label="Page"><h3 className="ptitle">Page</h3>
    <label className="field left">Name<input aria-label="Name" value={name} onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.preventDefault(); setName(p.page.name) } }} /></label>
    <PageShape key={p.page.id} page={p.page} dispatch={p.dispatch} />
    <div className="vb-props">
      <label className="field left">Background<select aria-label="Page background" value={background === undefined ? 'none' : background.length > 1 ? 'gradient' : 'colour'}
        onChange={e => setBackground(e.target.value === 'none' ? undefined : e.target.value === 'gradient'
          ? [background?.[0] ?? '#FFFFFF', background?.[1] ?? background?.[0] ?? '#FFFFFF'] : [background?.[0] ?? '#FFFFFF'])}>
        <option value="none">No background</option><option value="colour">Colour</option><option value="gradient">Vertical gradient</option>
      </select></label>
      <div className="vb-prop"><div className="field"><span>Colour</span><ColourFields label="Background" value={background?.[0]} commit={text => colour(0, text)} /></div></div>
      <div className="vb-prop" hidden={!background || background.length < 2}><div className="field"><span>Bottom</span><ColourFields label="Background bottom" value={background?.[1]} commit={text => colour(1, text)} /></div></div>
    </div>
    <p className="unit">{p.page.size.w} × {p.page.size.h} px preview · {size.w} × {size.h} design units</p>{p.children}
    <button className="btn danger" aria-label="Remove this page" disabled={p.pages.length === 1} onClick={() => p.dispatch({ type: 'removePage', pageId: p.page.id })}><Icon name="trash" />Remove page</button>
  </section>
}
