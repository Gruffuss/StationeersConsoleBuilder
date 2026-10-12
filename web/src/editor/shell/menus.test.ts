// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { node } from '../../model/testing'
import { COMMANDS, commandsOf } from '../../editing/registry'
import { harness } from '../../editing/testing'
import { menusOf, runFromMenu, type MenuActions, type MenuItem } from './menus'
import { existsSync, readFileSync as readSource } from 'node:fs'

it('has no legacy EditBar and sends point guidance to the Edit menu', () => {
  expect(existsSync('src/editing/EditBar.tsx')).toBe(false)
  expect(readSource('src/editing/registry.ts', 'utf8')).not.toContain('export const MENUS')
  expect(readSource('src/editing/tools/points.tsx', 'utf8')).toContain('Edit menu › Add point')
})

const scene = { header: { w: 460, h: 460 }, defs: [], root: [node('R', { x: 0, w: 10, h: 10 }), node('R', { x: 50, w: 10, h: 10 })] }
const actions = (): MenuActions => ({
  project: { name: 'Test', newFromTemplate: vi.fn(), openFile: vi.fn(), openText: vi.fn(), saveJson: vi.fn(), shareLink: vi.fn(), fonts: vi.fn(), exportScript: vi.fn(), adoptionReport: null },
  view: { navigable: true, fit: vi.fn(), actual: vi.fn(), fitSelection: vi.fn(), pan: vi.fn(), source: true, setSource: vi.fn(), play: false, setPlay: vi.fn() },
  help: { shortcuts: vi.fn(), openExample: vi.fn(), scripts: false, setScripts: vi.fn(), compare: false, setCompare: vi.fn() },
})
const flat = (items: MenuItem[]): Extract<MenuItem, { kind: 'item' }>[] => items.flatMap(i => i.kind === 'submenu' ? flat(i.items) : i.kind === 'item' ? [i] : [])

it('places every registry command except nudges exactly once, in the specified order', () => {
  const h = harness(scene), menus = menusOf(h.ctx, '7', actions()), all = menus.flatMap(m => flat(m.items))
  expect(menus.map(m => m.label)).toEqual(['Project', 'Edit', 'Object', 'Style', 'View', 'Help'])
  for (const c of commandsOf(h.ctx).filter(c => !c.id.startsWith('nudge.'))) {
    const items = all.filter(i => i.id === c.id)
    expect(items, c.id).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: c.label, disabled: !c.when(h.ctx) })
  }
  expect(flat(menus[1].items).map(i => i.id)).toEqual(['undo', 'redo', 'cut', 'copy', 'paste', 'duplicate', 'delete', 'selectAll', 'select.enter', 'select.leave', 'select.parent', 'tool.leave', 'point-add', 'point-delete', 'point-corner', 'point-smooth'])
  expect(flat(menus[2].items).map(i => i.id)).toEqual(['group', 'ungroup', 'forward', 'backward', 'front', 'back', 'hide', 'showAll', 'lock', 'unlockAll', 'align.left', 'align.centre', 'align.right', 'align.top', 'align.middle', 'align.bottom', 'distribute.x', 'distribute.y', 'gap.x', 'gap.y'])
  expect(flat(menus[3].items).slice(0, 5).map(i => i.id)).toEqual(['style.copy', 'style.paste', 'style.detach', 'style.useAsDefault', 'style.resetDefaults'])
  const named = menus[3].items.find(i => i.kind === 'submenu')!
  expect(named.kind === 'submenu' && named.count).toBe(commandsOf(h.ctx).filter(c => c.id.startsWith('style.') && !COMMANDS.includes(c)).length)
  expect(named.kind === 'submenu' && named.items.filter(i => i.kind === 'group').map(i => i.label)).toEqual(['Text', 'Part', 'Status', 'Glow'])
})

it('appends future registry commands to their section without dropping or duplicating them', () => {
  const h = harness(scene), extra = { ...COMMANDS[0], id: 'future', menu: 'align' as const }
  const list = COMMANDS as typeof extra[]
  list.push(extra)
  try { expect(menusOf(h.ctx, '7', actions()).filter(m => flat(m.items).some(i => i.id === 'future')).map(m => m.id)).toEqual(['object']) }
  finally { list.pop() }
})

