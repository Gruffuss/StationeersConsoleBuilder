// Traps that need the live data (spec §4): warnings and information, never errors (nothing the mod accepts is
// refused). Each message once, whatever page repeats it.
import type { Project } from '../model/project'
import type { SrcNode } from '../model/scene'
import { first } from '../srctext/props'
import { isColour } from '../srctext/validate'
import type { Theme } from '../theme/types'
import type { Problem } from './linemap'
import { namesOf } from './names'

const PAINTS = ['F', 'S', 'S_']

/** Names a raw node or header's paint reads whole as its colour (`f=$x`), over every page. Iterative. */
function colourNames(p: Project): Set<string> {
  const out = new Set<string>()
  for (const page of p.pages) {
    const stack: SrcNode[] = [{ op: 'SCENE', attrs: page.scene.header }, ...page.scene.root, ...page.scene.defs]
    for (let n = stack.pop(); n; n = stack.pop()) {
      for (const key of PAINTS) { const v = first(n, key); if (typeof v === 'string' && /^\$[^\s$]+$/.test(v)) out.add(v.slice(1)) }
      for (const c of n.c ?? []) stack.push(c)
    }
  }
  return out
}

export function readTraps(p: Project, t: Theme): Problem[] {
  const out = new Map<string, Problem>(), reads = new Map(p.reads.map(r => [r.id, r])), colours = colourNames(p)
  const add = (level: Problem['level'], message: string) => out.set(message, { level, message })
  for (const page of p.pages) for (const n of namesOf(page, t)) {
    const b = Object.hasOwn(p.bindings, n.name) ? p.bindings[n.name] : undefined
    if (!b) continue
    if (n.kind === 'number' && !n.snap && b.from === 'read' && (b.part ?? 'value') === 'value') {
      const r = reads.get(b.read)
      if (r && !r.clamp && !r.derived) add('warning', `${n.name}: drives geometry from read ${r.id}, which has no clamp; a value out of range draws outside its widget`)
    }
    if (n.kind === 'raw' && colours.has(n.name)) {
      if (b.from !== 'const') add('info', `${n.name}: a paint reads it as a colour: send #hex, none or named colour strings`)
      else if (typeof b.value !== 'string' || !isColour(b.value)) add('warning', `${n.name}: a paint reads it as a colour; the constant is not a valid colour, so it draws magenta`)
    }
  }
  return [...out.values()]
}
