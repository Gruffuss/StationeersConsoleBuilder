// The attribute catalogue: every key each op takes, as the property panel and the trap warnings read it. A base
// extracted from the pinned parser (extracted.json, written by extract.ts: kinds, numeric defaults, the mod's lists)
// joined to a hand overlay (overlay.json: types, groups, order, enums, ranges, requirements, notes), the two held together
// by drift tests (schema.test.ts) and by the mod itself (core/Core.Tests/SchemaTests.cs). Everything here is frozen.
import type { Value } from '../model/scene'
import { foldKey } from '../srctext/props'
import type { Extracted, Kind, Read } from './extract'
import extractedJson from './extracted.json'
import overlay from './overlay.json'

export type { Kind }
export const FIELD_TYPES = ['num', 'int', 'flag', 'enum', 'colour', 'paint', 'pair', 'numlist', 'shadow', 'stops',
  'string', 'text', 'id', 'idref', 'path', 'map', 'array', 'font'] as const   // font: free text, any name the Fonts mod knows (spec 5.3)
export type FieldType = typeof FIELD_TYPES[number]
/** The panel's group order. */
export const GROUPS = ['scene', 'geometry', 'transform', 'fill', 'stroke', 'text', 'image', 'repeat', 'effects', 'pointer',
  'gradient', 'data', 'other'] as const
export type Group = typeof GROUPS[number]
/**
 * One key on one op.
 * - default: the value an absent key reads as. None when absence is not a value: then defaultFrom names the key whose
 *   value it takes (ry is rx, bw is slice), or defaultNote says what happens (fo2: no ramp). The "(default)" choice of a
 *   panel removes the key.
 * - requires: the key on this node without which this one does nothing. On G and SCENE it is spelled as the group
 *   default it is: a stroke key there requires s_, never s (on a G s is the scale pair; SCENE's bare s is not read,
 *   SceneModel.cs:666, 1438-1444). requiresAbove: the key an enclosing node or the SCENE header meets it with, as a group
 *   default passed down (any node with a block passes its defaults to its children, SceneModel.cs:2204-2217, 1235; an SC
 *   keeps its own so since 0.11.92); absent when only the node itself can (slice, tile, an SC's sov: since 0.11.98 the SC
 *   reads its scroll offset from its own map, :1832-1836, so a so passed down to it is not its offset). So a shape's sw is
 *   met by its own s or an enclosing s_, a G's sw by its own s_ or an enclosing s_, and an SC's sov by its own so only.
 *   Line numbers are SceneModel.cs's at v0.11.118.
 */
export type Field = { op: string; key: string; kind: Kind; type: FieldType; group: Group; order: number; default?: Value;
  defaultFrom?: string; defaultNote?: string; enum?: string[]; alias?: Record<string, string>; range?: [number, number];
  requires?: string; requiresAbove?: string; since?: string; note?: string; hidden?: true }
export type Row = Omit<Field, 'op' | 'kind' | 'requiresAbove'> & { ops: string[]; kind?: Kind }

const freeze = <T>(x: T): T => {
  for (const v of Object.values(x as object)) if (v && typeof v === 'object') freeze(v)
  return Object.freeze(x)
}
const X = freeze(extractedJson as unknown as Extracted)
/** The overlay as written, for the drift tests. */
export const ROWS: readonly Row[] = freeze(overlay.rows as unknown as Row[])
/** The requirements a group passes down (GroupPaintDefaults) and a node reads from what it inherits: f as itself, s
 *  spelled s_. Not so, the one key that requires it (an SC's sov) being read from the SC's own map since 0.11.98. */
export const PASSED_DOWN: ReadonlyMap<string, string> = new Map([['f', 'f'], ['s', 's_']])

/** The ParseNode case labels, in source order (USE first). */
export const NODE_OPS: readonly string[] = X.nodeOps
/** Definition ops: FONT, the switch cases, then SYM (read before the switch). */
export const DEF_OPS: readonly string[] = X.defOps

// A key's read on op: its own case, else the methods every node op (SCENE's paint defaults included) or every def op
// shares, else where the row's other ops read it, since a paint default is read where it lands (G size is T's size).
const readOf = (op: string, row: Row): Read | undefined => {
  const shared = DEF_OPS.includes(op) ? 'DEF' : op === 'DATA' ? '' : 'NODE'
  return [op, shared, ...row.ops].map(s => X.reads[s]?.[row.key]).find(r => r?.kind)
}

/** The overlay's rows joined to the extraction: op -> its fields by folded key, sorted by group, then order. Two rows
 *  that give one op the same key throw. */
