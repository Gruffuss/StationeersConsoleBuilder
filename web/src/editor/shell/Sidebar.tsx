import type { ReactNode } from 'react'
import { Tabs } from '../../ui/Tabs'

export function Sidebar(p: { tab: 'Layers' | 'Widgets'; onTab(tab: 'Layers' | 'Widgets'): void; layers: ReactNode; widgets: ReactNode }) {
  return <aside className="vb-sidebar sunk" aria-label="Pages and layers"><Tabs label="Sidebar" idPrefix="vb-side" tabs={(['Layers', 'Widgets'] as const).map(id => ({ id, label: id }))} value={p.tab} onChange={p.onTab} />
    <div role="tabpanel" id="vb-side-panel-Layers" aria-labelledby="vb-side-tab-Layers" hidden={p.tab !== 'Layers'}>{p.layers}</div>
    <div role="tabpanel" id="vb-side-panel-Widgets" aria-labelledby="vb-side-tab-Widgets" hidden={p.tab !== 'Widgets'}>{p.widgets}</div>
  </aside>
}
