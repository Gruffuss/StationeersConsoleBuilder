// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount, run } from '../../testing'
import { newProject } from '../../model/project'
import { DevicesRow } from './DevicesRow'

it('shows the generated Devices page only for a scanning role, with its way in and warning', async () => {
  const project = newProject(), ui = mount(<DevicesRow project={project} play={false} active="main" problems={[]} />)
  try {
    expect(ui.container.querySelector('button')).toBeNull()
    project.roles = [{ id: 'scan', name: 'Scan', prefabs: [], mode: 'all' }]
    ui.rerender(<DevicesRow project={project} play active="Devices" problems={[{ level: 'warning', message: 'the Devices page has no way in: add a page step' }]} />)
    const button = ui.container.querySelector('button')!
    await run(() => button.click())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(ui.container.textContent).toContain('It has no editor.')
    expect(ui.container.textContent).toContain('PREV, NEXT, RESCAN, BACK and SAVE')
    expect(ui.container.querySelector('.chip.warn')!.textContent).toBe('WARN')
  } finally { ui.unmount() }
})
