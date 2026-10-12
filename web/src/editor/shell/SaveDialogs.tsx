import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '../../ui/Dialog'
import { Confirm } from '../../ui/Confirm'

export function SaveDialogs(p: { phase: 'loading' | 'choice' | 'ready'; paused: boolean; discovered: boolean; busy: boolean; request: number; message: string; canContinue: boolean; onContinue(): void; onBlank(): void; onDownload(): void; startup: ReactNode; recovery: ReactNode }) {
  const [open, setOpen] = useState(false), [blank, setBlank] = useState(false)
  const seen = useRef({ paused: false, discovered: false, request: 0, message: '' })
  const continueStartup = () => { seen.current = { paused: p.paused, discovered: p.discovered, request: p.request, message: p.message }; p.onContinue() }
  useEffect(() => {
    if (p.phase !== 'ready' || !p.paused) { setOpen(false); seen.current.paused = false; return }
    if (p.busy) return
    if (!seen.current.paused || (p.discovered && !seen.current.discovered) || p.request !== seen.current.request || p.message !== seen.current.message) setOpen(true)
    seen.current = { paused: p.paused, discovered: p.discovered, request: p.request, message: p.message }
  }, [p.phase, p.paused, p.discovered, p.busy, p.request, p.message])
  const warning = <p className="msg"><span className="chip warn">WARN</span>{p.message}</p>
  const askBlank = <button className="btn" onClick={() => setBlank(true)}>Blank project</button>
  return <>
    <Dialog open={p.phase === 'choice'} title="Choose a project" size="sm" closable={p.canContinue} onClose={continueStartup}>
      {warning}<div className="start-buttons">{p.startup}{askBlank}{p.canContinue && <button className="btn" onClick={continueStartup}>Continue without autosave</button>}</div>
      <p className="unit">The editor behind takes no clicks or keys until a project is chosen. Open saved project shows when a save exists; Continue without autosave only before the editor starts. Close and Esc do the same as Continue without autosave: the pending project opens and nothing is written to storage.</p>
    </Dialog>
    <Dialog open={open} title="Not saved" size="sm" onClose={() => setOpen(false)}>
      {warning}<div className="start-buttons"><button className="btn primary" aria-label="Download unsaved project JSON" onClick={p.onDownload}>Download unsaved JSON</button>{p.recovery}{askBlank}</div>
      <p className="unit">Close keeps autosave paused. The header keeps saying Not saved until you choose.</p>
    </Dialog>
    <Confirm open={blank} title="Start a blank project?" confirmLabel="Blank project" onCancel={() => setBlank(false)} onConfirm={() => { setBlank(false); setOpen(false); p.onBlank() }} extra={p.phase === 'ready' && <button className="btn" onClick={p.onDownload}>Save JSON first</button>}>
      <p>{p.phase === 'ready' ? 'The current project is replaced by a new blank project.' : 'A new blank project opens.'}</p>
      <p>When autosave next saves, the saved project moves to recovery, replacing the project kept there now; Open recovery project brings it back.</p>
    </Confirm>
  </>
}
