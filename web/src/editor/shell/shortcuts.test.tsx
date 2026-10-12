// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { COMMANDS, commandsOf, TOOLS } from '../../editing/registry'
import { harness } from '../../editing/testing'
import { mount } from '../../testing'
import { keysLabel } from './keyLabels'
import { shortcutSections } from './shortcuts'
import { ShortcutsTable } from './ShortcutsTable'

it('lists every keyed tool and command, including nudges and alternate keys', () => {
  const sections = shortcutSections(), rows = sections.flatMap(s => s.rows)
  expect(sections.map(s => s.title)).toEqual(['Tools', 'Escape, Enter, nudge', 'View', 'Select tool', 'Resize and rotate handles', 'Gradient tool', 'Points tool', 'Rectangle, ellipse, text, image', 'Line, polygon, path', 'Pen tool', 'Commands', 'Layers', 'Pages'])
  expect(sections[0].note).toContain('Ctrl is Cmd on a Mac.')
  for (const t of TOOLS.filter(t => t.key)) expect(rows).toContainEqual({ what: t.label, keys: keysLabel([t.key!]) })
  for (const c of COMMANDS.filter(c => c.keys?.length)) expect(rows, c.id).toContainEqual({ what: c.label, keys: keysLabel(c.keys) })
})

it('reads keys from the current registry, including commands supplied by a context', () => {
  const h = harness({ header: { w: 460, h: 460 }, defs: [], root: [] })
  for (const c of commandsOf(h.ctx).filter(c => c.keys?.length)) {
    expect(shortcutSections(h.ctx).flatMap(s => s.rows)).toContainEqual({ what: c.label, keys: keysLabel(c.keys) })
  }
  const c = COMMANDS.find(c => c.id === 'undo')!, keys = c.keys
  try {
    c.keys = ['Mod+Alt+U', 'Mod+Shift+U']
    expect(shortcutSections().flatMap(s => s.rows)).toContainEqual({ what: c.label, keys: 'Ctrl+Alt+U · Ctrl+Shift+U' })
  } finally { c.keys = keys }
})

it('describes the layer range, toggle and keyboard gestures implemented by the tree', () => {
  const rows = shortcutSections().find(s => s.title === 'Layers')!.rows
  expect(rows).toContainEqual({ what: 'Select a range of sibling rows', keys: 'Shift+click' })
  expect(rows).toContainEqual({ what: 'Add or remove a selected row', keys: 'Ctrl+click' })
  expect(rows).toContainEqual({ what: 'Select the focused row; Enter enters an enterable group', keys: 'Space · Enter' })
  expect(rows).toContainEqual({ what: 'Enter a group or widget', keys: 'Double-click' })
})

it('renders titled sections, actions, notes and one kbd per alternate key', () => {
  const sections = shortcutSections(), ui = mount(<ShortcutsTable sections={sections} />)
  const nodes = Array.from(ui.container.querySelectorAll('section'))
  expect(nodes).toHaveLength(sections.length)
  nodes.forEach((node, k) => {
    expect(node.getAttribute('aria-label')).toBe(sections[k].title)
    expect(node.querySelector('h3')!.textContent).toBe(sections[k].title)
    expect(Array.from(node.querySelectorAll('dt')).map(dt => dt.textContent)).toEqual(sections[k].rows.map(r => r.what))
    expect(Array.from(node.querySelectorAll('dd')).map(dd => Array.from(dd.querySelectorAll('kbd')).map(kbd => kbd.textContent))).toEqual(sections[k].rows.map(r => r.keys.split(' · ')))
  })
  expect(ui.container.textContent).toContain(sections[0].note)
  ui.unmount()
})