it('runs Gap across with the status bar value and clears the note before commands', async () => {
  const h = harness(scene, { sel: { pageId: 'p1', path: [1] }, also: [{ pageId: 'p1', path: [0] }] })
  h.ctx.note('old note')
  flat(menusOf(h.ctx, '7', actions())[2].items).find(i => i.id === 'gap.x')!.run()
  await h.settle()
  expect(h.root()[1].attrs.x).toBe(17)
  expect(h.status()).toBe('')
  expect(h.state().past).toHaveLength(1)
})

it('keeps project callbacks, conditional adoption, navigation, toggles and developer flags', () => {
  const h = harness(scene), a = actions()
  let menus = menusOf(h.ctx, '10', a)
  expect(menus[0].items[0]).toEqual({ kind: 'group', label: 'Project · Test' })
  expect(flat(menus[0].items).map(i => i.label)).toEqual(['New from template…', 'Open file…', 'Open from text…', 'Save JSON', 'Share link…', 'Fonts…', 'Export…'])
  flat(menus[0].items)[0].run(); expect(a.project.newFromTemplate).toHaveBeenCalledOnce()
  a.project.name = ''; a.project.adoptionReport = vi.fn(); a.view.navigable = false; a.view.fitSelection = null
  menus = menusOf(h.ctx, '10', a)
  expect(menus[0].items[0]).toMatchObject({ label: 'Project · Untitled' })
  flat(menus[0].items).find(i => i.label === 'Adoption report…')!.run()
  expect(a.project.adoptionReport).toHaveBeenCalledOnce()
  const view = flat(menus[4].items)
  expect(view.slice(0, 7).every(i => i.disabled)).toBe(true)
  view.find(i => i.label === 'Pan left')!.run(); expect(a.view.pan).toHaveBeenCalledWith(-40, 0)
  view.find(i => i.label === 'Source pane')!.run(); expect(a.view.setSource).toHaveBeenCalledWith(false)
  view.find(i => i.label === 'Play')!.run(); expect(a.view.setPlay).toHaveBeenCalledWith(true)
  const help = flat(menus[5].items)
  expect(help.slice(1).every(i => i.dev)).toBe(true)
  expect(help.find(i => i.label === 'Compare capture')!.disabled).toBe(true)
  help.find(i => i.label === 'Example scripts')!.run(); expect(a.help.setScripts).toHaveBeenCalledWith(true)
  expect(menus[5].items.find(i => i.kind === 'group')).toMatchObject({ label: 'Developer', dev: true })
})

it('asks a command its argument, and runs nothing on Cancel', () => {
  const h = harness(scene), got: (string | undefined)[] = []
  const c = { ...COMMANDS[0], ask: { label: 'Gap', value: '10' }, run: (_: unknown, arg?: string) => { got.push(arg) } }
  runFromMenu(c, h.ctx, () => '12')
  runFromMenu(c, h.ctx, () => null)
  expect(got).toEqual(['12'])
})

it('says in a note, and runs nothing, where prompt() throws or is missing', () => {
  const h = harness(scene), got: (string | undefined)[] = []
  const c = { ...COMMANDS[0], label: 'Gap across...', ask: { label: 'Gap', value: '10' }, run: (_: unknown, arg?: string) => { got.push(arg) } }
  expect(() => runFromMenu(c, h.ctx, () => { throw new Error('prompt() is not supported.') })).not.toThrow()
  const prompt = window.prompt
  try {
    (window as { prompt?: unknown }).prompt = undefined
    expect(() => runFromMenu(c, h.ctx)).not.toThrow()
  } finally { window.prompt = prompt }
  expect(got).toEqual([])
  expect(h.notes).toEqual(Array(2).fill('Gap across... needs a value, and this page cannot ask for one here (no prompt())'))
})
import { readFileSync } from 'node:fs'
it('owns the menu runner without depending on the retired editing bar', () => {
  expect(readFileSync('src/editor/shell/menus.ts', 'utf8')).not.toContain("from '../../editing/EditBar'")
})
