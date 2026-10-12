// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import type { Renderer } from './Canvas'
import { CaptureOverlay } from './CaptureOverlay'

afterEach(() => { vi.unstubAllGlobals() })

const bitmap = (size: number) => ({ width: size, height: size, close: vi.fn() })
const renderer = { readPixels: () => new Uint8Array(460 * 460 * 4) } as unknown as Renderer

function setup(example = '01-hello') {
  const ui = mount(<CaptureOverlay renderer={renderer} size={{ w: 460, h: 460 }} run={example} />)
  const pick = () => run(() => {
    const input = ui.container.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [new File([''], 'capture.png', { type: 'image/png' })], configurable: true })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const output = () => ui.container.querySelector('output')!.textContent
  const measure = () => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === 'Measure')!
  return { ui, pick, output, measure }
}

describe('CaptureOverlay', () => {
  it.each([
    ['18-lines', 'not compared: old geometry capture'],
    ['19-webfonts', 'pending: loaded-font and fallback captures'],
  ])('keeps %s pixel acceptance open', (example, status) => {
    const { ui, output, measure } = setup(example)
    expect(output()).toBe(status)
    expect(measure().disabled).toBe(true)
    ui.unmount()
  })

  it('discards the previous capture when the selected example changes', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap(460)))
    const { ui, pick, measure, output } = setup()
    await pick()
    expect(measure().disabled).toBe(false)
    ui.rerender(<CaptureOverlay renderer={renderer} size={{ w: 460, h: 460 }} run="18-lines" />)
    expect(measure().disabled).toBe(true)
    expect(ui.container.querySelector('img')).toBeNull()
    expect(output()).toBe('not compared: old geometry capture')
    ui.unmount()
  })

  it('drops a decode that finishes after switching examples', async () => {
    let finish!: (b: ReturnType<typeof bitmap>) => void
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(r => { finish = r })))
    const { ui, pick, measure, output } = setup('18-lines')
    await pick()
    ui.rerender(<CaptureOverlay renderer={renderer} size={{ w: 460, h: 460 }} run="19-webfonts" />)
    const old = bitmap(460)
    await run(() => finish(old))
    expect(old.close).toHaveBeenCalledOnce()
    expect(measure().disabled).toBe(true)
    expect(ui.container.querySelector('img')).toBeNull()
    expect(output()).toBe('pending: loaded-font and fallback captures')
    ui.unmount()
  })

  it('refuses a capture that is not the surface\'s size', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap(100)))
    const { ui, pick, output, measure } = setup()
    expect(measure().disabled).toBe(true)
    await pick()
    expect(output()).toBe('refused: the capture is 100×100, the surface 460×460')
    expect(measure().disabled).toBe(true)
    ui.unmount()
  })

  it('shows only the latest pick when the decodes end in reverse order', async () => {
    const decodes: ((b: ReturnType<typeof bitmap>) => void)[] = []
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(r => decodes.push(r))))
    const { ui, pick, output } = setup()
    await pick()
    await pick()
    const [first, second] = [bitmap(50), bitmap(100)]
    await run(() => decodes[1](second))
    await run(() => decodes[0](first))
    expect(output()).toBe('refused: the capture is 100×100, the surface 460×460')
    expect(first.close).toHaveBeenCalledOnce()
    ui.unmount()
  })
})
