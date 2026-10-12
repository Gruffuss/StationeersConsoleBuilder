import { Dialog } from '../../ui/Dialog'
import type { Ctx } from '../../editing/types'
import { ShortcutsTable } from './ShortcutsTable'
import { shortcutSections } from './shortcuts'

export function ShortcutsDialog(p: { open: boolean; onClose(): void; ctx: Ctx }) {
  return <Dialog open={p.open} onClose={p.onClose} size="xl" title="Keyboard and gestures"><ShortcutsTable sections={shortcutSections(p.ctx)} /></Dialog>
}
