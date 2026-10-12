// Every widget module: each file in modules/ exports its module as default, so a new widget registers itself. Tests live
// beside this file, never in modules/, or the glob would load them.
import type { WidgetModule } from './types'

const found = import.meta.glob<WidgetModule<any>>('./modules/*.ts', { eager: true, import: 'default' })
/** By type. A null prototype: a marker naming `constructor` finds nothing. */
export const WIDGETS: Record<string, WidgetModule<any>> =
  Object.assign(Object.create(null), Object.fromEntries(Object.values(found).map(m => [m.type, m])))
