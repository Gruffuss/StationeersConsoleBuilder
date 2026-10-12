// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { THEMES } from '../theme'
import { templateProject, TEMPLATES } from '../project/templates'
import { TemplatePicker } from './TemplatePicker'

describe('template picker', () => {
  it('lists seven described radio tiles in order and waits for Open template', async () => {
    const onPick = vi.fn(), ui = mount(<TemplatePicker theme="neutral" onPick={onPick} />)
    try {
      const group = ui.container.querySelector('[role="radiogroup"][aria-label="Open template"]')!
      expect(group).not.toBeNull()
      const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      expect(radios).toHaveLength(7)
      expect(radios.map(r => r.value)).toEqual(TEMPLATES.map(t => t.id))
      const button = ui.container.querySelector('button')!
      expect(button.disabled).toBe(true)
      expect(onPick).not.toHaveBeenCalled()
      for (const [i, radio] of radios.entries()) {
        expect(radio.closest('label')?.textContent).toContain(TEMPLATES[i].name)
        expect(document.getElementById(radio.getAttribute('aria-describedby')!)?.textContent).toBe(TEMPLATES[i].description)
      }
      await run(() => radios.find(r => r.value === 'solar')!.click())
      expect(onPick).not.toHaveBeenCalled()
      await run(() => ui.rerender(<TemplatePicker theme="vanilla-plus" onPick={onPick} />))
      expect(onPick).not.toHaveBeenCalled()
      await run(() => button.click())
      expect(onPick).toHaveBeenCalledExactlyOnceWith(templateProject('solar', 'vanilla-plus'))
      expect(radios.some(r => r.checked)).toBe(false)
      expect(button.disabled).toBe(true)
    } finally { ui.unmount() }
  })
  it('renders descriptions as plain text', () => {
    const entry = TEMPLATES.find(t => t.id === 'solar')!, original = entry.description
    entry.description = '<img src=x onerror=alert(1)> units unverified'
    const ui = mount(<TemplatePicker theme="neutral" onPick={() => {}} />)
    try { expect(ui.container.querySelector('img')).toBeNull(); expect(ui.container.textContent).toContain(entry.description) }
    finally { ui.unmount(); entry.description = original }
  })
  it.each(Object.keys(THEMES))('opens every choice in the current %s theme without font/network requests', async theme => {
    const fetch = vi.spyOn(globalThis, 'fetch'), onPick = vi.fn(), ui = mount(<TemplatePicker theme={theme} onPick={onPick} />)
    try {
      for (const entry of TEMPLATES) {
        await run(() => ui.container.querySelector<HTMLInputElement>(`input[value="${entry.id}"]`)!.click())
        await run(() => ui.container.querySelector<HTMLButtonElement>('button')!.click())
        expect(onPick.mock.calls.at(-1)![0]).toEqual(templateProject(entry.id, theme))
      }
      expect(onPick).toHaveBeenCalledTimes(TEMPLATES.length)
      expect(fetch).not.toHaveBeenCalled()
    } finally { ui.unmount(); fetch.mockRestore() }
  })
})
