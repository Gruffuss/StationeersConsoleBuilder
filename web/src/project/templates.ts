import type { Project } from '../model/project'
import { initialState, reducer } from '../model/store'
import { pack, unpack } from '../srctext/wire'
import { DEFAULT_THEME, THEMES, type Theme } from '../theme'
export type TemplateId = 'overview' | 'atmos-tanks' | 'power' | 'airlock' | 'solar' | 'blank' | 'needle-gauge'
export const TEMPLATES: readonly { id: TemplateId; name: string; description: string }[] = [
  { id: 'overview', name: 'Overview', description: 'Weighted battery charge and room temperature.' },
  { id: 'atmos-tanks', name: 'Atmos/tanks', description: 'Read-only tank pressure and temperature, with pressure history in Data.' },
  { id: 'power', name: 'Power', description: 'Battery-based generator control with Auto, On and Off overrides.' },
  { id: 'airlock', name: 'Airlock', description: 'Opens one door at a time: the other must read shut and settled first. Holds both doors in Logic mode and unlocked; the button on a door asks for it; boot leaves the doors as they are. No automatic pressure cycle.' },
  { id: 'solar', name: 'Solar', description: 'Read-only solar output and maximum readings: raw values, units unverified. No tracking.' },
  { id: 'blank', name: 'Blank', description: 'An empty square console project.' },
  { id: 'needle-gauge', name: 'Needle gauge', description: 'Read-only pressure dial built from plain shapes. Values above 100 kPa clamp the needle; missing readings hide it.' },
]
const projects = import.meta.glob('../../../templates/*.json', { eager: true, import: 'default' }) as Record<string, Project>

export function templateProject(id: TemplateId, theme: Project['theme'] | Theme = DEFAULT_THEME): Project {
  if (!TEMPLATES.some(t => t.id === id) || !Object.hasOwn(projects, `../../../templates/${id}.json`)) throw new Error(`unknown template: ${id}`)
  if (typeof theme === 'string' && !Object.hasOwn(THEMES, theme)) throw new Error(`unsupported template theme: ${theme}`)
  const p = unpack(pack(projects[`../../../templates/${id}.json`])) as Project
  return reducer(initialState(p), typeof theme === 'string' || Object.hasOwn(THEMES, theme.id)
    ? { type: 'setTheme', theme: typeof theme === 'string' ? theme : theme.id } : { type: 'addTheme', theme }).project
}
