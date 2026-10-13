// The widget module contract (spec 5.1): typed parameters and the theme in; plain nodes, per-instance defs, data slots,
// click targets and native elements out.
import type { SrcNode, Value } from '../model/scene'
import type { Theme } from '../theme/types'

export type Json = number | string | boolean | null | Json[] | { [k: string]: Json }
export type Params = Record<string, Json>
export type Box = { x: number; y: number; w: number; h: number }

/** One parameter: how the panel edits it, and how an untrusted value is read back (core.ts sanitize). */
export type Param =
  | { key: string; type: 'num'; min?: number; max?: number; int?: true }
  | { key: string; type: 'flag' }
  | { key: string; type: 'enum'; enum: readonly string[]; tokens?: true }
  | { key: string; type: 'text' }       // a plain label (paint.ts plainTextProblem holds)
  | { key: string; type: 'template' }   // any text: the Text widget's template, a native's string
  | { key: string; type: 'fmt' }        // a printf format with no brace (the placeholder's grammar: core.ts FMT)
  | { key: string; type: 'numbers'; min?: number; max?: number }
  | { key: string; type: 'keys' }       // { slot: data name } overrides of <uid>_<slot>
  | { key: string; type: 'page' }       // a page id
  | { key: string; type: 'list'; item: Param[]; min: number }   // items are flat: an item's params are never lists

/** What a data name carries. state: 0 idle, 1 ok, 2 warn, 3 crit (Q4). text: a number or a string, for a name labels alone
 *  read (the mod prints a string as it is and a number through the label's format: Tessellator BindText, BindTemplate).
 *  Array kinds end in s; texts is a list of numbers or a list of strings. */
export type SlotKind = 'number' | 'string' | 'text' | 'state' | 'flag' | 'count' | 'numbers' | 'strings' | 'texts' | 'states'
/** A data name the widget reads. snap: sent snapped (states, flags, counts, strings, numbers shown as text); else
 * eased (numbers that drive geometry). sample: what the preview sends until M3 binds it. labels: labels alone read it, so a
 * rename is any name their binding reads back whole (paint.ts readsBack), not only letters, digits and _.
 * runtime: uid-owned, no binding or rename; samples still drive editor previews. */
export type Slot = { slot: string; key: string; kind: SlotKind; snap: boolean; sample: Json; labels?: true; runtime?: true }
/** A click target and the step M3 suggests for it: 'toggle', 'set(2)', 'page(p2)', 'step(-1,0,10)', 'cycle', 'id:i', ''. */
export type Click = { id: string; step: string }
/** A ScriptedScreens element beside the vector one (Q10). box: design units; fontSize: design units, scaled with the box. */
export type NativeEl = { type: 'icon' | 'textinput'; box: Box; props: Record<string, string | number>; style: Record<string, string>; fontSize?: number }
export type Expansion = { nodes: SrcNode[]; parts?: Record<string, number[]>; notes?: string[]; dormant?: string[]; dormantReasons?: Record<string, string>; defs?: SrcNode[]; slots: Slot[]; clicks?: Click[]; natives?: NativeEl[] }
/** What an insert knows: the project's pages, the hosting page, its design size. */
export type Ctx = { pages: { id: string; name: string }[]; page: string; size: { w: number; h: number } }

export interface WidgetModule<P extends Params = Params> {
  type: string; label: string; group: 'chrome' | 'values' | 'controls' | 'icons'
  prefix: string                          // the uid is prefix + the smallest free number: bar1
  resize: 'both' | 'width' | 'none'       // which canvas handles it gets
  native?: true                           // lives in Page.natives, not in src (Q10)
  params: Param[]                         // x y w h first, always
  defaults(t: Theme, ctx: Ctx): P
  fix?(p: P, t: Theme): P                 // derived params (a height that follows rows), after every change
  migrate?(raw: Record<string, unknown>, p: P, t: Theme): P // validated legacy params omitted by new instances
  // The slots an item of list param `list` owns, so a Remove takes their renames with the item (kvtable's rows).
  itemSlots?(list: string, item: Params): string[]
  expand(p: P, t: Theme, uid: string): Expansion   // pure; never throws on sanitized params
}
/** A widget instance: what its marker records. */
export type PartEdit = { attrs?: Record<string, Value | null>; dx?: number; dy?: number; dw?: number; dh?: number }
export type WidgetEdit = { v: 1; parts: Record<string, PartEdit>; root?: { v?: number; o?: number; r?: number; a?: [number, number] } }
export type WidgetRef = { type: string; uid: string; params: Params; edit?: WidgetEdit }
/** A game element on the page, optionally seated in an ordinary group's id. False flags are omitted. */
export type NativeRef = WidgetRef & { group?: string; hidden?: true; lock?: true }
