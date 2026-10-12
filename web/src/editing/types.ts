// The editing layer's contract (spec §4 "Canvas editing"): a tool is pointer handling plus an overlay, a command is an
// action plus its shortcut and when it applies. Each is the default export of one file in tools/ or commands/ (one entry
// or a list), collected by registry.ts. Tools and commands reach the editor only through Ctx: never the reducer, the
// canvas or App.
import type { ReactNode } from 'react'
import type { Mat } from '../editor/geometry'
import type { Order } from '../model/numbering'
import type { Page } from '../model/project'
import type { Scene, Value } from '../model/scene'
import type { Action, Selection, State } from '../model/store'
import type { Frame } from '../runtime/frame'
import type { SceneChecker } from '../srctext/checker'
import type { Theme } from '../theme'

/** A point in design units (the page scene's root frame, SCENE w x h), unless a field says surface px. */
export type Pt = { x: number; y: number }
/** mod = Ctrl or Cmd: snapping off while held (in a marquee: enclose). shift: proportions, 45 or 15 degree steps, add to
 *  the selection. alt: from the centre. */
export type Mods = { shift: boolean; alt: boolean; mod: boolean }
/** One pointer report, converted by the router. */
export type Press = {
  at: Pt          // design units, unsnapped
  px: Pt          // surface px, for picking on the frame
  start: Pt       // design units of the press this pointer went down with
  css: number     // CSS px travelled since that press (0 for a hover move)
  mods: Mods
  clicks: number  // 2 on the second press of a double click (counted by the router: detail is 0 on pointerdown)
}
/** Per browser, not in the project, not undoable (ruling R9). grid: design units, 0 = off. */
export type Settings = { grid: number; snap: boolean }
/** The active page's conversions at the current zoom. */
export type View = {
  zoom: number                      // CSS px per surface px
  pan: Pt                           // CSS px offset of the overlay's origin in the visible area
  size: { w: number; h: number }    // the design size (SCENE w x h)
  unit: Mat                         // design units -> surface px (viewbox)
  toUnits(px: Pt): Pt               // surface px -> design units
  css(u: Pt): Pt                    // design units -> CSS px in the translated overlay
  world(path: number[]): Mat | null // the node's local units -> design units; null when an ancestor is not literal or singular
  threshold: number                 // 8 CSS px in design units: the snap distance
}
/** What a tool or command writes: the active page's next scene and, when it decides, the next selection (last = primary;
 *  [] = nothing; omitted = unchanged). */
export type Edit = { scene: Scene; selection?: Selection[] }
export type OverlayCtx = { zoom: number; frame: Frame | null; view: View }
/** Editor state that is not undoable: the copied nodes as src text, the page they came from and how often they were
 *  pasted there (pastes that landed), the page's scene each of those landed on (`at`: an undo back to one takes the count
 *  back with it), whether one sat inside a group (a paste lands at the top level); a copied style. */
export type Clip = { text: string | null; page: string; pasted: number; at: Scene[]; nested?: boolean
  style: { op: string; attrs: Record<string, Value>; links?: Record<string, import('../theme/links').StyleLink> } | null }

export interface Ctx {
  get(): State
  dispatch(a: Action): void
  page(): Page                       // the active page, latest
  theme(): Theme
  view(): View
  frame(): Frame | null              // the frame on the canvas (one frame late: picking only)
  /** Pure: keeps a selected member, else entered depth; innermost when deep. The caller applies enter intent. */
  pick(px: Pt, deep?: boolean): { target: Selection | null; enter?: Extract<Action, { type: 'enter' }> }
  /** The active page's numbering when it fits the page's scene; undefined after a structural edit until its check lands. */
  order(): Order | undefined
  settings(): Settings
  setSettings(s: Partial<Settings>): void
  drawDefaults(): import('./settings').DrawDefaults
  setDrawDefaults(s: import('./settings').DrawDefaults): boolean
  checker(): SceneChecker | null
  /** One undo step. check: checked off the main thread first (anything not valid by construction: paste, duplicate,
   *  group, ungroup, style paste), and dropped when the page changed meanwhile or the check failed; a scene too large to
   *  check here lands, its reason noted. Resolves to why it did not land (also said with note), or null. */
  apply(e: Edit, o?: { check?: boolean }): Promise<string | null>
  note(text: string): void           // one status line, cleared by the next press or command
  clip: Clip
  tool(): string
  setTool(id: string): void
  redraw(): void                     // render again: an overlay changed without a store change
}

/** One gesture of a tool: opened by a press, closed by a release (or, for a multi-click tool, by Enter or a double click). */
export interface Gesture {
  move(p: Press): void                     // every move while open: pressed, or hovering (a rubber band)
  up(p: Press): boolean                    // true: stay open for more clicks
  down?(p: Press): void                    // the next click of a multi-click gesture
  key?(key: string): boolean | 'done'      // a key name (Enter, Backspace); true: used; 'done': used and finished
  cancel(): void                           // Esc, a cancelled pointer, a tool switch: the scene before it
  overlay?(o: OverlayCtx): ReactNode       // guides, a marquee, a rubber band
}
export interface Tool {
  kind: 'tool'
  id: string; label: string; order: number
  key?: string                             // one key name: 'V', 'R', 'O'…
  cursor?: string                          // CSS cursor over the canvas while active
  handles?: boolean                        // the one selected node's handles are drawn while active (the tool hit-tests them)
  down(p: Press, ctx: Ctx): Gesture | null
  overlay?(ctx: Ctx, o: OverlayCtx): ReactNode   // while active (the select tool's set outlines)
}
export interface Command {
  kind: 'command'
  id: string; label: string
  menu?: 'edit' | 'arrange' | 'align' | 'style'   // section used by the shell's menu model
  order?: number
  keys?: string[]                          // key names: 'Mod+Shift+G', 'Alt+A', 'Shift+ArrowLeft', 'Delete'
  once?: boolean                           // a held key runs it once (a toggle, a nesting): its repeats are passed over
  ask?: { label: string; value: string }   // an argument the rough UI asks for with prompt()
  when(ctx: Ctx): boolean                  // gates the menu item and the key alike
  run(ctx: Ctx, arg?: string): void | Promise<unknown>
}
export type Entry = Tool | Command
