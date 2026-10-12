import type { ReactNode } from 'react'
import { Tabs } from '../../ui/Tabs'
import { Icon, type IconName } from '../../ui/icons'
import type { Ctx } from '../../editing/types'
import { nodeAt } from '../../model/store'
import { designSize } from '../geometry'
import { expandRoot, nativeAt, widgetAt, widgetRootOf } from '../../widgets/core'
import { WIDGETS } from '../../widgets/registry'
import { first } from '../../srctext/props'
import { AlignBar } from './AlignBar'
import { StyleSection } from './StyleSection'

export type InspectorTab = 'Design' | 'Data' | 'Logic' | 'Sim' | 'Lua'
export const opIcon = (op: string): IconName => ({ R: 'rect', C: 'ellipse', G: 'group', L: 'line', SP: 'polygon', P: 'path', T: 'text', IMAGE: 'image' } as Record<string, IconName>)[op.toUpperCase()] ?? 'file'
export function Inspector(p: { ctx: Ctx; tab: InspectorTab; onTab(tab: InspectorTab): void; children: ReactNode }) {
  const ctx = p.ctx, page = ctx.page(), state = ctx.get(), theme = ctx.theme(), sel = state.selection?.pageId === page.id ? state.selection : null
  const root = sel && !sel.inDefs ? widgetRootOf(page.scene, sel.path, theme) : null
  const widget = sel?.native ? nativeAt(page, sel.native, theme) : sel && !sel.inDefs ? widgetAt(page.scene, sel.path, theme) : null
  const node = sel && !sel.native ? nodeAt(sel.inDefs ? page.scene.defs : page.scene.root, sel.path) : null
  const parent = sel && sel.path.length > 1 ? nodeAt(page.scene.root, sel.path.slice(0, -1)) : null
  const parentId = parent && first(parent, 'ID'), id = node && first(node, 'ID'), size = designSize(page.scene.header)
  let icon: IconName = 'page', title = page.name, subtitle = `Page · scene ${size.w} × ${size.h} units`
  if (sel) {
    if (state.also.length) { icon = 'select'; title = `${state.also.length + 1} selected`; subtitle = 'the panel shows the last' }
    else if (widget) { icon = 'widget'; title = WIDGETS[widget.type]?.label ?? widget.type; subtitle = widget.uid }
    else if (node) {
      icon = opIcon(node.op); title = sel.inDefs ? node.op : id ? `#${id}` : node.op
      subtitle = sel.inDefs ? 'definition' : node.op + (parentId ? ` · in ${parentId}` : '')
      if (root) {
        const w = widgetAt(page.scene, root, theme)!, part = Object.entries(expandRoot(w, theme).exp.parts ?? {}).find(([, path]) => path.join() === sel.path.slice(root.length).join())?.[0]
        if (part) subtitle = `part ${part} of ${w.uid}`
      }
    }
  }
  return <aside className="vb-inspector sunk" aria-label="Inspector">
    <Tabs label="Editor panels" idPrefix="vb-insp" tabs={(['Design', 'Data', 'Logic', 'Sim', 'Lua'] as const).map(id => ({ id, label: id }))} value={p.tab} onChange={p.onTab} />
    <div role="tabpanel" id={`vb-insp-panel-${p.tab}`} aria-labelledby={`vb-insp-tab-${p.tab}`}>
      {p.tab === 'Design' && <><div className="vb-inspector-head"><Icon name={icon} /><div><h2 className="ptitle">{title}</h2><span className="unit">{subtitle}</span></div></div>
        {sel && <><AlignBar ctx={ctx} />{!widget && !sel.inDefs && <StyleSection ctx={ctx} />}</>}
      </>}{p.children}
    </div>
  </aside>
}
