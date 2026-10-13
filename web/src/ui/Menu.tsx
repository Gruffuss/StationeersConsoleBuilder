import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './icons'

export type MenuItem =
  | { kind: 'item'; id: string; label: string; keys?: string; disabled?: boolean; checked?: boolean; note?: string; dev?: boolean; run: () => void }
  | { kind: 'group'; label: string; dev?: boolean }
  | { kind: 'separator' }
  | { kind: 'note'; text: string }
  | { kind: 'submenu'; id: string; label: string; count?: number; disabled?: boolean; items: MenuItem[] }

type Entry = Extract<MenuItem, { kind: 'item' | 'submenu' }>
type Menu = { id: string; label: string; items: () => MenuItem[] }
const enabled = (items: MenuItem[]) => items.flatMap((item, index) => (item.kind === 'item' || item.kind === 'submenu') && !item.disabled ? [index] : [])
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function Menus(p: { label: string; menus: Menu[]; single?: boolean; align?: 'end'; className?: string; children?: ReactNode; title?: string }) {
  const id = useId(), [trigger, setTrigger] = useState(0)
  const root = useRef<HTMLDivElement>(null), triggers = useRef<(HTMLButtonElement | null)[]>([])
  const panel = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef(false), pendingFocus = useRef(false)
  const [open, setOpen] = useState<number | null>(null)
  const [active, setActive] = useState(-1), [sub, setSub] = useState<number | null>(null), [subActive, setSubActive] = useState(-1)
  const items = open === null ? [] : p.menus[open].items()
  const submenu = sub === null ? undefined : items[sub]
  const subItems = submenu?.kind === 'submenu' ? submenu.items : []
  const left = open === null ? 0 : triggers.current[open]?.offsetLeft ?? 0
  const menuStyle = { '--vb-menu-top': `${open === null ? 64 : triggers.current[open]?.getBoundingClientRect().bottom ?? 64}px` } as CSSProperties

  function close() {
    if (restoreFocus.current && open !== null) triggers.current[open]?.focus()
    setOpen(null); setSub(null)
  }
  function show(index: number, keyboard: boolean) {
    setTrigger(index)
    restoreFocus.current = keyboard || document.activeElement === triggers.current[index]
    pendingFocus.current = keyboard
    setOpen(index); setActive(-1); setSub(null); setSubActive(-1)
  }
  function activate(item: Entry, index: number, keyboard: boolean) {
    if (item.disabled) return
    if (item.kind === 'item') { close(); item.run() }
    else {
      pendingFocus.current = keyboard
      setActive(index); setSub(index); setSubActive(enabled(item.items)[0] ?? -1)
    }
  }
  useEffect(() => {
    if (open === null) return
    if (active < 0) {
      setActive(enabled(items)[0] ?? -1)
      return
    }
    if (pendingFocus.current) {
      root.current?.querySelector<HTMLButtonElement>(`[data-menu-level="${sub === null ? 0 : 1}"] > button[data-menu-index="${sub === null ? active : subActive}"]`)?.focus()
      pendingFocus.current = false
    }
  })
  useEffect(() => {
    if (open === null) return
    const key = (e: KeyboardEvent) => {
      if (e.target !== document.body && !root.current?.contains(e.target as Node)) return
      if (e.key === 'Tab') { restoreFocus.current = false; close(); return }
      if (!['Escape', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End', 'Enter', ' '].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { close(); return }
      const inSub = sub !== null, list = inSub ? subItems : items, index = inSub ? subActive : active
      const item = list[index]
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        const choices = enabled(list)
        const at = choices.indexOf(index), direction = e.key === 'ArrowDown' ? 1 : -1
        const next = (e.key === 'Home' ? choices[0] : e.key === 'End' ? choices.at(-1) : choices[(at + direction + choices.length) % choices.length]) ?? -1
        root.current?.querySelector<HTMLButtonElement>(`[data-menu-level="${inSub ? 1 : 0}"] > button[data-menu-index="${next}"]`)?.focus()
        if (inSub) setSubActive(next)
        else setActive(next)
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (item?.kind === 'item' || item?.kind === 'submenu') activate(item, index, true)
      } else if (e.key === 'ArrowRight') {
        if (!inSub && item?.kind === 'submenu') activate(item, index, true)
        else if (!p.single) show((open + 1) % p.menus.length, true)
      } else if (inSub) {
        pendingFocus.current = true; setSub(null)
      } else if (!p.single) show((open + p.menus.length - 1) % p.menus.length, true)
    }
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) close() }
    document.addEventListener('keydown', key, true)
    document.addEventListener('pointerdown', outside)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', outside) }
  })

  function renderItems(list: MenuItem[], level: number) {
    const checks = list.some(item => item.kind === 'item' && item.checked !== undefined)   // a check column for the whole menu
    return list.map((item, index) => {
      if (item.kind === 'separator') return <div key={index} role="separator" className="hsep" />
      if (item.kind === 'group') return <div key={index} role="presentation" className="mgroup">{item.label}{item.dev && <span className="chip idle">DEV</span>}</div>
      if (item.kind === 'note') return <p key={index} className="unit">{item.text}</p>
      const selected = (level === 0 ? active : subActive) === index
      return <button key={item.id} role={item.kind === 'item' && item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={item.kind === 'item' ? item.checked : undefined} aria-disabled={item.disabled || undefined}
        aria-haspopup={item.kind === 'submenu' ? 'menu' : undefined} aria-expanded={item.kind === 'submenu' ? sub === index : undefined}
        className={`mi${selected ? ' on' : ''}`} tabIndex={selected && !item.disabled ? 0 : -1} data-menu-index={index}
        onMouseDown={keepFocus} onMouseEnter={() => { if (item.disabled) return; if (level === 0) { setActive(index); if (sub !== index) setSub(null) } else setSubActive(index) }}
        onClick={() => activate(item, index, false)}>
        {checks && <span className="mi-check">{item.kind === 'item' && item.checked && <Icon name="check" />}</span>}<span>{item.label}</span>{item.kind === 'item' ? <>{item.dev && <span className="chip idle">DEV</span>}{item.note && <span className="unit">{item.note}</span>}{item.keys && <span className="kbd">{item.keys}</span>}</> : <>{item.count !== undefined && <span className="unit">{item.count}</span>}<Icon name="chevron-right" /></>}
      </button>
    })
  }
  return <div ref={root} className="vb-menu-anchor" onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) { restoreFocus.current = false; close() }
  }}>
    <div role={p.single ? undefined : 'menubar'}>{p.menus.map((menu, index) => <button key={menu.id} ref={button => { triggers.current[index] = button }}
      role={p.single ? undefined : 'menuitem'} aria-label={p.single ? p.label : undefined} aria-haspopup="menu" aria-expanded={open === index}
      aria-controls={open === index ? `${id}-panel` : undefined} tabIndex={p.single || trigger === index ? 0 : -1} onFocus={() => setTrigger(index)}
      className={p.className} title={p.title} onMouseDown={keepFocus} onClick={() => { if (open === index) close(); else show(index, false) }}
      onMouseEnter={() => { if (open !== null && open !== index) show(index, false) }}
      onKeyDown={e => {
        if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(index, true) }
        else if (!p.single && ['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
          e.preventDefault()
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? p.menus.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : p.menus.length - 1)) % p.menus.length
          triggers.current[next]?.focus()
          setTrigger(next)
        }
      }}>{p.single ? p.children ?? menu.label : menu.label}</button>)}</div>
    {open !== null && <div ref={panel} id={`${id}-panel`} role="menu" aria-label={p.menus[open].label} className="float menu vb-menu-panel" data-menu-level="0" style={{ ...menuStyle, ...(p.align === 'end' ? { right: 0 } : { left }) }}>
      {renderItems(items, 0)}
    </div>}
    {open !== null && submenu?.kind === 'submenu' && <div role="menu" aria-label={submenu.label} className="float menu vb-submenu vb-submenu-panel" data-menu-level="1" style={{ ...menuStyle, left: left + (panel.current?.offsetWidth ?? 200), top: '100%' }}>{renderItems(subItems, 1)}</div>}
  </div>
}

export function MenuBar(p: { label: string; menus: Menu[] }) {
  return <nav aria-label={p.label}><Menus {...p} /></nav>
}

export function MenuButton(p: { label: string; items: () => MenuItem[]; align?: 'end'; className?: string; children?: ReactNode; title?: string }) {
  return <Menus {...p} single menus={[{ id: 'menu', label: p.label, items: p.items }]} />
}