export function catalogue(rows: readonly Row[]): Map<string, Map<string, Field>> {
  const byOp = new Map<string, Map<string, Field>>()
  for (const row of rows) {
    const { ops, kind, requires, ...rest } = row
    for (const op of ops) {
      const read = readOf(op, row), pass = requires === undefined ? undefined : PASSED_DOWN.get(requires)
      const def = rest.defaultFrom || rest.defaultNote ? undefined : rest.default ?? read?.default ?? rest.enum?.[0]
      const field: Field = freeze({ ...rest, op, kind: read?.kind ?? kind ?? 'S', ...(def === undefined ? {} : { default: def }),
        ...(requires === undefined ? {} : { requires: (op === 'G' || op === 'SCENE') && pass || requires }),
        ...(pass === undefined ? {} : { requiresAbove: pass }) })
      const fields = byOp.get(op) ?? new Map<string, Field>()
      if (fields.has(foldKey(row.key))) throw new Error(`overlay: two rows give ${op} the key ${row.key}`)
      byOp.set(op, fields.set(foldKey(row.key), field))
    }
  }
  return new Map([...byOp].map(([op, fields]) => [op, new Map([...fields].sort(([, a], [, b]) =>
    GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order))]))
}
const KEYED = catalogue(ROWS)
const BY_OP = new Map([...KEYED].map(([op, fields]) => [op, [...fields.values()]]))

/** op: a node op, a def op, 'SCENE' or 'DATA'; sorted by group, then order. A new array of frozen fields. */
export const fieldsFor = (op: string): Field[] => [...BY_OP.get(foldKey(op)) ?? []]
/** The key compared as the mod compares it (foldKey). */
export const fieldOf = (op: string, key: string): Field | undefined => KEYED.get(foldKey(op))?.get(foldKey(key))

const ALL = [...BY_OP.values()].flat()
const keysOf = (fields: Field[]) => new Set(fields.map(f => foldKey(f.key)))

/** Authored keys whose numeric values are literal-only, taken from the parser's exact lists. */
export const LITERAL_KEYS: ReadonlySet<string> = new Set(X.literalKeys.map(foldKey))
export const SCENE_LITERAL_KEYS: ReadonlySet<string> = new Set(X.sceneLiteralKeys.map(foldKey))
/** Upper case, the mod's KnownKeys. */
export const KNOWN_KEYS: ReadonlySet<string> = new Set(X.knownKeys.map(foldKey))
/** Upper case, the mod's SceneKeys: what it passes on the SCENE header besides KnownKeys (0.11.96). */
export const SCENE_KEYS: ReadonlySet<string> = new Set(X.sceneKeys.map(foldKey))
/** Upper case: keys whose kind is E, P or L on some op, plus the filter keys, minus S (a paint on shapes; validate.ts
 *  special-cases the scale pair on G). */
export const EXPRESSIONS: ReadonlySet<string> = new Set([...keysOf(ALL.filter(f => ['E', 'P', 'L'].includes(f.kind))),
  ...X.filterKeys.map(foldKey)].filter(k => k !== 'S'))
export const PAINTS: ReadonlySet<string> = keysOf(ALL.filter(f => f.type === 'paint' || f.type === 'colour'))
/** Colour values, or lists holding them. */
export const COLOUR_KEYS: ReadonlySet<string> = keysOf(ALL.filter(f => ['paint', 'colour', 'stops', 'shadow'].includes(f.type)))
export const TEXTS: ReadonlySet<string> = keysOf(ALL.filter(f => f.type === 'text'))
/** Upper case: the scene header keys Parse reads as numbers or strings, scene itself aside (fromProps). */
export const HEADER: ReadonlySet<string> = new Set(Object.entries(X.reads.SCENE)
  .filter(([k, r]) => (r.kind === 'N' || r.kind === 'S' || r.kind === 'TEXT') && k !== 'scene').map(([k]) => foldKey(k)))
/** The mod's GroupPaintDefaults, s_ included. */
export const GROUP_PAINT_DEFAULTS: readonly string[] = X.groupPaintDefaults
/**
 * Whether op, holding a block (any node with one reads its defaults for its children: ParseStyle, SceneModel.cs:1420,
 * called at :2214), passes its key k down, k compared as ParseStyle compares it (SceneModel.cs:1420-1457 at v0.11.118): a
 * group default by its exact key, which is lower case (GroupPaintDefaults is searched ordinally, so `F=` or `SO=` is not
 * passed down), style in any case (PropValue). The header keeps its own fit and an SC its own so (0.11.92), each skipped
 * by its exact key.
 */
export const passesDown = (op: string, k: string) => (X.groupPaintDefaults.includes(k) || foldKey(k) === 'STYLE')
  && !(foldKey(op) === 'SC' && k === 'so') && !(foldKey(op) === 'SCENE' && k === 'fit')
/** name -> arity, since included; no prototype, so toString is no function. */
export const FUNCTIONS: Readonly<Record<string, number>> = Object.freeze(Object.assign(Object.create(null), X.functions))
/** Functions read only in a colour (mix): in a number they are 0. */
export const COLOUR_FUNCTIONS: ReadonlySet<string> = new Set(X.colourFunctions)
/** In the order Expression.Variable reads them, then i1 for iN. */
export const VARIABLES: readonly string[] = X.variables
