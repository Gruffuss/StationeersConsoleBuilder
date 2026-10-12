import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { Icon } from './icons'

export function Dialog(p: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'; closable?: boolean; className?: string; headExtra?: ReactNode
  initialFocus?: RefObject<HTMLElement | null>; label?: string
}) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId()
  const closable = p.closable !== false
  useEffect(() => {
    const dialog = ref.current!
    if (p.open && !dialog.open) {
      if (dialog.showModal) dialog.showModal()
      else dialog.open = true
      p.initialFocus?.current?.focus()
    } else if (!p.open && dialog.open) {
      if (dialog.close) dialog.close()
      else dialog.open = false
    }
  }, [p.open, p.initialFocus])
  useEffect(() => {
    if (!p.open) return
    const key = (e: KeyboardEvent) => {
      const top = Array.from(document.querySelectorAll('dialog[open][aria-modal="true"]')).at(-1)
      if (e.key !== 'Escape' || top !== ref.current || ref.current?.contains(e.target as Node)) return
      e.preventDefault(); e.stopPropagation()
      if (closable) p.onClose()
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [p.open, p.onClose, closable])
  return <dialog ref={ref} className={`dlg dlg-${p.size ?? 'md'} ${p.className ?? ''}`} aria-labelledby={p.label === undefined ? titleId : undefined} aria-label={p.label} aria-modal="true"
    onCancel={e => { e.preventDefault(); if (closable) p.onClose() }} onClose={() => {
      if (!p.open) return
      if (closable) p.onClose()
      else if (!ref.current!.open) {
        if (typeof ref.current!.showModal === 'function') ref.current!.showModal()
        else ref.current!.open = true
      }
    }}>
    <div className="dlg-head"><h2 id={titleId}>{p.title}</h2>{p.headExtra}{closable && <button className="ibtn flat" aria-label="Close" onClick={p.onClose}><Icon name="close" /></button>}</div>
    <div className="dlg-body">{p.children}</div>
    {p.footer !== undefined && <div className="dlg-foot">{p.footer}</div>}
  </dialog>
}
