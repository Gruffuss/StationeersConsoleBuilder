import { commandsOf, runCommand } from '../../editing/registry'
import type { Ctx } from '../../editing/types'
import { Icon, type IconName } from '../../ui/icons'
import { keysLabel } from './keyLabels'

export function AlignBar({ ctx }: { ctx: Ctx }) {
  return <div className="vb-align" role="toolbar" aria-label="Align">{commandsOf(ctx).filter(c => c.id.startsWith('align.') || c.id.startsWith('distribute.')).map(c => <button className="ibtn flat" key={c.id} aria-label={c.label} title={c.label + (c.keys?.length ? ` (${keysLabel(c.keys)})` : '')} disabled={!c.when(ctx)} onMouseDown={e => e.preventDefault()} onClick={() => void runCommand(c, ctx)}>
    <Icon name={c.id.startsWith('align.') ? c.id.replace('.', '-') as IconName : c.id.endsWith('x') ? 'distribute-h' : 'distribute-v'} /><span className="vh">{c.label}</span>
  </button>)}</div>
}
