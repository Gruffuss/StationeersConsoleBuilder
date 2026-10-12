import type { ReactNode } from 'react'
import { Icon } from '../../ui/icons'

export function SourcePane(p: { name: string; open: boolean; onClose(): void; counts: { errors: number; warnings: number }; children: ReactNode }) {
  const { errors, warnings } = p.counts, diagnostic = [errors && `● ${errors} error${errors === 1 ? '' : 's'}`, warnings && `● ${warnings} warning${warnings === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  return <section className="vb-source sunk" aria-label="Source pane" hidden={!p.open}><div className="vb-source-head"><Icon name="code" /><span className="ptitle">Source</span><span className="unit">{p.name}</span>{diagnostic && <span className="unit">{diagnostic}</span>}<button className="ibtn flat" aria-label="Close the source pane" onClick={p.onClose}><Icon name="close" /></button></div>{p.children}</section>
}
