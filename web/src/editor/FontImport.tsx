// The player's own fonts (spec 5.3): a local .woff2, .ttf or .otf file, registered under the name the Fonts mod
// uses for it. The file stays in this browser (FontFace and IndexedDB); a project keeps only the name.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { fontName, fontNotices, FONT_PRECEDENCE, fontsVersion, importedFonts, importFont, nameOfFile, releasePageFonts, removeFont, subscribeFonts } from './fonts'
import type { Page, Project } from '../model/project'
import type { Action } from '../model/store'
import { PageFontPanel } from './PageFontPanel'
import { pageFontLinks } from './pageFonts'
import './dialogs.css'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

export function FontImport({ page, project, dispatch }: { page?: Page; project?: Project; dispatch?: (a: Action) => void } = {}) {
  useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)   // fonts also arrive from storage after the first render
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')   // the browser's storage failed: what that means for the font
  const [busy, setBusy] = useState(false)   // an import in flight
  const [round, setRound] = useState(0)   // a new file input after each import, so it shows no stale file
  const picked = useRef<File | null>(null)   // the latest pick, so an earlier file's slower read cannot overwrite its name
  const edits = useRef(0)
  const reading = useRef<AbortController | null>(null)
  const links = useRef(new Set<string>())
  useEffect(() => {
    const current = new Set(project?.pages.flatMap(p => pageFontLinks(p.scene)))
    for (const link of links.current) if (!current.has(link)) releasePageFonts(link)
    links.current = current
  }, [project])
  useEffect(() => () => { picked.current = null; reading.current?.abort() }, [])
  const pick = async (f: File | null) => {
    reading.current?.abort()
    const request = reading.current = new AbortController()
    picked.current = f
    const edit = edits.current
    setFile(f)
    setError('')
    setNote('')
    if (!f) return
    try {
      const suggested = (await fontName(await f.arrayBuffer(), request.signal)) ?? nameOfFile(f.name)   // a suggestion; the player can edit it
      if (picked.current === f && edits.current === edit) setName(suggested)
    } catch (e) {
      if (picked.current !== f) return
      setFile(null)
      setError(message(e))
    }
  }
  const add = async () => {
    if (!file) return
    const n = name.trim()
    setBusy(true)
    setError('')
    setNote('')
    try {
      const kept = await importFont(n, await file.arrayBuffer())
      picked.current = null
      setFile(null)
      setName('')
      setRound(r => r + 1)
      if (!kept) setNote(`"${n}" is in use for this session but not kept: this browser's storage could not be reached`)
    } catch (e) { setError(message(e)) }
    finally { setBusy(false) }
  }
  const remove = async (n: string) => {
    setNote('')
    if (!await removeFont(n)) setNote(`"${n}" is removed for this session, but this browser's storage could not be updated, so it may come back after a reload`)
  }
  return <section className="vb-fonts" aria-label="Fonts">
    {page && project && <PageFontPanel key={page.id} page={page} project={project} dispatch={dispatch} />}
    <h3 className="ptitle">Local preview files</h3>
    <input key={round} type="file" accept=".woff2,.ttf,.otf" aria-label="Font file" onChange={e => void pick(e.target.files?.[0] ?? null)} />
    <label className="field left">Name in the Fonts mod <input type="text" value={name} onChange={e => { edits.current++; setName(e.target.value) }} /></label>
    <button className="btn" type="button" disabled={!file || !name.trim() || busy} onClick={() => void add()}>Import</button>
    {error && <div role="alert">{error}</div>}
    <div role="status">{note}</div>
    <ul>{importedFonts().map(n => <li className="lrow" key={n}>{n} <button className="ibtn flat" type="button" aria-label={`Remove ${n}`} onClick={() => void remove(n)}>×</button></li>)}</ul>
    <div className="raised"><h3 className="ptitle">Which font wins</h3><p className="unit">{FONT_PRECEDENCE}</p></div>
    {fontNotices().map((notice, i) => <div className="raised row" role="status" key={i}><span className="chip warn">WARN</span>{notice}</div>)}
  </section>
}
