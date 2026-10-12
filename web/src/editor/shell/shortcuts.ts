import { COMMANDS, commandsOf, TOOLS } from '../../editing/registry'
import type { Ctx } from '../../editing/types'
import { keyLabel, keysLabel } from './keyLabels'

export type ShortcutRow = { what: string; keys: string }
export type ShortcutSection = { title: string; rows: ShortcutRow[]; note?: string }

export function shortcutSections(ctx?: Ctx): ShortcutSection[] {
  const commands = ctx ? commandsOf(ctx) : COMMANDS
  const rows = (ids: string[]): ShortcutRow[] => commands.filter(c => ids.includes(c.id) && c.keys?.length).map(c => ({ what: c.label, keys: keysLabel(c.keys) }))
  const escape = ['tool.leave', 'select.parent', 'select.enter', 'select.leave', ...commands.filter(c => c.id.startsWith('nudge.')).map(c => c.id)]
  const points = ['point-add', 'point-delete', 'point-corner', 'point-smooth']
  return [
    { title: 'Tools', note: 'Ctrl is Cmd on a Mac. Keys act on the canvas; typing in a field keeps its own keys.', rows: TOOLS.filter(t => t.key).map(t => ({ what: t.label, keys: keyLabel(t.key!) })) },
    { title: 'Escape, Enter, nudge', rows: [
      { what: 'Cancel an open gesture first', keys: 'Esc' }, ...rows(escape),
      { what: 'Nudge step: 1 design unit; Shift: 10. A burst is one undo step.', keys: '← · → · ↑ · ↓' },
    ] },
    { title: 'View', rows: [
      { what: 'Pan', keys: 'Space-drag · Middle-drag · Wheel' }, { what: 'Pan sideways', keys: 'Shift+wheel' },
      { what: 'Zoom at the pointer', keys: 'Ctrl+wheel · Pinch' },
    ] },
    { title: 'Select tool', rows: [
      { what: 'Select at the current editing depth', keys: 'Click' }, { what: 'Add or remove a member', keys: 'Shift+click' },
      { what: 'Select the innermost node', keys: 'Ctrl+click' }, { what: 'Enter a group or widget', keys: 'Double-click' },
      { what: 'Switch to Points on a selected line, polygon or path', keys: 'Double-click' },
      { what: 'Move the selection', keys: 'Drag' }, { what: 'Marquee: touching nodes', keys: 'Drag empty canvas' },
      { what: 'Add to the marquee selection', keys: 'Shift+drag empty canvas' }, { what: 'Marquee: enclosed nodes only', keys: 'Ctrl+drag empty canvas' },
      { what: 'Turn snapping off', keys: 'Ctrl while dragging' },
    ] },
    { title: 'Resize and rotate handles', rows: [
      { what: 'Resize', keys: 'Drag a resize handle' }, { what: 'Keep proportions', keys: 'Shift+drag a resize handle' },
      { what: 'Resize from the centre', keys: 'Alt+drag a resize handle' }, { what: 'Rotate', keys: 'Drag the rotate handle' },
      { what: 'Rotate in 15° steps', keys: 'Shift+drag the rotate handle' }, { what: 'Turn snapping and whole-degree rounding off', keys: 'Ctrl while dragging' },
    ] },
    { title: 'Gradient tool', rows: [
      { what: 'Select a painted node', keys: 'Click' }, { what: 'Move a gradient endpoint, centre, radius or focus', keys: 'Drag a gradient handle' },
    ] },
    { title: 'Points tool', rows: [
      { what: 'Select and move a point', keys: 'Click · Drag a point' }, { what: 'Select a segment for Add point at its midpoint', keys: 'Click a segment' },
      { what: 'Insert a point at the clicked position on a segment', keys: 'Alt+click a segment' }, { what: 'Turn snapping off', keys: 'Ctrl while dragging' },
      ...rows(points),
    ], note: 'Corner and Smooth need an anchor of a pen path. Alt+Shift+S is Smooth; Alt+S is Align bottom.' },
    { title: 'Rectangle, ellipse, text, image', rows: [
      { what: 'Draw a box, then return to Select', keys: 'Drag' }, { what: 'Insert the default box', keys: 'Click' },
      { what: 'Draw a square or circle', keys: 'Shift+drag · Shift+click' }, { what: 'Draw from the centre', keys: 'Alt+drag · Alt+click' },
      { what: 'Turn snapping off', keys: 'Ctrl while drawing' }, { what: 'Cancel drawing', keys: 'Esc' },
    ] },
    { title: 'Line, polygon, path', rows: [
      { what: 'Start the shape; a dragged line finishes on release', keys: 'Click · Drag' }, { what: 'Add a point', keys: 'Click' },
      { what: 'Finish open', keys: 'Enter · Double-click' }, { what: 'Close the shape', keys: 'Click the first point' },
      { what: 'Remove the last point', keys: 'Backspace · Ctrl+Z' }, { what: 'Constrain the next segment to 45° steps', keys: 'Shift' },
      { what: 'Turn snapping off', keys: 'Ctrl' }, { what: 'Cancel the shape', keys: 'Esc' },
    ] },
    { title: 'Pen tool', rows: [
      { what: 'Add a straight anchor', keys: 'Click' }, { what: 'Add an anchor with symmetric Bézier handles', keys: 'Drag' },
      { what: 'Close the path', keys: 'Click the first anchor' }, { what: 'Finish open', keys: 'Enter' },
      { what: 'Remove the last anchor', keys: 'Backspace' }, { what: 'Turn snapping off', keys: 'Ctrl' }, { what: 'Cancel the path', keys: 'Esc' },
    ] },
    { title: 'Commands', rows: commands.filter(c => c.keys?.length && !escape.includes(c.id) && !points.includes(c.id)).map(c => ({ what: c.label, keys: keysLabel(c.keys) })) },
    { title: 'Layers', rows: [
      { what: 'Select a row', keys: 'Click' }, { what: 'Select a range of sibling rows', keys: 'Shift+click' },
      { what: 'Add or remove a selected row', keys: 'Ctrl+click' }, { what: 'Select the focused row; Enter enters an enterable group', keys: 'Space · Enter' },
      { what: 'Enter a group or widget', keys: 'Double-click' },
      { what: 'Reorder', keys: 'Alt+↑ · Alt+↓' }, { what: 'Move out', keys: 'Alt+←' }, { what: 'Move into the group above', keys: 'Alt+→' },
      { what: 'Reorder before a row or move into a group', keys: 'Drag a row' },
    ] },
    { title: 'Pages', rows: [
      { what: 'Switch page', keys: 'Click' }, { what: 'Rename page', keys: 'Double-click · F2' },
      { what: 'Finish renaming', keys: 'Enter · Blur' }, { what: 'Cancel renaming', keys: 'Esc' },
    ] },
  ]
}
