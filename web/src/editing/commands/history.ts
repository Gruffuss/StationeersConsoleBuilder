// Undo and redo (M1's keys, now registry entries).
import type { Command } from '../types'

const undo: Command = { kind: 'command', id: 'undo', label: 'Undo', menu: 'edit', order: 0, keys: ['Mod+Z'],
  when: ctx => ctx.get().past.length > 0 || ctx.get().dragBase !== null, run: ctx => ctx.dispatch({ type: 'undo' }) }
const redo: Command = { kind: 'command', id: 'redo', label: 'Redo', menu: 'edit', order: 1, keys: ['Mod+Shift+Z', 'Mod+Y'],
  when: ctx => ctx.get().future.length > 0, run: ctx => ctx.dispatch({ type: 'redo' }) }
export default [undo, redo]
