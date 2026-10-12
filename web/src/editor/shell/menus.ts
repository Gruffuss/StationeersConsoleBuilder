import { commandsOf, runCommand } from '../../editing/registry'
import { namedCommands } from '../../editing/commands/style'
import type { Command, Ctx } from '../../editing/types'
import { keysLabel } from './keyLabels'

export function runFromMenu(c: Command, ctx: Ctx, ask: (label: string, value: string) => string | null = (l, v) => window.prompt(l, v), value?: string) {
  let arg: string | null | undefined
  try { arg = c.ask ? ask(c.ask.label, c.ask.value) : value }
  catch { return ctx.note(`${c.label} needs a value, and this page cannot ask for one here (no prompt())`) }
  if (arg === null) return
  runCommand(c, ctx, arg)
}

export type MenuItem =
  | { kind: 'item'; id: string; label: string; keys?: string; disabled?: boolean; checked?: boolean; note?: string; dev?: boolean; run: () => void }
  | { kind: 'group'; label: string; dev?: boolean }
  | { kind: 'separator' }
  | { kind: 'note'; text: string }
  | { kind: 'submenu'; id: string; label: string; count?: number; disabled?: boolean; items: MenuItem[] }
export type Menu = { id: 'project' | 'edit' | 'object' | 'style' | 'view' | 'help'; label: string; items: MenuItem[] }
export type MenuActions = {
  project: { name: string; newFromTemplate(): void; openFile(): void; openText(): void; saveJson(): void; shareLink(): void
    fonts(): void; exportScript(): void; adoptionReport: (() => void) | null }
  view: { navigable: boolean; fit(): void; actual(): void; fitSelection: (() => void) | null; pan(dx: number, dy: number): void
    source: boolean; setSource(v: boolean): void; play: boolean; setPlay(v: boolean): void }
  help: { shortcuts(): void; openExample(): void; scripts: boolean; setScripts(v: boolean): void; compare: boolean; setCompare(v: boolean): void }
}

export function menusOf(ctx: Ctx, gap: string, a: MenuActions): Menu[] {
  const commands = commandsOf(ctx), placed = new Set<string>()
  const command = (c: Command): MenuItem => {
    placed.add(c.id)
    return { kind: 'item', id: c.id, label: c.label, keys: keysLabel(c.keys), disabled: !c.when(ctx),
      run: () => runFromMenu(c, ctx, undefined, c.id === 'gap.x' || c.id === 'gap.y' ? gap : undefined) }
  }
  const cmd = (...ids: string[]) => ids.flatMap(id => {
    const c = commands.find(c => c.id === id)
    return c ? [command(c)] : []
  })
  const item = (id: string, label: string, run: () => void, extra: Partial<Extract<MenuItem, { kind: 'item' }>> = {}): MenuItem => ({ kind: 'item', id, label, run, ...extra })
  const group = (label: string): MenuItem => ({ kind: 'group', label })
  const note = (text: string): MenuItem => ({ kind: 'note', text })
  const sep: MenuItem = { kind: 'separator' }, p = a.project, v = a.view, h = a.help
  const named = namedCommands(ctx), namedItems: MenuItem[] = [], groups = new Set(named.map(c => c.label.split(':')[0]))
  for (const label of groups) {
    namedItems.push(group(label), ...named.filter(c => c.label.split(':')[0] === label).map(command))
  }
  const nav = { disabled: !v.navigable }
  const menus: Menu[] = [
    { id: 'project', label: 'Project', items: [
      group(`Project · ${p.name || 'Untitled'}`), item('project.new', 'New from template…', p.newFromTemplate), item('project.file', 'Open file…', p.openFile),
      item('project.text', 'Open from text…', p.openText), item('project.save', 'Save JSON', p.saveJson), item('project.share', 'Share link…', p.shareLink), sep,
      item('project.fonts', 'Fonts…', p.fonts, { note: 'also in the header' }), item('project.export', 'Export…', p.exportScript, { note: 'also in the header' }),
      ...(p.adoptionReport ? [item('project.adoption', 'Adoption report…', p.adoptionReport)] : []),
    ] },
    { id: 'edit', label: 'Edit', items: [
      ...cmd('undo', 'redo'), sep, ...cmd('cut', 'copy', 'paste', 'duplicate', 'delete'), sep,
      ...cmd('selectAll', 'select.enter', 'select.leave', 'select.parent', 'tool.leave'), group('Points tool'), ...cmd('point-add', 'point-delete', 'point-corner', 'point-smooth'),
      note('These need the Points tool with a point or segment chosen. Corner and Smooth need an anchor of a pen path.'),
      note('Alt+Shift+S is Smooth; Alt+S is Align bottom.'),
    ] },
    { id: 'object', label: 'Object', items: [
      ...cmd('group', 'ungroup'), note('A widget comes apart through Detach, not Ungroup.'), group('Arrange'), ...cmd('forward', 'backward', 'front', 'back'), sep,
      ...cmd('hide', 'showAll', 'lock', 'unlockAll'), group('Align: one object to the page, several to their union'),
      ...cmd('align.left', 'align.centre', 'align.right', 'align.top', 'align.middle', 'align.bottom'), group('Spacing'), ...cmd('distribute.x', 'distribute.y'),
      note('Distribute needs 3 or more selected.'), ...cmd('gap.x', 'gap.y'), note('Gap needs 2 or more selected and uses the Gap value in the status bar.'),
    ] },
    { id: 'style', label: 'Style', items: [
      ...cmd('style.copy', 'style.paste', 'style.detach'), group('Draw defaults'), ...cmd('style.useAsDefault', 'style.resetDefaults'),
      { kind: 'submenu', id: 'style.named', label: 'Named style', count: named.length, items: namedItems },
      note("One click applies the theme's style and links it, so a theme switch restyles it."),
    ] },
    { id: 'view', label: 'View', items: [
      item('view.fit', 'Fit', v.fit, nav), item('view.actual', '100 %', v.actual, nav), item('view.selection', 'Fit selection', () => v.fitSelection?.(), { disabled: !v.navigable || !v.fitSelection }),
      group('Pan 40 px'), item('view.left', 'Pan left', () => v.pan(-40, 0), nav), item('view.right', 'Pan right', () => v.pan(40, 0), nav),
      item('view.up', 'Pan up', () => v.pan(0, -40), nav), item('view.down', 'Pan down', () => v.pan(0, 40), nav), sep,
      item('view.source', 'Source pane', () => v.setSource(!v.source), { checked: v.source }), item('view.play', 'Play', () => v.setPlay(!v.play), { checked: v.play, note: 'also in the header' }),
      note('Space-drag, middle-drag or the wheel also pan; Ctrl+wheel zooms at the pointer.'),
    ] },
    { id: 'help', label: 'Help', items: [
      item('help.shortcuts', 'Keyboard shortcuts', h.shortcuts), { kind: 'group', label: 'Developer', dev: true }, item('help.example', 'Open example…', h.openExample, { dev: true }),
      item('help.scripts', 'Example scripts', () => h.setScripts(!h.scripts), { checked: h.scripts, dev: true }),
      item('help.compare', 'Compare capture', () => h.setCompare(!h.compare), { checked: h.compare, dev: true, disabled: !h.scripts }),
    ] },
  ]
  for (const c of commands) {
    if (placed.has(c.id) || c.id.startsWith('nudge.')) continue
    const id = c.menu === 'style' ? 'style' : c.menu === 'arrange' || c.menu === 'align' ? 'object' : 'edit'
    menus.find(m => m.id === id)!.items.push(command(c))
  }
  return menus
}
