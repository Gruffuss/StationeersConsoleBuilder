import type { ReactNode } from 'react'

export function DevBar(p: { scripts: boolean; onScripts(v: boolean): void; compare: boolean; onCompare(v: boolean): void; children: ReactNode }) {
  return <header className="vb-header vb-devbar raised"><label className="chk" title="Dev: run a vector example as raw Lua, with its data and tick"><input type="checkbox" checked={p.scripts} onChange={e => p.onScripts(e.target.checked)} /> Example scripts (dev)</label>{p.children}<label className="chk" title="Dev: lay a console capture over the canvas, at zoom 1, and measure the difference"><input type="checkbox" checked={p.compare} onChange={e => p.onCompare(e.target.checked)} /> Compare</label></header>
}
