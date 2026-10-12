// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { storedZip } from './testing'

const bytes = (s: string) => new TextEncoder().encode(s)
export const fileEntry = (name: string, text: string) => ({ name, isFile: true, isDirectory: false, file: (ok: (f: File) => void) => ok(new File([text], name)) })
export function directory(name: string, children: object[]) {
  return { name, isDirectory: true, isFile: false, createReader: () => {
    let at = 0
    return { readEntries: (ok: (list: object[]) => void) => ok(at < children.length ? children.slice(at, ++at) : []) }
  } }
}
it('walks every directory batch, including nested folders, and expands zip files', async () => {
  const { droppedFiles } = await import('./drop')
  const root = directory('design', [directory('project', [fileEntry('tokens.json', '{}'), directory('components', [fileEntry('bundle.css', '.panel {}')])])])
  const transfer = { items: [{ kind: 'file', webkitGetAsEntry: () => root }], files: [] } as unknown as DataTransfer
  expect([...((await droppedFiles(transfer)).files).keys()]).toEqual(['design/project/tokens.json', 'design/project/components/bundle.css'])
  const zip = new File([storedZip(new Map([['dir/', bytes('')], ['dir/tokens.json', bytes('{}')]])) as Uint8Array<ArrayBuffer>], 'design.zip')
  expect([...((await droppedFiles([zip])).files).keys()]).toEqual(['dir/tokens.json'])
})
it('keeps folder input paths and reports unsafe, duplicate and unreadable files', async () => {
  const { droppedFiles } = await import('./drop')
  const file = new File(['{}'], 'tokens.json'); Object.defineProperty(file, 'webkitRelativePath', { value: 'project/tokens.json' })
  const bad = new File(['bad'], 'bad'); Object.defineProperty(bad, 'webkitRelativePath', { value: '../bad' })
  const unreadable = new File(['bad'], 'unreadable.css'); unreadable.arrayBuffer = async () => { throw Error('read refused') }
  const result = await droppedFiles([file, file, bad, unreadable])
  expect([...result.files.keys()]).toEqual(['project/tokens.json'])
  expect(result.notes.join('\n')).toMatch(/repeated path/)
  expect(result.notes.join('\n')).toMatch(/refused path/)
  expect(result.notes.join('\n')).toMatch(/unreadable.css: read refused/)
})

it('skips irrelevant folder assets without reading their bytes and names them', async () => {
  const { droppedFiles } = await import('./drop')
  const asset = new File(['asset'], 'large.png'), read = vi.spyOn(asset, 'arrayBuffer')
  const result = await droppedFiles([asset, new File(['{}'], 'tokens.json')])
  expect(read).not.toHaveBeenCalled()
  expect([...result.files.keys()]).toEqual(['tokens.json'])
  expect(result.notes).toContain('large.png: not used by the design-system importer; not read')
})

it('notes unused zip assets and keeps only importer files', async () => {
  const { droppedFiles } = await import('./drop')
  const zip = new File([storedZip(new Map([
    ['assets/readme-image.png', bytes('image')], ['tokens.json', bytes('{}')], ['README.md', bytes('usage')], ['bundle.js', bytes('bundle')],
  ])) as Uint8Array<ArrayBuffer>], 'design.zip')
  const result = await droppedFiles([zip])
  expect([...result.files.keys()]).toEqual(['tokens.json', 'README.md', 'bundle.js'])
  expect(result.notes).toContain('design.zip: assets/readme-image.png: not used by the design-system importer; not read')
})
