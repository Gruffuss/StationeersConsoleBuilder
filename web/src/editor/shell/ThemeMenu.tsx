import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Popover } from '../../ui/Popover'
import { Icon } from '../../ui/icons'

export function ThemeMenu(p: { name: string; children: ReactNode; onImport(): void }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null)
  const close = () => { setOpen(false); button.current?.focus() }
  useEffect(() => {
    if (!open) return
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.target !== document.body && !menu.current?.contains(e.target as Node)) return
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio], [role=menuitem]') ?? [])
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : e.key === 'ArrowUp' ? (at + items.length - 1) % items.length : -1
      if (next >= 0) { e.preventDefault(); e.stopPropagation(); items[next]?.focus() }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); items[at]?.click() }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [open])
  return <div className="vb-theme-anchor"><button ref={button} className="btn" aria-label="Theme" aria-haspopup="menu" aria-expanded={open} aria-controls="vb-theme-menu" onClick={() => setOpen(v => !v)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) } }}><span className="unit">Theme</span>{p.name}<Icon name="chevron-down" /></button>
    <Popover open={open} label="Theme" align="end" onClose={close}><div ref={menu} id="vb-theme-menu" className="vb-theme-menu" role="menu" aria-label="Theme" onClick={e => { if ((e.target as Element).closest('[role=menuitemradio]')) close() }}>{p.children}<button className="mi" role="menuitem" onClick={() => { close(); p.onImport() }}>Import a design system…</button></div></Popover>
  </div>
}
