// Every tool and command: the default export of each file in tools/ and commands/ (one entry or a list), collected at
// load, so registering one is creating its file (ruling R1; M2b's widget registry does the same). Tests sit beside them
// and are left out.
import type { Command, Ctx, Entry, Tool } from './types'
import { namedCommands } from './commands/style'

// The shell maps registry sections and unsectioned commands into its six menus.
const SECTIONS: readonly NonNullable<Command['menu']>[] = ['edit', 'arrange', 'align', 'style']

/** Tools sorted by order, commands by menu then order; an id used twice throws (a tool and a command may not share one). */
export function collect(found: readonly (Entry | readonly Entry[])[]) {
  const all = found.flat(), ids = new Set<string>()
  for (const e of all) {
    if (ids.has(e.id)) throw new Error(`editing: two entries share the id "${e.id}"`)
    ids.add(e.id)
  }
  const menu = (c: Command) => c.menu ? SECTIONS.indexOf(c.menu) : SECTIONS.length
  return {
    tools: all.filter((e): e is Tool => e.kind === 'tool').sort((a, b) => a.order - b.order),
    commands: all.filter((e): e is Command => e.kind === 'command').sort((a, b) => menu(a) - menu(b) || (a.order ?? 0) - (b.order ?? 0)),
  }
}

const found = import.meta.glob<Entry | Entry[]>(['./tools/*.{ts,tsx}', './commands/*.{ts,tsx}', '!./tools/*.test.{ts,tsx}',
  '!./commands/*.test.{ts,tsx}'], { eager: true, import: 'default' })
const { tools, commands } = collect(Object.values(found))
export const TOOLS: readonly Tool[] = tools
export const COMMANDS: readonly Command[] = commands
/** Theme styles are read when the menu or a key asks for its commands. */
export const commandsOf = (ctx: Ctx): readonly Command[] => collect([COMMANDS, namedCommands(ctx)]).commands

/** A key event's name: 'Mod+Alt+Shift+<key>', in that order (Mod = Ctrl or Cmd). The key: a letter as typed, upper-cased
 *  (layout-true), or from e.code when Alt changed it (macOS); [ and ] from e.code (Shift changes e.key); Space; else e.key. */
export function keyName(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : null
  const key = letter ?? (e.code === 'BracketLeft' ? '[' : e.code === 'BracketRight' ? ']' : e.key === ' ' ? 'Space' : e.key)
  return [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+')
}

/** The first command bound to `key` whose `when` holds. */
export const commandFor = (key: string, ctx: Ctx) => commandsOf(ctx).find(c => c.keys?.includes(key) && c.when(ctx))

/** Runs a command from a key or a menu, alike: the status line is cleared first (Ctx.note: cleared by the next command),
 *  and a render is asked for after, since a command may change what the menu offers without a store change (Copy fills
 *  the clipboard Paste reads). One that throws or rejects says so on the status line (and in the console): a bug in one
 *  command never looks like a dead key, and never escapes the key handler that took the key. Settles when it has. */
export function runCommand(c: Command, ctx: Ctx, arg?: string): Promise<unknown> {
  const failed = (e: unknown) => {
    console.error(e)
    ctx.note(`${c.label} failed: ${e instanceof Error ? e.message : String(e)}`)
  }
  ctx.note('')
  let done: Promise<unknown>
  try {
    done = Promise.resolve(c.run(ctx, arg)).catch(failed)
  } catch (e) {
    failed(e)
    done = Promise.resolve()
  }
  ctx.redraw()
  return done
}
