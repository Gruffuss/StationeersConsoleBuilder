// A console project: its pages, each one surface holding one vector scene.
import { DEFAULT_THEME, groundOf, THEMES, themeOf } from '../theme'
import type { Json, WidgetRef } from '../widgets/types'
import { newLogic, type Logic } from './logic'
import type { Scene } from './scene'
import type { ShapeKind } from './shapes'
import type { Theme } from '../theme/types'

/** The vector mod an export targets: the pin, which is the newest tag (spec D15). Nothing is gated per feature below it. */
export const VECTOR_FLOOR = '0.11.118'

// background: one or two #rrggbb[aa] colours, top to bottom; undefined declares no background panel.
// preview: the player's preview values, data name → value, which the shell's data element sends over the widgets' samples.
// natives: the page's native widgets (Q10: ScriptedScreens elements, not vector nodes), declared by the shell after the scene.
export interface Page {
  id: string; name: string; surface: string; shape: ShapeKind; size: { w: number; h: number }; background?: string[]; scene: Scene
  preview?: Record<string, Json>; natives?: WidgetRef[]
}
/** `theme`: a theme's key in THEMES; themeOf reads one this build does not know as the default. */
export interface Project extends Logic { version: 1; name: string; target: { vectorMod: typeof VECTOR_FLOOR }; theme: string; pages: Page[]; themes?: Record<string, Theme> }

// A square page: 460 px in the preview, 480 design units (spec 5.4), on its theme's ground.
const blank = (): Scene => ({ header: { w: 480, h: 480, fit: 'contain' }, defs: [], root: [] })

export function newProject(): Project {
  return { version: 1, name: 'Untitled', target: { vectorMod: VECTOR_FLOOR }, theme: DEFAULT_THEME,
    pages: [{ id: 'p1', name: 'Main', surface: 'main', shape: 'square', size: { w: 460, h: 460 }, background: groundOf(THEMES[DEFAULT_THEME]), scene: blank() }],
    ...newLogic() }
}

/** A blank page with the first n >= 2 whose id `pn` and surface `pagen` are both free. Not added to `p`. */
export function newPage(p: Project): Page {
  let n = 2
  while (p.pages.some(x => x.id === `p${n}` || x.surface === `page${n}`)) n++
  return { id: `p${n}`, name: `Page ${n}`, surface: `page${n}`, shape: 'square', size: { w: 460, h: 460 }, background: groundOf(themeOf(p)), scene: blank() }
}
