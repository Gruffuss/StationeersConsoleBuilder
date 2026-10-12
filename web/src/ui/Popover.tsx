import { useEffect, useRef, type ReactNode } from 'react'

export function Popover(p: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string; align?: 'start' | 'end' }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!p.open) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose() }
    }
    const outside = (e: PointerEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) p.onClose() }
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside) }
  }, [p.open, p.onClose])
  return <div ref={ref} role="dialog" aria-label={p.label} className={`float vb-popover ${p.className ?? ''}`} hidden={!p.open} style={p.align === 'end' ? { right: 0, left: 'auto' } : undefined}>{p.children}</div>
}
