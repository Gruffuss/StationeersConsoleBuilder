// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { ExamplePicker } from './ExamplePicker'
import { sceneOfProps } from '../srctext/fromProps'
import lines from '../../test/fixtures/examples/18-lines.lines_s.props.json'
import type { Pairs } from '../srctext/props'

it.each(['18-lines', '19-webfonts'])('opens %s without fetching fonts', async name => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const onPick = vi.fn()
  const ui = mount(<ExamplePicker onPick={onPick} />)
  try {
    const select = ui.container.querySelector('select')!
    expect(select.querySelectorAll('option:not([disabled])')).toHaveLength(19)
    await run(() => {
      select.value = name
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledOnce()
    const project = onPick.mock.calls[0][0]
    expect(project.name).toBe(name)
    expect(project.pages).toHaveLength(1)
    expect(project.pages[0].scene).toEqual(name === '18-lines' ? sceneOfProps(lines as Pairs)
      : expect.objectContaining({ defs: [{ op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700' } }] }))
    expect(fetchSpy).not.toHaveBeenCalled()
  } finally {
    ui.unmount()
    fetchSpy.mockRestore()
  }
})
