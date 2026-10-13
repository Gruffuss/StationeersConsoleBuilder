import { commandsOf, runCommand } from '../../editing/registry'
import { enterable } from '../../editing/depth'
import type { Ctx } from '../../editing/types'
import { nodeAt } from '../../model/store'
import { nativeAt, widgetAt, widgetRootOf } from '../../widgets/core'
import { WIDGETS } from '../../widgets/registry'
import type { Box } from '../geometry'
import { MenuButton } from '../../ui/Menu'
import { Icon } from '../../ui/icons'

export function TaskBar(p: { ctx: Ctx; box: Box | null; zoom: number; onDataNames(): void }) {
  const ctx = p.ctx, state = ctx.get(), page = ctx.page(), sel = state.selection
  if (!p.box || !sel || sel.pageId !== page.id || sel.inDefs) return null
  const widget = sel.native ? nativeAt(page, sel.native, ctx.theme()) : widgetAt(page.scene, sel.path, ctx.theme()), root = !sel.native && widgetRootOf(page.scene, sel.path, ctx.theme())
  if (root && root.length < sel.path.length) return null
  const node = !sel.native && nodeAt(page.scene.root, sel.path), group = !widget && node && enterable(page.scene, sel.path, ctx.theme()), count = state.also.length + 1
  const commands = commandsOf(ctx), button = (id: string, label?: string) => {
    const c = commands.find(c => c.id === id)
    return c && <button className="btn" key={id} disabled={!c.when(ctx)} onMouseDown={e => e.preventDefault()} onClick={() => void runCommand(c, ctx)}>{label ?? c.label}</button>
  }
  const b = p.box
  return <div className="vb-taskbar raised" role="toolbar" aria-label="Selection actions" style={{ left: (b.x + b.w / 2) * p.zoom, top: (b.y + b.h) * p.zoom + 12, transform: 'translateX(-50%)' }} onPointerDown={e => e.stopPropagation()}>
    <span className="unit">{count > 1 ? `${count} selected` : widget ? WIDGETS[widget.type]?.label ?? widget.type : group ? 'Group' : node ? node.op : ''}</span>
    {count > 1 ? button('group') : widget ? <>{!sel.native && button('select.enter', 'Edit parts')}{WIDGETS[widget.type]?.params.some((param: { type: string }) => param.type === 'keys') && <button className="btn" onMouseDown={e => e.preventDefault()} onClick={p.onDataNames}>Data names</button>}</> : group ? <>{button('select.enter')}{button('ungroup')}</> : null}
    <MenuButton label="More actions" align="end" className="ibtn flat" items={() => ['duplicate', 'delete', 'hide', 'lock', 'front', 'back'].flatMap(id => {
      const c = commands.find(c => c.id === id)
      return c ? [{ kind: 'item' as const, id: c.id, label: c.label, disabled: !c.when(ctx), run: () => { void runCommand(c, ctx) } }] : []
    })}><Icon name="more" /></MenuButton>
  </div>
}
