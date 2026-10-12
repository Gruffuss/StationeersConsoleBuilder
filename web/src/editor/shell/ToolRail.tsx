import { TOOLS } from '../../editing/registry'
import type { Ctx } from '../../editing/types'
import { dressed } from '../../editing/draw'
import { themeOf } from '../../theme'
import { Icon, type IconName } from '../../ui/icons'

const order = ['select', 'points', 'pen', 'path', 'rect', 'ellipse', 'polygon', 'line', 'text', 'image', 'gradient']
export function ToolRail({ ctx }: { ctx: Ctx }) {
  const tools = [...order.flatMap(id => TOOLS.filter(t => t.id === id)), ...TOOLS.filter(t => !order.includes(t.id))]
  const attrs = dressed({ op: 'R', attrs: {} }, 'R', themeOf(ctx.get().project), ctx.drawDefaults()).attrs
  const paint = (key: string) => typeof attrs[key] === 'string' && /^#[\da-f]+$/i.test(attrs[key] as string) ? attrs[key] as string : undefined
  return <nav className="vb-rail sunk" aria-label="Tools">{tools.map(t => <div key={t.id}>
    {['pen', 'rect', 'text'].includes(t.id) && <div className="hsep" role="separator" />}
    <button className="ibtn" aria-pressed={ctx.tool() === t.id} aria-keyshortcuts={t.key} title={t.key ? `${t.label} (${t.key})` : t.label} onMouseDown={e => e.preventDefault()} onClick={() => ctx.setTool(t.id)}><Icon name={order.includes(t.id) ? t.id as IconName : 'select'} /><span className="vh">{t.label}</span></button>
  </div>)}<div className="vb-defaults" role="img" aria-label={`Draw defaults: fill ${paint('f') ?? 'none'}, outline ${paint('s') ?? 'none'}`}><span style={{ background: paint('f') }} /><span style={{ background: paint('s') }} /></div></nav>
}
