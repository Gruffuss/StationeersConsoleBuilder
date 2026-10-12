import { describe, expect, it } from 'vitest'
import { collect, COMMANDS, TOOLS } from './registry'
import type { Command, Tool } from './types'

describe('the registry', () => {
  it('keeps Smooth on a free chord and Align bottom on Alt+S', () => {
    expect(COMMANDS.find(c => c.id === 'point-smooth')!.keys).toEqual(['Alt+Shift+S'])
    expect(COMMANDS.filter(c => c.keys?.includes('Alt+Shift+S')).map(c => c.id)).toEqual(['point-smooth'])
    expect(COMMANDS.filter(c => c.keys?.includes('Alt+S')).map(c => c.label)).toEqual(['Align bottom'])
  })
  it('holds every tool and command file: the select tool first, undo, redo and the two Esc commands', () => {
    expect(TOOLS[0].id).toBe('select')
    expect(COMMANDS.map(c => c.id)).toEqual(expect.arrayContaining(['undo', 'redo', 'tool.leave', 'select.parent']))
  })
  it('sorts tools by order and commands by menu, then order; an id used twice throws', () => {
    const t: Tool = { kind: 'tool', id: 'a', label: 'A', order: 2, down: () => null }
    expect(collect([t, [{ ...t, id: 'b', order: 1 }]]).tools.map(x => x.id)).toEqual(['b', 'a'])
    expect(() => collect([t, t])).toThrow('two entries share the id "a"')
    const c = (id: string, menu?: Command['menu'], order?: number): Command => ({ kind: 'command', id, label: id, menu, order, when: () => true, run: () => {} })
    const sorted = collect([c('keys'), c('align0', 'align', 0), c('edit1', 'edit', 1), [c('edit0', 'edit'), c('style0', 'style', 0)]])
    expect(sorted.commands.map(x => x.id)).toEqual(['edit0', 'edit1', 'align0', 'style0', 'keys'])
  })
})
