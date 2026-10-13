// The starters' names and descriptions; their projects load on demand (templateData.ts).
export type TemplateId = 'overview' | 'atmos-tanks' | 'power' | 'airlock' | 'solar' | 'blank' | 'needle-gauge' | 'power-wall-3x2' | 'power-wall-2x3' | 'hydro-farm'
export const TEMPLATES: readonly { id: TemplateId; name: string; description: string }[] = [
  { id: 'overview', name: 'Overview', description: 'Weighted battery charge and room temperature.' },
  { id: 'atmos-tanks', name: 'Atmos/tanks', description: 'Read-only tank pressure and temperature, with pressure history in Data.' },
  { id: 'power', name: 'Power', description: 'Battery-based generator control with Auto, On and Off overrides.' },
  { id: 'airlock', name: 'Airlock', description: 'Opens one door at a time: the other must read shut and settled first. Holds both doors in Logic mode and unlocked; the button on a door asks for it; boot leaves the doors as they are. No automatic pressure cycle.' },
  { id: 'solar', name: 'Solar', description: 'Read-only solar output and maximum readings: raw values, units unverified. No tracking.' },
  { id: 'blank', name: 'Blank', description: 'An empty square console project.' },
  { id: 'needle-gauge', name: 'Needle gauge', description: 'Read-only pressure dial built from plain shapes. Values above 100 kPa clamp the needle; missing readings hide it.' },
  { id: 'power-wall-3x2', name: 'Power wall (3×2)', description: "A station power wall for a 3×2 console: battery storage, what is made and used now and yesterday, solar panels by type with tracking and Park, solid fuel generators with Auto, On and Off, the sun and the coal reserve." },
  { id: 'power-wall-2x3', name: 'Power wall (2×3)', description: 'The same power wall laid out for a vertical 3×2 console (two wide, three tall): the same devices, logic and controls.' },
  { id: 'hydro-farm', name: 'Hydro farm (3×2)', description: 'A hydroponics farm for a 3×2 console: runs the LArRE harvester along the trays, the grow-light day and the export bin door, with a plant picker and a settings page.' },
]
/** The starters' projects, a chunk of their own that the New dialog loads when it first opens (owner, 2026-10-13: "Load the
 *  templates only when the New dialog opens"). */
export type TemplateData = typeof import('./templateData')
export const loadTemplates = (): Promise<TemplateData> => import('./templateData')
