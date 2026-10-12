import { useRef, type ReactNode } from 'react'
import { Dialog } from './Dialog'

export function Confirm(p: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; extra?: ReactNode }) {
  const cancel = useRef<HTMLButtonElement>(null)
  return <Dialog open={p.open} title={p.title} onClose={p.onCancel} size="sm" initialFocus={cancel}
    footer={<>{p.extra}<span style={{ flex: 1 }} /><button ref={cancel} className="btn" onClick={p.onCancel}>Cancel</button><button className="btn danger" onClick={p.onConfirm}>{p.confirmLabel}</button></>}>
    {p.children}
  </Dialog>
}
