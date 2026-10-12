import { safePath } from './types'
import { readZip } from './zip'

const used = (path: string) => /\.(?:json|css|ttf|otf|ttc|woff2?)$/i.test(path) || /(?:^|\/)(?:readme|usage)\.md$|\.prompt\.md$|(?:^|\/)(?:_ds_bundle|bundle)\.js$/i.test(path)

export async function droppedFiles(input: DataTransfer | ArrayLike<File>): Promise<{ files: Map<string, Uint8Array>; notes: string[] }> {
  const files = new Map<string, Uint8Array>(), notes: string[] = []
  const queue: { entry?: FileSystemEntry; file?: File; parent: string }[] = []
  // Snapshot the protected drag data before the first await.
  if ('items' in input && input.items.length) {
    for (const item of Array.from(input.items)) {
      if (item.kind !== 'file') continue
      const entry = item.webkitGetAsEntry?.()
      const file = entry ? undefined : item.getAsFile?.() ?? undefined
      if (entry || file) queue.push({ entry: entry ?? undefined, file, parent: '' })
    }
  } else for (const file of Array.from('files' in input ? input.files : input)) queue.push({ file, parent: '' })
  const put = (name: string, bytes: Uint8Array) => {
    const path = safePath(name)
    if (!path) { notes.push(name + ': refused path'); return }
    if (files.has(path)) notes.push(path + ': repeated path; keeping last')
    files.set(path, bytes)
  }
  for (let at = 0; at < queue.length; at++) {
    const { entry, parent } = queue[at]
    let file = queue[at].file
    const path = parent + (entry?.name ?? (file?.webkitRelativePath || file?.name || ''))
    try {
      if (entry?.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader()
        for (;;) {
          const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
          if (!batch.length) break
          for (const child of batch) queue.push({ entry: child, parent: path + '/' })
        }
        continue
      }
      if (entry?.isFile) file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      if (!file) continue
      if (!safePath(path)) { notes.push(path + ': refused path'); continue }
      if (!used(path) && !/\.zip$/i.test(path)) {
        notes.push(path + ': not used by the design-system importer; not read'); continue
      }
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (/\.zip$/i.test(path)) {
        const zip = await readZip(bytes, used); notes.push(...zip.notes.map(note => path + ': ' + note))
        for (const [name, data] of zip.files) put(name, data)
      } else put(path, bytes)
    } catch (e) { notes.push(path + ': ' + (e instanceof Error ? e.message : String(e))) }
  }
  return { files, notes }
}
