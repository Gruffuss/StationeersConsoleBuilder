// What an exported script needs in the game, in load order: each mod's name as it calls itself (its About.xml) and where
// to get it. The export header and the README list exactly these.
import { VECTOR_FLOOR } from '../model/project'

export interface Requirement {
  name: string
  url: string
  /** The major version needed, said after the name (BepInEx 5.x). */
  version?: string
  /** The oldest version an export runs on (the vector mod: the pin, spec D15). */
  floor?: string
  /** Needed only when the screen uses a face other than the game's own, or declares a web font. */
  fonts?: true
}

export const REQUIREMENTS: readonly Requirement[] = [
  { name: 'BepInEx', version: '5.x', url: 'https://github.com/BepInEx/BepInEx' },
  { name: 'StationeersLaunchPad', url: 'https://github.com/StationeersLaunchPad/StationeersLaunchPad' },
  { name: 'IC10 Editor', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3592775931' },
  { name: 'StationeersLua', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3659911735' },
  { name: 'ScriptedScreens', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3666779631' },
  { name: 'ScriptedScreens Vector', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3787517570', floor: VECTOR_FLOOR },
  { name: 'ScriptedScreens Fonts', url: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3803224901', fonts: true },
]

/**
 * The header's Requires line, then one comment line per needed mod with its link. `faces` is null when the Fonts mod is
 * not needed, else the faces it must supply (empty when only a web font is declared).
 */
export function requiresLines(faces: readonly string[] | null): string[] {
  const needed = REQUIREMENTS.filter(r => !r.fonts || faces !== null)
  const names = needed.map(r => r.name + (r.version ? ` ${r.version}` : '') + (r.floor ? ` ${r.floor} or newer` : '') + (r.fonts && faces?.length ? ` (${faces.join(', ')})` : ''))
  const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names.at(-1) : names[0]
  return [`-- Requires ${list}.`, ...needed.map(r => `--   ${r.name}: ${r.url}`)]
}
