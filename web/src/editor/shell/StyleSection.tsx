import { commandsOf, runCommand } from '../../editing/registry'
import { namedCommands } from '../../editing/commands/style'
import type { Ctx } from '../../editing/types'

export function StyleSection({ ctx }: { ctx: Ctx }) {
  const named = namedCommands(ctx)
  return <section className="vb-style-section" aria-label="Style"><h3 className="ptitle">Style</h3>
    <select aria-label="Named style" defaultValue="" onChange={e => { const command = named.find(c => c.id === e.target.value); if (command) void runCommand(command, ctx); e.target.value = '' }}>
      <option value="">Choose a named style</option>{['Text', 'Part', 'Status', 'Glow'].map(group => <optgroup key={group} label={group}>{named.filter(c => c.label.startsWith(group + ':')).map(c => <option key={c.id} value={c.id} disabled={!c.when(ctx)}>{c.label.slice(group.length + 2)}</option>)}</optgroup>)}
    </select>
    <div className="vb-row">{commandsOf(ctx).filter(c => ['style.copy', 'style.paste', 'style.useAsDefault', 'style.resetDefaults'].includes(c.id)).map(c => <button className="btn" key={c.id} disabled={!c.when(ctx)} onMouseDown={e => e.preventDefault()} onClick={() => void runCommand(c, ctx)}>{c.label}</button>)}</div>
  </section>
}
