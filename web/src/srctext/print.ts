// The canonical src printer: every scene validateScene accepts prints to text that parseSrc reads back as the same scene,
// comments included. Output follows the vector parser's ToProps grammar. Nothing recurses: a scene nests as deep as it likes.
import type { Scene, SrcNode, Value } from '../model/scene'
import { numberOf, toFloat32, WS } from './parse'
import { joined, validateScene } from './validate'

/** The shortest decimal that parses back to Math.fround(v), read as the mod reads it (one rounding); '-0' for -0. */
export function shortestFloat(v: number): string {
  const f = Math.fround(v)
  if (Object.is(f, -0)) return '-0'
  if (!Number.isFinite(f)) return String(f)
  for (let p = 1; p < 9; p++) {
    const s = String(Number(f.toPrecision(p)))
    if (toFloat32(s) === f) return s
  }
  return String(Number(f.toPrecision(9)))   // 9 significant digits always identify a float32
}

/** Bare iff non-empty, no WS, none of = { } [ ] , no # after the first char, no leading ", and not read as a number. */
const bare = (s: string) => s !== '' && !WS.test(s) && !/[={}[\],]/.test(s) && s.indexOf('#', 1) < 0 && s[0] !== '"' && numberOf(s) === undefined
const ESCAPES: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t' }
const quote = (s: string) => '"' + s.replace(/[\\"\n\t]/g, c => ESCAPES[c]) + '"'
const str = (s: string) => bare(s) ? s : quote(s)
// A leading # where a key or an op stands starts a comment, so it is quoted there.
const name = (k: string) => k[0] === '#' ? quote(k) : str(k)
/** A value as src writes it; an array of any depth. */
export const item = (v: Value): string => joined(v, x => typeof x === 'number' ? shortestFloat(x) : str(x))
// After `key=` an expression prints bare when it has no whitespace (`y==1+2`); inside an array it is always quoted.
const value = (v: Value) => typeof v === 'string' && v[0] === '=' && !WS.test(v) ? v : item(v)
const attrs = (a: Record<string, Value>) => Object.entries(a).map(([k, v]) => ` ${name(k)}=${value(v)}`).join('')
// Four spaces a level, up to 32 levels: past that the indent stays, so a deep scene's text grows with its nodes, not with
// its nodes times its depth (the mod reads blocks by their braces; indents are only for people).
const INDENT = Array.from({ length: 33 }, (_, k) => '    '.repeat(k))
const pad = (depth: number) => INDENT[Math.min(depth, 32)]

/** Canonical text: SCENE, DEFS { … }, then the root nodes; one node per line, 4-space indents, LF line ends. The app
 *  prints checked scenes (printChecked); this validating form is the tests' oracle. */
export function printSrc(scene: Scene): string {
  const { errors } = validateScene(scene)
  if (errors.length) throw new Error('src cannot hold this scene: ' + errors.map(e => e.message).join('; '))
  return printChecked(scene)
}

/** printSrc without the validation, for a scene known valid (a model scene, or one the checker passed). Linear. */
export function printChecked(scene: Scene): string {
  const out: string[] = []
  const notes = (list: string[] | undefined, at = '') => { for (const t of list ?? []) out.push(`${at}# ${t}`) }
  // Depth first with an explicit stack. A frame is a node list printed at one depth; a node with a block opens the next
  // frame, and its tail comments and its } print when that frame ends.
  const nodes = (list: SrcNode[], depth: number) => {
    const frames: { list: SrcNode[]; k: number; depth: number; owner?: SrcNode }[] = [{ list, k: 0, depth }]
    while (frames.length) {
      const f = frames[frames.length - 1]
      if (f.k === f.list.length) {
        frames.pop()
        if (f.owner) { notes(f.owner.tail, pad(f.depth)); out.push(pad(f.depth - 1) + '}') }
        continue
      }
      const n = f.list[f.k++], at = pad(f.depth)
      notes(n.comments, at)
      const block = n.c !== undefined || !!n.tail?.length
      out.push(at + name(n.op) + attrs(n.attrs) + (block ? ' {' : '') + (n.eol !== undefined ? `  # ${n.eol}` : ''))
      if (block) frames.push({ list: n.c ?? [], k: 0, depth: f.depth + 1, owner: n })
    }
  }
  // A note whose line is not printed still prints where that line would stand, so no comment is lost.
  notes(scene.notes?.header)
  if (Object.keys(scene.header).length) out.push('SCENE' + attrs(scene.header))
  notes(scene.notes?.defs)
  if (scene.defs.length) {
    out.push('DEFS {')
    nodes(scene.defs, 1)
    notes(scene.notes?.defsTail, pad(1))
    out.push('}')
  } else notes(scene.notes?.defsTail)
  nodes(scene.root, 0)
  notes(scene.notes?.tail)
  return out.join('\n') + '\n'
}
