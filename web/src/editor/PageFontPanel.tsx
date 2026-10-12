import { useState, useSyncExternalStore } from 'react'
import type { Page, Project } from '../model/project'
import type { Action } from '../model/store'
import { first } from '../srctext/props'
import { shown } from './fields'
import { cancelPageFontRequests, getPageFontRecord, loadPageFonts, PAGE_FONT_NOTICE, pageFontLinks, pageFontsVersion, subscribePageFonts } from './pageFonts'
import { Icon } from '../ui/icons'

export const PAGE_FONT_LIMITS = 'Game limits: 48 distinct links per process; 48 page faces per session, shared across pages, projects and consoles in that process. These are not preview caps.'
export const PAGE_FONT_COUNTING = "The 48 faces count faces built by requests in a session. Cached faces from earlier downloads or the player's own folder cost nothing; a name clash still counts; failed or disabled faces do not. Actual usage depends on each player's existing and shared fonts."

export function PageFontPanel({ page, project, dispatch }: { page: Page; project: Project; dispatch?: (a: Action) => void }) {
  useSyncExternalStore(subscribePageFonts, pageFontsVersion, pageFontsVersion)
  const [url, setUrl] = useState(''), [note, setNote] = useState('')
  const links = pageFontLinks(page.scene), total = new Set(project.pages.flatMap(p => pageFontLinks(p.scene))).size
  const declarations = page.scene.defs.flatMap((def, index) => def.op.toUpperCase() === 'FONT' ? [{ index, src: first(def, 'SRC') }] : [])
  const load = (wanted: readonly string[]) => {
    setNote('')
    void loadPageFonts(wanted).catch(e => setNote(e instanceof Error ? e.message : String(e)))
  }
  const add = () => {
    if (!url.length || !dispatch) return
    if (links.includes(url)) { setNote('This exact link is already declared on this page.'); return }
    dispatch({ type: 'setScene', pageId: page.id, scene: { ...page.scene, defs: [...page.scene.defs, { op: 'FONT', attrs: { src: url } }] } })
    load([url]); setUrl('')
  }
  const remove = (index: number, src: unknown) => {
    const scene = { ...page.scene, defs: page.scene.defs.filter((_, i) => i !== index) }
    if (typeof src === 'string' && !project.pages.some(p => pageFontLinks(p.id === page.id ? scene : p.scene).includes(src))) cancelPageFontRequests([src])
    dispatch?.({ type: 'setScene', pageId: page.id, scene })
  }
  const retry = links.some(link => ['failed', 'refused'].includes(getPageFontRecord(link)?.state ?? ''))
  return <section aria-label="This page's font links">
    <h3 className="ptitle">This page's font links</h3>
    <p className="raised vb-font-notice"><Icon name="info" />{PAGE_FONT_NOTICE}</p>
    {dispatch && <div className="vb-font-add"><label className="field left">Complete font URL <input type="text" value={url} onChange={e => setUrl(e.target.value)} /></label>
      <button className="btn" type="button" disabled={!url.length} onClick={add}>Add</button></div>}
    <button className="btn" type="button" disabled={!links.length} onClick={() => load(links)}><Icon name="reset" />{retry ? "Retry this page's fonts" : "Load this page's fonts"}</button>
    {retry && <p className="unit">Retry is available 60 seconds after a failed or refused attempt; only another click retries.</p>}
    <div role="status">{note}</div>
    <p className="unit">This project: {total} distinct FONT links (all pages).</p>
    <p className="unit">{PAGE_FONT_LIMITS} {PAGE_FONT_COUNTING}</p>
    {total > 48 && <p className="unit" role="status">This project's link count exceeds 48; the game applies its shared process limit. Source and export remain available.</p>}
    <ul>{declarations.map(({ index, src }) => {
      const record = typeof src === 'string' ? getPageFontRecord(src) : undefined
      const chip = record ? { loaded: 'ok', failed: 'crit', refused: 'crit', pending: 'info' }[record.state]
        : typeof src === 'string' && src.length ? 'idle' : 'crit'
      return <li className="raised" key={index}>
        <span className="code">{typeof src === 'string' ? src || '(empty src)' : src === undefined ? '(missing src)' : shown(src)}</span>
        {' — '}<span className={'chip ' + chip}>{record?.state ?? (typeof src === 'string' && src.length ? 'not requested' : 'FONT: src needs a non-empty string URL')}</span>
        {'; this link: '}{record && record.state !== 'pending' ? new Set(record.names).size : 'unknown'} delivered face name{record && record.state !== 'pending' && new Set(record.names).size === 1 ? '' : 's'}
        {record?.names.length ? <span>: {[...new Set(record.names)].join(', ')}</span> : null}
        {record && new Set(record.names).size > 48 && <div>This link delivered more than 48 distinct face names in the preview; the game applies its shared session face limit. Export remains available.</div>}
        {record?.cause && <div>{record.cause}</div>}
        {record?.notice && record.notice !== PAGE_FONT_NOTICE && <div role="status">{record.notice}</div>}
        {record?.subsetFailures.map((f, i) => <div key={i}>{f.url}: {f.cause}; affected glyphs use fallback here.</div>)}
        {dispatch && <button className="btn flat" type="button" aria-label={`Remove font declaration ${index + 1}`} onClick={() => remove(index, src)}>Remove</button>}
      </li>
    })}</ul>
  </section>
}
