// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { PictureControls } from './PictureControls'

it('mounts the labelled page action and pending, refused and disk notes without a container contract', async () => {
  const load = vi.fn(), ui = mount(<PictureControls canLoad onLoad={load} notes={[
    { src: 'https://example.com/a', message: 'Load pictures to preview this picture' },
    { src: 'https://example.com/b', message: 'this host does not let a browser read the picture; the game loads it itself' },
    { src: 'file:///a.bmp', message: "read from the game machine's disk" },
  ]} />)
  try {
    const button = ui.container.querySelector<HTMLButtonElement>('button')
    expect(button?.textContent).toBe('Load pictures')
    expect(ui.container.querySelectorAll('li')).toHaveLength(3)
    expect(ui.container.textContent).toContain("read from the game machine's disk")
    await run(() => button!.click()); expect(load).toHaveBeenCalledOnce()
    ui.rerender(<PictureControls canLoad={false} onLoad={load} notes={[]} />)
    expect(ui.container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  } finally { ui.unmount() }
})

it('uses explicit load state even when notes change wording', () => {
  const ui = mount(<PictureControls canLoad onLoad={() => {}} notes={[{ src: 'https://example.com/a', message: 'Remote picture pending' }]} />)
  try {
    expect(ui.container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false)
    ui.rerender(<PictureControls canLoad={false} onLoad={() => {}} notes={[{ src: 'https://example.com/a', message: 'Load pictures to preview this picture' }]} />)
    expect(ui.container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true)
  } finally { ui.unmount() }
})
