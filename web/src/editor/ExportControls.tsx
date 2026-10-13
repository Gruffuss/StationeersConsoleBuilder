import { REQUIREMENTS } from '../codegen/requirements'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { loadCatalog } from '../catalog'
import { readTraps } from '../codegen/checks'
import { assembleExport, type ExportArtifact } from '../codegen/export'
import { exportProblems, type ExportProblem } from '../codegen/exportProblems'
import { generate, type GeneratedPage } from '../codegen/generate'
import { hostOf } from '../codegen/hostOf'
import { mapError } from '../codegen/linemap'
import type { Project } from '../model/project'
import { Icon } from '../ui/icons'
import './dialogs.css'
import type { Selection } from '../model/store'
import type { ProjectTransfer } from '../project/transfer'
import type { SceneChecker } from '../srctext/checker'
import { checkExport, type ExportReport, type ExportIssue } from '../runtime/exportCheck'
import { themeOf } from '../theme'
import { filename, useDownloads } from './downloads'

type Issue = ExportIssue & Pick<ExportProblem, 'location'>
type Prepared = { project: Project; embed: boolean; at: Date; sources: Map<string, string>; issues: Issue[]; unfinished: string[];
  artifact?: ExportArtifact; pages?: GeneratedPage[]; report?: ExportReport; acknowledged: boolean }
const PREFERENCE = 'vectorbuilder-export-embed'
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const hasErrors = (p: Prepared) => p.issues.some(i => i.level === 'error')

