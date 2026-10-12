import { useSyncExternalStore, type ReactNode } from 'react'

type ShellDialog = 'fonts' | 'export' | 'import' | 'shortcuts' | 'game' | null
type ProjectDialog = 'new' | 'share' | 'adopt' | null

export function createDialogs() {
  let dialog: ShellDialog = null, project: ProjectDialog = null
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach(listener => listener())
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    dialog: () => dialog,
    project: () => project,
    setDialog(value: ShellDialog) { if (dialog !== value) { dialog = value; notify() } },
    setProjectDialog(value: ProjectDialog) { if (project !== value) { project = value; notify() } },
  }
}

type Dialogs = ReturnType<typeof createDialogs>

export function DialogHost(p: { dialogs: Dialogs; name: Exclude<ShellDialog, null>; children(open: boolean): ReactNode }) {
  const open = useSyncExternalStore(p.dialogs.subscribe, () => p.dialogs.dialog() === p.name)
  return p.children(open)
}

export function ProjectDialogHost(p: { dialogs: Dialogs; children(open: ProjectDialog): ReactNode }) {
  const open = useSyncExternalStore(p.dialogs.subscribe, p.dialogs.project)
  return p.children(open)
}
