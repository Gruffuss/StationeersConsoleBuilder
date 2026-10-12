// The export's line map (spec §8) and the problems codegen reports. A chip error carries its chunk position
// (`[string "chip"]:<line>:`, measured); mapError names the owner of that line: the custom block (with its own line number),
// a read, a rule, an action, a binding, or the generated code.
export type Part = 'lib' | 'config' | 'custom' | 'page' | 'read' | 'rule' | 'action' | 'binding' | 'devices' | 'boot'
export type MapEntry = { first: number; last: number; part: Part; ref?: string }
export type Problem = { level: 'error' | 'warning' | 'info'; message: string; owner?: string }

export function mapError(text: string, map: MapEntry[]): string {
  const m = /\[string "chip"\]:(\d+):\s*/.exec(text)
  if (!m) return text
  const line = Number(m[1]), rest = text.slice(m.index + m[0].length), tail = rest ? `: ${rest}` : ''   // error("") has none
  const e = map.find(x => line >= x.first && line <= x.last)
  if (e?.part === 'custom') return `custom code line ${line - e.first + 1}${tail}`
  if (e?.ref !== undefined && ['read', 'rule', 'action', 'binding', 'page'].includes(e.part)) return `${e.part} ${e.ref}${tail}`
  return `generated line ${line}${tail}`
}
