import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '../ui/Dialog'
import type { Project } from '../model/project'
import { shareUrl } from '../project/share'
import type { ProjectTransfer } from '../project/transfer'
import { filename, useDownloads } from './downloads'
import { SHAPES, type ShapeKind } from '../model/shapes'
import { adoptCapture, type AdoptReport } from '../project/adopt'
import { captureScript } from '../runtime/adoptCapture'
import { AdoptOffer } from './AdoptOffer'
import { AdoptionReport } from './AdoptionReport'

const message = (e: unknown) => e instanceof Error ? e.message : String(e)

type Link = { project: Project; result: ReturnType<typeof shareUrl> }

export async function saveJson(project: Project, transfer: ProjectTransfer, download: ReturnType<typeof useDownloads>, active: () => boolean = () => true) {
  const text = await transfer.text(project)
  if (active()) download(text, filename(project.name, '.json'), 'application/json')
}

export function ProjectControls({ project, onLoad, transfer, onNotice, makeCaptureWorker, adoption, onAdoption, dialogs }: {
  project: Project; onLoad: (project: Project, notice?: string) => void; transfer: ProjectTransfer; onNotice: (message: string) => void
  makeCaptureWorker: () => Worker
  adoption: AdoptReport | null; onAdoption: (report: AdoptReport | null) => void
  dialogs?: { open: 'new' | 'share' | 'adopt' | null; onOpen: (d: 'new' | 'share' | 'adopt' | null) => void; templates?: ReactNode; examples?: ReactNode }
}) {
  const download = useDownloads()
  const [text, setText] = useState(''), [format, setFormat] = useState<'json' | 'lua'>('json')
  const [fileName, setFileName] = useState(''), [importNotice, setImportNotice] = useState(''), [reading, setReading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<{ file: File; kind: 'json' | 'lua' } | null>(null)
  const readAbort = useRef<AbortController | null>(null)
  const [foreign, setForeign] = useState<string | null>(null), [capturing, setCapturing] = useState(false)
  const [link, setLink] = useState<Link | null>(null), [shareNotice, setShareNotice] = useState('Prepare a project link when ready to share')
  const [preparing, setPreparing] = useState(false)
  const compressionBusy = useRef(false)
  const url = useRef<HTMLTextAreaElement>(null), current = useRef(project), lifetime = useRef(0), readRound = useRef(0), shareRound = useRef(0)
  current.current = project
  useEffect(() => {
    ++lifetime.current
    compressionBusy.current = false; setPreparing(false)
    return () => {
      ++lifetime.current; ++readRound.current; ++shareRound.current
      readAbort.current?.abort(); readAbort.current = null
    }
  }, [transfer])
  useEffect(() => {
    ++readRound.current
    if (readAbort.current) {
      readAbort.current.abort(); readAbort.current = null
      const why = 'Import canceled because the project changed; open the file or text again to retry'
      setImportNotice(why); onNotice(why)
    }
    setReading(false)
    setCapturing(false)
    setLink(null); setShareNotice('Prepare a project link when ready to share')
    return () => { ++shareRound.current }
  }, [project, transfer])
  const activeRead = (round: number, life: number, captured: Project) => readRound.current === round && lifetime.current === life && current.current === captured
  const activeShare = (round: number, life: number, captured: Project) => shareRound.current === round && lifetime.current === life && current.current === captured
  const ready = link?.project === project ? link.result : null

  async function open(source: string | File, kind: 'json' | 'lua') {
    const round = ++readRound.current, life = lifetime.current, captured = project
    readAbort.current?.abort()
    const abort = new AbortController()
    readAbort.current = abort
    setForeign(null); setCapturing(false)
    setReading(true)
    setImportNotice(typeof source === 'string' ? 'Reading project…' : `Reading project file (${(source.size / 1_000_000).toFixed(1)} MB)…`)
    try {
      const read = await transfer.read(source, kind, abort.signal)
      if (!activeRead(round, life, captured)) return
      readAbort.current = null
      if ('kind' in read) {
        setReading(false); setForeign(read.lua); setImportNotice('Script ready to adopt'); dialogs?.onOpen('adopt')
        return
      }
      setReading(false); setImportNotice(read.notice || 'Project opened')
      onLoad(read.project, read.notice); dialogs?.onOpen(null)
    } catch (e) {
      if (!activeRead(round, life, captured)) return
      readAbort.current = null
      const why = message(e)
      setReading(false); setImportNotice(why); onNotice(why)
    }
  }
  async function adopt(shape: ShapeKind) {
    if (foreign === null || capturing) return
    const lua = foreign, round = ++readRound.current, life = lifetime.current, captured = project
    readAbort.current?.abort()
    const abort = new AbortController(); readAbort.current = abort
    setCapturing(true); setImportNotice('Capturing script…')
    try {
      const report = await captureScript(makeCaptureWorker, { lua, size: shape === 'custom' ? SHAPES.square.px : SHAPES[shape].px }, abort.signal)
      if (!activeRead(round, life, captured)) return
      readAbort.current = null; setCapturing(false)
      if ('incomplete' in report) { setImportNotice(report.incomplete); onNotice(report.incomplete); return }
      const adopted = adoptCapture(report, { lua, shape })
      setForeign(null)
      if (!adopted.report.pages.length) {
        onAdoption(adoption ? { ...adoption, leftOut: [...adoption.leftOut, ...adopted.report.leftOut], notes: [...adoption.notes, ...adopted.report.notes], complete: adoption.complete && adopted.report.complete } : adopted.report)
        dialogs?.onOpen('adopt')
        setImportNotice('No editable pages were captured; the current project is kept.'); return
      }
      setForeign(null); setImportNotice('Script adopted; see the adoption report')
      onLoad(adopted.project, 'Script adopted; see the adoption report')
      onAdoption(adopted.report); dialogs?.onOpen('adopt')
    } catch (e) {
      if (!activeRead(round, life, captured)) return
      readAbort.current = null; setCapturing(false)
      const why = 'Adoption could not complete: ' + message(e) + '; the current project is kept.'
      setImportNotice(why); onNotice(why)
    }
  }
  async function prepareLink() {
    if (compressionBusy.current) return
    compressionBusy.current = true; setPreparing(true)
    const round = ++shareRound.current, life = lifetime.current, captured = project
    setLink(null); setShareNotice('Preparing project link…')
    try {
      const token = await transfer.compress(captured)
      if (!activeShare(round, life, captured)) return
      const result = shareUrl(location.href, token)
      setLink({ project: captured, result })
      setShareNotice(result.kind === 'link' ? `Project link: ${result.url.length} characters` : `Project link: ${result.length} characters, above the 8,000-character sharing threshold. Download project JSON instead.`)
    } catch (e) {
      if (activeShare(round, life, captured)) setShareNotice('Project link unavailable: ' + message(e) + '. Download project JSON instead.')
    } finally { if (lifetime.current === life) { compressionBusy.current = false; setPreparing(false) } }
  }
  async function downloadJson() {
    const life = lifetime.current, captured = project
    try {
      await saveJson(captured, transfer, download, () => lifetime.current === life)
    } catch (e) { if (lifetime.current === life) onNotice('JSON download failed: ' + message(e) + '; keep the original JSON file') }
  }
  function copyLink() {
    if (ready?.kind !== 'link') return
    const captured = project, life = lifetime.current, round = shareRound.current
    const failed = (e: unknown) => {
      if (!activeShare(round, life, captured)) return
      const why = 'Copy project link failed: ' + message(e)
      setShareNotice(why); onNotice(why); url.current?.focus(); url.current?.select()
    }
    if (!navigator.clipboard) return failed('clipboard is unavailable')
    try {
      void navigator.clipboard.writeText(ready.url).then(() => {
        if (activeShare(round, life, captured)) setShareNotice(`Project link copied: ${ready.url.length} characters`)
      }, failed)
    } catch (e) { failed(e) }
  }
  const closeAdopt = () => {
    if (foreign !== null || capturing) { ++readRound.current; readAbort.current?.abort(); readAbort.current = null; setForeign(null); setCapturing(false) }
    dialogs?.onOpen(null)
  }
  const step = capturing ? 'Capture' : foreign !== null ? 'Offer' : adoption ? 'Report' : 'Offer'
  return <div className="vb-project">
    <Dialog open={dialogs?.open === 'new'} title="New and open" className="vb-open-dialog" size="lg" headExtra={<span className="unit">Project: {project.name || 'Untitled'}</span>} onClose={() => dialogs?.onOpen(null)}>
      {dialogs?.templates}<div className="vb-open-file">
    <label>Open project file <input aria-label="Open project file" type="file" accept=".json,.lua" onChange={e => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      ++readRound.current; readAbort.current?.abort(); readAbort.current = null; setReading(false); setCapturing(false); setForeign(null)
      setSelectedFile(null)
      setFileName(file.name)
      if (!/\.(json|lua)$/i.test(file.name)) { const why = 'Choose a .json or .lua project file'; setImportNotice(why); onNotice(why); return }
      const kind = /\.lua$/i.test(file.name) ? 'lua' : 'json'
      setSelectedFile({ file, kind }); setFormat(kind); void open(file, kind)
    }} /></label>
    {fileName && <div>Selected file: {fileName}</div>}
    {selectedFile && <button type="button" aria-label="Open selected project file" disabled={reading} onClick={() => void open(selectedFile.file, selectedFile.kind)}>Open file</button>}
    {reading && <button type="button" aria-label="Stop reading project" onClick={() => readAbort.current?.abort()}>Stop</button>}
      </div><div className="vb-open-text">
    <label>Project text format <select aria-label="Project text format" value={format} onChange={e => setFormat(e.target.value as 'json' | 'lua')}>
      <option value="json">JSON project</option><option value="lua">Lua script</option>
    </select></label>
    <label>Project text <textarea aria-label="Project text" value={text} onChange={e => setText(e.target.value)} /></label>
    <button type="button" aria-label="Open project text" disabled={reading || !text.trim()} onClick={() => void open(text, format)}>Open text</button>
      </div>
      <div role="status" aria-live="polite">{importNotice}</div>
      {dialogs?.examples}<div className="vb-open-save"><button type="button" aria-label="Save project JSON" onClick={() => void downloadJson()}>Save JSON</button></div>
    </Dialog>
    <Dialog open={dialogs?.open === 'share'} title="Share link" size="md" onClose={() => dialogs?.onOpen(null)}>
      <div className="vb-share">
    <div>Sharing includes the whole project, custom Lua, simulated setup, font names and exact authored FONT URLs. No font bytes, consent or delivery records. Opening grants no font-download consent.</div>
    <button type="button" aria-label="Prepare project link" disabled={preparing} onClick={() => void prepareLink()}>Prepare link</button>
    <button type="button" aria-label="Copy project link" disabled={ready?.kind !== 'link'} onClick={copyLink}>Copy link</button>
    {ready?.kind === 'link' && <label>Share URL <textarea ref={url} aria-label="Share URL" readOnly value={ready.url} /></label>}
        <div aria-live="polite">{shareNotice}</div>
      </div>
    </Dialog>
    <Dialog open={dialogs?.open === 'adopt'} title={step === 'Report' ? 'Adoption report' : 'Open a script'} size="lg" onClose={closeAdopt}>
      <ol className="steps">{['Offer', 'Capture', 'Report'].map(name => <li key={name} aria-current={name === step ? 'step' : undefined}>{name}</li>)}</ol>
    {foreign !== null && <AdoptOffer busy={capturing} onAdopt={shape => void adopt(shape)} onStop={() => readAbort.current?.abort()} />}
    {step === 'Report' && adoption && <AdoptionReport report={adoption} onDismiss={() => { onAdoption(null); setImportNotice(''); if (foreign === null) dialogs?.onOpen(null) }} />}
      <p className="unit">{importNotice}</p>
    </Dialog>
  </div>
}
