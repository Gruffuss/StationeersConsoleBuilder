import { describe, expect, it } from 'vitest'
import { node } from '../model/testing'
import { membersOf } from './ctx'
import { commandsOf } from './registry'
import { harness } from './testing'

const missing = () => harness({ header: { w: 460, h: 460 }, defs: [], root: [node('R', { w: 20 }), node('C')] },
  { sel: { pageId: 'p1', path: [99, 0] } })

describe('missing intermediate selections', () => {
  it('are not command members', () => {
    expect(membersOf(missing().ctx)).toEqual([])
  })
  it.each(commandsOf(missing().ctx))('cannot write another node through $id', async command => {
    const h = missing(), before = h.scene()
    h.ctx.clip.style = { op: 'R', attrs: { f: '#ffffff' } }
    if (command.when?.(h.ctx) !== false) await command.run(h.ctx)
    expect(h.scene()).toEqual(before)
  })
})
