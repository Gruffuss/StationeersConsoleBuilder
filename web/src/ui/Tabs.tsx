import { useLayoutEffect, useState } from 'react'

export function Tabs<T extends string>(p: { label: string; tabs: readonly { id: T; label: string }[]; value: T; onChange: (id: T) => void; idPrefix: string; className?: string }) {
  const [panels, setPanels] = useState<string[]>([])
  useLayoutEffect(() => {
    const next = p.tabs.map(tab => `${p.idPrefix}-panel-${tab.id}`).filter(id => document.getElementById(id))
    setPanels(prev => prev.join() === next.join() ? prev : next)
  })
  return <div role="tablist" aria-label={p.label} className={`seg ${p.className ?? ''}`}>
    {p.tabs.map((tab, index) => <button key={tab.id} role="tab" id={`${p.idPrefix}-tab-${tab.id}`} aria-selected={p.value === tab.id}
      aria-controls={panels.includes(`${p.idPrefix}-panel-${tab.id}`) ? `${p.idPrefix}-panel-${tab.id}` : undefined} tabIndex={p.value === tab.id ? 0 : -1} onClick={() => p.onChange(tab.id)}
      onKeyDown={e => {
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? p.tabs.length - 1 : e.key === 'ArrowRight' ? (index + 1) % p.tabs.length : e.key === 'ArrowLeft' ? (index + p.tabs.length - 1) % p.tabs.length : -1
        if (next < 0) return
        e.preventDefault()
        p.onChange(p.tabs[next].id)
        e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
      }}>{tab.label}</button>)}
  </div>
}