export function ExportControls({ open, project, checker, makeWorker, transfer, onNotice, send }: {
  open: boolean; project: Project; checker: SceneChecker | null; makeWorker: () => Worker; transfer: ProjectTransfer;
  onNotice: (message: string, selection?: Selection) => void
  send?: (ready: { lua: string; name: string } | null) => ReactNode
}) {
  const download = useDownloads()
  const [embed, setEmbed] = useState(() => { try { return localStorage.getItem(PREFERENCE) !== 'false' } catch { return true } })
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [pending, setPending] = useState(false)
  const [copyNotice, setCopyNotice] = useState('')
  const lua = useRef<HTMLTextAreaElement>(null)
  const identity = useRef({ project, embed })
  identity.current = { project, embed }
  const attempt = useRef<AbortController | null>(null)
  // Opening the dialog checks the export, and a new artifact while it is open (an edit, Embed project) is checked again;
  // closing it cancels the check (owner, 2026-10-13: the check runs on its own; it was an explicit Check export, M4 Q13).
  useEffect(() => {
    setPrepared(null); setPending(false); setCopyNotice('')
    if (open) void start()
    return () => { attempt.current?.abort(); attempt.current = null }
  }, [project, embed, open])
  const current = prepared?.project === project && prepared.embed === embed ? prepared : null
  const enabled = !pending && !!current?.artifact?.lua && !hasErrors(current) && (current.report?.complete || current.acknowledged)
  const active = (p: Prepared, abort: AbortController) => attempt.current === abort && !abort.signal.aborted
    && identity.current.project === p.project && identity.current.embed === p.embed

  async function prepare(p: Prepared, checking: boolean, abort: AbortController) {
    p.issues = p.issues.concat(exportProblems(p.project))
    if (hasErrors(p)) return
    if (checking && !checker) {
      p.unfinished = p.unfinished.concat(p.project.pages.map(pg => `the editor's scene check did not finish for page ${pg.name}`))
      throw Error('the scene checker is unavailable')
    }
    const checked = checking ? await Promise.all(p.project.pages.map(pg => checker!.check(pg.scene))) : p.project.pages.map(pg => checker?.get(pg.scene))
    if (!active(p, abort)) return
    p.project.pages.forEach((pg, k) => {
      const c = checked[k]
      if (!c) return
      if (c.tooLarge) {
        const reason = `the editor's scene check did not finish for page ${pg.name}`
        if (!p.unfinished.includes(reason)) p.unfinished.push(reason)
      } else {
        for (const [level, list] of [['error', c.errors], ['warning', c.warnings]] as const)
          p.issues = p.issues.concat(list.map(i => ({ level, message: i.message, page: pg.id,
            ...(i.ref && { location: { page: pg.id, ref: i.ref, key: i.key } }) })))
        if (c.src === null && !c.errors.length) p.issues.push({ level: 'error', page: pg.id, message: `page ${pg.id}: checked scene text is unavailable` })
      }
      if (c.src !== null) p.sources.set(pg.id, c.src)
    })
    if (hasErrors(p)) return
    if (p.project.pages.some(pg => !p.sources.has(pg.id))) {
      const sources = await transfer.sources(p.project)
      if (!active(p, abort)) return
      for (const pg of p.project.pages) {
        if (p.sources.has(pg.id)) continue
        const src = sources.find(s => s.page === pg.id)?.src
        if (src === undefined) throw Error(`worker scene source is unavailable for page ${pg.name}`)
        p.sources.set(pg.id, src)
      }
    }
    const g = generate(p.project, pg => p.sources.get(pg.id)!)
    p.issues = p.issues.concat(g.problems, readTraps(p.project, themeOf(p.project)))
    if (hasErrors(p)) return
    const token = p.embed ? await transfer.compress(p.project) : null
    if (!active(p, abort)) return
    p.artifact = assembleExport(g, token, p.at)
    if (!g.lua) p.issues = p.issues.concat(p.artifact.problems)
    p.pages = g.pages
  }

  async function start(unchecked = false) {
    attempt.current?.abort()
    const abort = new AbortController()
    attempt.current = abort
    const p: Prepared = unchecked && current ? { ...current, issues: current.artifact ? [...current.issues] : [], unfinished: [...current.unfinished], sources: new Map(current.sources) }
      : { project, embed, at: new Date(), sources: new Map(), issues: [], unfinished: [], acknowledged: false }
    setPending(true); setCopyNotice('')
    let stage = 'export preparation did not finish'
    try {
      if (!p.artifact) await prepare(p, !unchecked, abort)
      if (!active(p, abort)) return
      if (!hasErrors(p) && p.artifact) {
        if (unchecked) p.acknowledged = true
        else {
          stage = 'catalogue check did not finish'
          const catalog = await loadCatalog()
          if (!active(p, abort)) return
          stage = 'runtime check did not finish'
          const report = await checkExport(makeWorker, { lua: p.artifact.lua, pages: p.pages!, host: JSON.stringify(hostOf(p.project, catalog, null).host) }, abort.signal)
          if (!active(p, abort)) return
          p.issues = p.issues.concat(report.issues.map(i => ({ ...i, message: mapError(i.message, p.artifact!.map) })))
          if (!report.complete) {
            const reasons = report.issues.filter(i => i.level === 'info').map(i => i.message)
            p.unfinished = p.unfinished.concat(reasons.length ? reasons : ['runtime check did not finish'])
          }
          p.report = { ...report, complete: report.complete && !p.unfinished.length }
        }
      }
    } catch (e) {
      p.unfinished.push(`${stage}: ${message(e)}`)
      if (!p.report) p.unfinished.push('runtime check did not finish')
    }
    if (!active(p, abort)) return
    p.unfinished = [...new Set(p.unfinished)]
    if (!p.report) p.report = { complete: !p.unfinished.length, issues: [], loadInstructions: 0, worstTickInstructions: 0, ticks: 0, visited: [] }
    if (!p.report.complete && current) p.issues = p.issues.concat(current.issues.filter(i => i.level === 'error'))
    setPrepared(p); setPending(false)
  }

  function copy() {
    if (!enabled || !current?.artifact) return
    const captured = current
    const checkedAttempt = attempt.current
    const failed = (e: unknown) => {
      if (attempt.current !== checkedAttempt || checkedAttempt?.signal.aborted
        || identity.current.project !== captured.project || identity.current.embed !== captured.embed) return
      const why = `copy failed: ${message(e)}`
      setCopyNotice(why); onNotice(why); lua.current?.focus(); lua.current?.select()
    }
    if (!navigator.clipboard) return failed('clipboard is unavailable')
    try { void navigator.clipboard.writeText(current.artifact.lua).catch(failed) } catch (e) { failed(e) }
  }

  return <div className="vb-export">
    <section className="sunk" aria-label="Script">
      <h3 className="ptitle">Script</h3>
    <label className="chk raised"><input type="checkbox" aria-label="Embed project" checked={embed} onChange={e => {
      const value = e.target.checked
      setEmbed(value)
      try { localStorage.setItem(PREFERENCE, String(value)) } catch { /* Browser preference is optional. */ }
    }} /> Embed project</label>
    <span className="unit"> Includes the whole project, custom Lua, simulated setup and authored font URLs/names. No chip stores or imported font bytes; opening grants no font consent.</span>
    </section>
    <section className="sunk" aria-label="Check">
    <h3 className="ptitle">Check</h3>
    <div aria-live="polite">
      {pending ? 'Checking export… (0.6–4.7 s in the projects measured)' : current ? current.acknowledged ? `Unchecked: ${current.unfinished.join('; ')}`
        : hasErrors(current) ? 'Export blocked by known errors.' : current.report?.complete ? 'Export check complete.' : `Incomplete: ${current.unfinished.join('; ')}` : ''}
      {copyNotice && <div>{copyNotice}</div>}
      {current?.issues.map((i, k) => <div className="raised vb-export-issue" key={k}><span className={'chip ' + (i.level === 'error' ? 'crit' : i.level === 'warning' ? 'warn' : 'info')}>{i.level}</span>: {i.page && `${i.page}: `}{i.message}
        {i.location && <button className="btn flat" type="button" aria-label="Select export problem" onClick={() => {
          if (identity.current.project === current.project && identity.current.embed === current.embed) {
            const loc = i.location!
            onNotice('', { pageId: loc.page, path: loc.ref.path, inDefs: loc.ref.inDefs })
          }
        }}>Select</button>}</div>)}
      {current?.artifact && <div className="unit">{current.artifact.embeddedBytes} embedded comment UTF-8 bytes; {current.artifact.totalBytes} total UTF-8 bytes. UTC {current.artifact.date}
        {current.artifact.totalBytes > 1057682 && <div>Info: this script is larger than any size measured accepted in game (1,057,682 bytes); larger sizes are unmeasured.</div>}</div>}
      {current?.report && <div className="unit">{current.report.ticks} ticks; load {current.report.loadInstructions} instructions; worst tick {current.report.worstTickInstructions} instructions.</div>}
    </div>
    {current && !pending && !current.report?.complete && <div className="raised row">
      <button className="btn" type="button" aria-label="Retry" onClick={() => void start()}>Retry</button>
      {!hasErrors(current) && !current.acknowledged && <button className="btn" type="button" aria-label="Export unchecked" onClick={() => void start(true)}>Export unchecked</button>}
    </div>}
    <p className="unit">Checks sample cold stores and simulated inputs; click handlers are unexercised. At most 16 distinct Scene.Problems per scene; Missing, Starved and Dropped are separate diagnostics. TMP shaping and actual Fonts API/download delivery are not checked.</p>
    {enabled && current?.artifact && <label>Selectable Lua <textarea className="area code" ref={lua} aria-label="Export Lua" readOnly value={current.artifact.lua} /></label>}
    </section>
    <div className="vb-export-actions">
      <button className="btn flat" type="button" aria-label="Download JSON fallback" onClick={() => {
        const captured = project
        void transfer.text(captured).then(text => download(text, filename(captured.name, '.json'), 'application/json')).catch(e => onNotice(`JSON download failed: ${message(e)}; keep the original JSON file`))
      }}>Download JSON fallback</button>
      <button className="btn" type="button" aria-label="Copy the script" disabled={!enabled} onClick={copy}><Icon name="copy" />Copy</button>
      <button className="btn primary" type="button" aria-label="Download the script" disabled={!enabled} onClick={() => {
        if (enabled && current?.artifact) download(current.artifact.lua, filename(project.name, '.lua'), 'text/x-lua')
      }}><Icon name="download" />Download</button>
    </div>
    {send?.(enabled && current?.artifact ? { lua: current.artifact.lua, name: project.name } : null)}
    {/* The mods an export needs, from the one list the export header and the README use; last, out of the way (owner,
        2026-10-13: it "takes waaaaaay to much space at the top"). */}
    <section className="sunk vb-mods" aria-label="Required mods">
      <h3 className="ptitle">Required mods <span className="unit">in load order</span></h3>
      <ol>{REQUIREMENTS.map(r => <li key={r.name}>
        <a href={r.url} target="_blank" rel="noopener noreferrer">{r.name}{r.version && ` ${r.version}`}</a>
        {(r.floor || r.fonts) && <span className="unit">{r.floor ? `${r.floor} or newer` : "only when the screen uses a font other than the game's own or a web font"}</span>}
      </li>)}</ol>
      <p className="unit">A console on an older mod shows a banner on every page instead of the screen.</p>
    </section>
  </div>
}
