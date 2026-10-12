// The insert palette (owner decision D9: a plain list): every widget module, grouped as spec 5.1 groups them.
import { WIDGETS } from '../widgets/registry'
import { WIDGET_ICONS } from './widgetIcons'
import './sidebar.css'

const GROUPS = [['chrome', 'Chrome'], ['values', 'Values'], ['controls', 'Controls'], ['icons', 'Icons']] as const
export function WidgetPalette({ onInsert }: { onInsert: (type: string) => void }) {
  const all = Object.values(WIDGETS).sort((a, b) => a.label.localeCompare(b.label))
  return <nav className="vb-palette" aria-label="Widgets">
    {GROUPS.map(([g, name]) => {
      const members = all.filter(m => m.group === g)
      return <details className="disc" open key={g}>
        <summary><span className="ptitle">{name}</span><span className="unit">{members.length}</span></summary>
        <div className="grid2">{members.map(m => <button className="raised" key={m.type} type="button" onClick={() => onInsert(m.type)}>{WIDGET_ICONS[m.type]}{m.label}</button>)}</div>
      </details>
    })}
    <p className="unit">Click a widget to insert it at the page centre, inside the entered group if there is one. Item / gas icon and Text input are native game elements.</p>
  </nav>
}
