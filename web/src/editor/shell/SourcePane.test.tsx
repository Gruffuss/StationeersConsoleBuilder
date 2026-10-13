// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { SourcePane } from './SourcePane'
import { FrameLabel } from './FrameLabel'
import { newProject } from '../../model/project'

it('keeps source content mounted when hidden and shows page, diagnostic counts and close control', async () => {
  const close = vi.fn(), ui = mount(<SourcePane name="Main" open counts={{ errors: 1, warnings: 2 }} onClose={close}><input /></SourcePane>)
  try {
    const input = ui.container.querySelector('input')!
    expect(ui.container.textContent).toContain('1 error · ● 2 warnings')
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Close the source pane"]')!.click()); expect(close).toHaveBeenCalledOnce()
    ui.rerender(<SourcePane name="Main" open={false} counts={{ errors: 0, warnings: 0 }} onClose={close}><input /></SourcePane>)
    expect(ui.container.querySelector('input')).toBe(input); expect(ui.container.querySelector('section')!.hidden).toBe(true)
  } finally { ui.unmount() }
  const frame = mount(<FrameLabel page={newProject().pages[0]} dispatch={() => {}} onCustom={() => {}} />)
  try { expect(frame.container.textContent).toBe('Main · Square (1×1)') } finally { frame.unmount() }
})
