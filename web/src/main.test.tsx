// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import type { PageFontCallbacks } from './editor/pageFonts'
const roots = vi.hoisted(() => ({ create: vi.fn(() => ({ render: vi.fn() })), register: vi.fn(), load: vi.fn(),
  reader: vi.fn(), setReader: vi.fn(), pageFonts: vi.fn(), configure: vi.fn<(callbacks: PageFontCallbacks<unknown>) => void>() }))
vi.mock('react-dom/client', () => ({ createRoot: roots.create }))
vi.mock('./App', () => ({ App: () => null }))
vi.mock('./editor/fonts', () => ({ registerFaces: roots.register, loadImportedFonts: roots.load,
  registerPageFonts: roots.pageFonts, setFontMetadataReader: roots.setReader }))
vi.mock('./editor/fontMetadata', () => ({ readFontMetadata: roots.reader }))
vi.mock('./editor/pageFonts', () => ({ configurePageFonts: roots.configure }))
afterEach(() => { document.getElementById('root')?.remove(); vi.resetModules(); vi.clearAllMocks() })
it('reuses the root and font registration when the entry module runs again during HMR', async () => {
  const container = document.createElement('div'); container.id = 'root'; document.body.append(container)
  await import('./main')
  vi.resetModules()
  await import('./main')
  expect(roots.create).toHaveBeenCalledExactlyOnceWith(container)
  expect(roots.create.mock.results[0].value.render).toHaveBeenCalledTimes(2)
  expect(roots.register).toHaveBeenCalledOnce()
  expect(roots.load).toHaveBeenCalledOnce()
  expect(roots.setReader).toHaveBeenCalledExactlyOnceWith(roots.reader)
  expect(roots.configure).toHaveBeenCalledExactlyOnceWith({ readFontMetadata: roots.reader, registerPageFonts: roots.pageFonts })
  expect(roots.setReader.mock.invocationCallOrder[0]).toBeLessThan(roots.load.mock.invocationCallOrder[0])
  expect(roots.configure.mock.invocationCallOrder[0]).toBeLessThan(roots.create.mock.invocationCallOrder[0])
  const data = new ArrayBuffer(1), controller = new AbortController()
  controller.abort()
  roots.configure.mock.calls[0][0].readFontMetadata(data, controller.signal)
  expect(roots.reader).toHaveBeenCalledExactlyOnceWith(data, controller.signal)
})
