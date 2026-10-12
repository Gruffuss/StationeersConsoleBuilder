// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_SIZE, ExampleScripts } from './ExampleScripts'
import type { CoreBridge } from './runtime/bridge'
import { mount, run } from './testing'

afterEach(() => { vi.unstubAllGlobals() })

/** Stubs fetch with a response the test hands over with `respond`, and mounts the picker on a fake bridge. */
function setup() {
  let respond!: () => void
  const fetched = new Promise<Response>(r => { respond = () => r({ ok: true, text: async () => 'lua text' } as Response) })
  vi.stubGlobal('fetch', vi.fn(() => fetched))
  const bridge = { load: vi.fn() }
  const ui = mount(<ExampleScripts bridge={bridge as unknown as CoreBridge} />)
  const choose = (name: string) => run(() => {
    const select = ui.container.querySelector('select')!
    select.value = name
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  // The fetch and the text it reads both resolve within one macrotask.
  const settle = () => run(async () => { respond(); await new Promise(r => setTimeout(r)) })
  return { bridge, ui, choose, settle }
}

describe('ExampleScripts', () => {
  it.each(['18-lines', '19-webfonts'])('offers and runs %s with only the local Lua request', async name => {
    const { bridge, ui, choose, settle } = setup()
    expect(ui.container.querySelectorAll('option:not([disabled])')).toHaveLength(19)
    await choose(name)
    await settle()
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`${import.meta.env.BASE_URL}examples/${name}.lua`)
    expect(bridge.load).toHaveBeenCalledExactlyOnceWith('lua text', EXAMPLE_SIZE)
    ui.unmount()
  })

  it('loads nothing when its fetch ends after the unmount', async () => {
    const { bridge, ui, choose, settle } = setup()
    await choose('01-hello')
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/examples\/01-hello\.lua$/))
    ui.unmount()
    await settle()
    expect(bridge.load).not.toHaveBeenCalled()
  })

  it('loads the example once when its fetch ends while mounted', async () => {
    const { bridge, ui, choose, settle } = setup()
    await choose('01-hello')
    await settle()
    expect(bridge.load).toHaveBeenCalledOnce()
    expect(bridge.load).toHaveBeenCalledWith('lua text', EXAMPLE_SIZE)
    ui.unmount()
  })
})
