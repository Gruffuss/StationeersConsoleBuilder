// The starters' projects: every templates/*.json, bundled here and nowhere else, so the app loads them only when the New
// dialog opens (templates.ts loadTemplates). templateProject opens one as a fresh project in a theme.
import type { Project } from '../model/project'
import { initialState, reducer } from '../model/store'
import { pack, unpack } from '../srctext/wire'
import { DEFAULT_THEME, THEMES, type Theme } from '../theme'
import { TEMPLATES, type TemplateId } from './templates'

const projects = import.meta.glob('../../../templates/*.json', { eager: true, import: 'default' }) as Record<string, Project>

export function templateProject(id: TemplateId, theme: Project['theme'] | Theme = DEFAULT_THEME): Project {
  if (!TEMPLATES.some(t => t.id === id) || !Object.hasOwn(projects, `../../../templates/${id}.json`)) throw new Error(`unknown template: ${id}`)
  if (typeof theme === 'string' && !Object.hasOwn(THEMES, theme)) throw new Error(`unsupported template theme: ${theme}`)
  const p = unpack(pack(projects[`../../../templates/${id}.json`])) as Project
  return reducer(initialState(p), typeof theme === 'string' || Object.hasOwn(THEMES, theme.id)
    ? { type: 'setTheme', theme: typeof theme === 'string' ? theme : theme.id } : { type: 'addTheme', theme }).project
}
