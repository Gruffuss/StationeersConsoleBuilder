import type { Project } from '../model/project'
import { gasOf, icons } from '../catalog'
import type { StyleName, Theme } from './types'
import { neutral } from './neutral'
import { vanillaPlus } from './vanillaPlus'

export type { Theme } from './types'
export { faceOf } from './vanillaPlus'
export const gasColours: Record<string, string> = Object.fromEntries(Object.keys(icons.gas).flatMap(name => {
  const gas = gasOf(name)
  if (!gas) return []
  const { fill, ink } = gas
  return [[`gas.${name}`, Array.isArray(fill) ? fill[0] : fill], [`gas.${name}.ink`, ink],
    ...Array.isArray(fill) ? [[`gas.${name}.2`, fill[1]]] : []]
}))
export const THEMES: Record<string, Theme> = Object.fromEntries(Object.entries({ neutral, 'vanilla-plus': vanillaPlus })
  .map(([id, t]) => [id, { ...t, colors: { ...t.colors, ...gasColours } }]))
export const DEFAULT_THEME = 'neutral'
/** Required UI colour roles for every theme. */
export const ROLES: string[] = [
  'surface-screen-hi', 'surface-screen', 'surface-screen-lo', 'surface-panel', 'surface-row-hi', 'surface-row', 'surface-row-lo',
  'surface-well', 'border', 'border-strong', 'text', 'text-secondary', 'text-muted', 'accent', 'brand-hi', 'brand', 'brand-lo',
  'on-brand', 'status-ok', 'status-warn', 'status-crit', 'status-idle', 'on-status', 'danger', 'danger-lo', 'on-danger',
]
/** The type styles, as Vanilla + names them. */
export const STYLES = Object.keys(vanillaPlus.type) as StyleName[]

export function colour(t: Theme, role: string): string {
  const colors = Object.hasOwn(gasColours, role) ? gasColours : t.colors
  if (!Object.hasOwn(colors, role)) throw new Error(`the theme "${t.name}" has no colour "${role}"`)
  return colors[role]
}

/** Legacy M1 colour explicitly assigned by the vector examples; not an absent page background or a game default. */
export const M1_GROUND = '#0A121C'
/** A page's ground: its top and bottom colours. */
export const groundOf = (t: Theme): [string, string] => [colour(t, 'surface-screen-hi'), colour(t, 'surface-screen-lo')]

/** A project's theme; one this build does not know uses the default. */
export const themeOf = (p: Project): Theme => Object.hasOwn(THEMES, p.theme) ? THEMES[p.theme]
  : Object.hasOwn(p, 'themes') && p.themes && Object.hasOwn(p.themes, p.theme) ? p.themes[p.theme] : THEMES[DEFAULT_THEME]

export function themesOf(p: Project): Theme[] {
  return [...Object.values(THEMES), ...(Object.hasOwn(p, 'themes') && p.themes ? Object.keys(p.themes)
    .filter(id => !Object.hasOwn(THEMES, id)).map(id => p.themes![id]) : [])]
}
