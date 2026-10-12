import type { ReactNode } from 'react'
import { MenuBar } from '../../ui/Menu'
import { Icon } from '../../ui/icons'
import type { Menu } from './menus'

export function Header(p: { name: string; menus: Menu[]; storageMessage: string; paused: boolean; onSave(): void; theme: ReactNode; play: boolean; onPlay(): void; onFonts(): void; onExport(): void; canExport: boolean }) {
  return <header className="vb-header">
    <div className="vb-header-banner"><h1 className="title">{p.name || 'Untitled'}</h1>
      <MenuBar label="Menus" menus={p.menus.map(m => ({ ...m, items: () => m.items }))} />
      {p.paused ? <button className="vb-save flat" aria-haspopup="dialog" title={p.storageMessage} onClick={p.onSave}>{p.storageMessage}</button> : <span className="vb-save" title={p.storageMessage}>{p.storageMessage}</span>}
    </div>
    {p.theme}<button className="btn" onClick={p.onFonts}>Fonts</button>
    <button className={`btn${p.play ? ' sel' : ''}`} aria-label="Play" aria-pressed={p.play} onClick={p.onPlay}><Icon name="play" /><span>Play</span></button>
    <button className="btn primary" disabled={!p.canExport} onClick={p.onExport}><Icon name="export" />Export</button>
  </header>
}
