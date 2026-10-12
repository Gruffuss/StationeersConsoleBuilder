// The arrow keys move the selection by 1 design unit, Shift+arrows by 10, whatever the grid (spec §4). A
// key-repeat burst is one undo step (ruling P10): transient steps, committed 500 ms after the last press, or sooner by any
// other edit, an undo, or a press on the canvas (all of which commit the store's open dragBase). A burst moves one set on
// one page: a press after the set or the page changed (Mod+A, a page switch) commits the open burst first.
import type { Project } from '../../model/project'
import { selected, type State } from '../../model/store'
import { membersOf } from '../ctx'
import type { Command } from '../types'
import { moveUnits, unitsOf } from '../units'

const QUIET_MS = 500, NUDGE = 1, BIG = 10   // design units
const STEP = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as const
// The burst's own dragBase, and the project its last step wrote. The store hands back the same Project object after an
// undo or a burst that nets to nothing, so a later drag can start from `mine` too: the timer commits only while the
// project is still the one this burst wrote (ruling P10: only its own transient edit).
let timer: ReturnType<typeof setTimeout> | null = null, mine: Project | null = null, written: Project | null = null, set = ''
const setOf = (s: State) => JSON.stringify([s.activePageId, selected(s)])   // the page and the set a burst moves

const nudge = (key: keyof typeof STEP, big: boolean): Command => ({
  kind: 'command', id: `nudge.${key}${big ? '.big' : ''}`, label: `Nudge ${key.slice(5).toLowerCase()}${big ? ' (big)' : ''}`,
  keys: [big ? `Shift+${key}` : key],
  when: ctx => ctx.tool() === 'select' && membersOf(ctx).length > 0,
  run(ctx) {
    const now = ctx.get()
    if (mine && now.dragBase === mine && now.project === written && setOf(now) !== set) { ctx.dispatch({ type: 'commitDrag' }); mine = written = null }
    const k = big ? BIG : NUDGE, page = ctx.page()
    const t = ctx.theme(), units = unitsOf(page.scene, membersOf(ctx), t)
    const r = moveUnits(page.scene, units, units.map(() => ({ dx: STEP[key][0] * k, dy: STEP[key][1] * k })), t)
    if (r.skipped.length || r.notes.length) ctx.note([...r.skipped, ...r.notes].join('; '))
    if (r.scene === page.scene) return
    ctx.dispatch({ type: 'editScene', pageId: page.id, scene: r.scene, transient: true })
    mine = ctx.get().dragBase
    written = ctx.get().project
    set = setOf(ctx.get())
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const s = ctx.get()
      if (mine && s.dragBase === mine && s.project === written) ctx.dispatch({ type: 'commitDrag' })
      mine = written = null
    }, QUIET_MS)
  },
})
export default (Object.keys(STEP) as (keyof typeof STEP)[]).flatMap(k => [nudge(k, false), nudge(k, true)])
