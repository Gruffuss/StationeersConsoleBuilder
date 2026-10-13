// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { THEMES } from '../theme'
import { readFileSync } from 'node:fs'
import { TEMPLATES } from '../project/templates'
import * as data from '../project/templateData'
import { templateProject } from '../project/templateData'
import { TemplatePicker } from './TemplatePicker'

describe('template picker', () => {
  it('loads the template data only when the dialog opens, the layout unchanged while it loads', async () => {
    let resolve!: (d: typeof data) => void
    const load = vi.fn(() => new Promise<typeof data>(r => { resolve = r })), onPick = vi.fn()
    const ui = mount(<TemplatePicker theme="neutral" onPick={onPick} active={false} load={load} />)
    try {
      const status = ui.container.querySelector('[role="status"]')!, button = ui.container.querySelector('button')!
      expect(load).not.toHaveBeenCalled()
      expect(status.textContent).toBe('')
      expect(ui.container.querySelectorAll('input[type="radio"]')).toHaveLength(TEMPLATES.length)
      await run(() => ui.rerender(<TemplatePicker theme="neutral" onPick={onPick} active load={load} />))
      expect(load).toHaveBeenCalledTimes(1)
      expect(ui.container.querySelector('[role="status"]')).toBe(status)
      expect(status.textContent).toBe('Loading templates…')
      await run(() => ui.container.querySelector<HTMLInputElement>('input[value="solar"]')!.click())
      expect(button.disabled).toBe(true)
      await run(async () => resolve(data))
      expect(status.textContent).toBe('')
      expect(button.disabled).toBe(false)
      await run(() => button.click())
      expect(onPick).toHaveBeenCalledExactlyOnceWith(templateProject('solar', 'neutral'))
      await run(() => ui.rerender(<TemplatePicker theme="neutral" onPick={onPick} active={false} load={load} />))
      await run(() => ui.rerender(<TemplatePicker theme="neutral" onPick={onPick} active load={load} />))
      expect(load).toHaveBeenCalledTimes(1)
    } finally { ui.unmount() }
  })
  it('says when the template data could not load, and tries again on the next open', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(data)
    const ui = mount(<TemplatePicker theme="neutral" onPick={() => {}} active load={load} />)
    try {
      await run(async () => {})
      expect(ui.container.querySelector('[role="status"]')!.textContent).toBe('The templates could not load (offline). Close this dialog and open it again to retry.')
      await run(() => ui.rerender(<TemplatePicker theme="neutral" onPick={() => {}} active={false} load={load} />))
      await run(() => ui.rerender(<TemplatePicker theme="neutral" onPick={() => {}} active load={load} />))
      expect(load).toHaveBeenCalledTimes(2)
      expect(ui.container.querySelector('[role="status"]')!.textContent).toBe('')
    } finally { ui.unmount() }
  })
  it('keeps the template data out of the main bundle: the list module only imports it on demand', () => {
    const list = readFileSync('src/project/templates.ts', 'utf8')
    expect(list).not.toMatch(/eager/)
    expect(list).not.toMatch(/^import .*templates\/.*\.json/m)
    expect(list).toMatch(/import\('\.\/templateData'\)/)
    const picker = readFileSync('src/editor/TemplatePicker.tsx', 'utf8')
    expect(picker).not.toMatch(/^import (?!type )[^\n]*templateData/m)
  })
  it('lists ten described radio tiles in order and waits for Open template', async () => {
    const onPick = vi.fn(), ui = mount(<TemplatePicker theme="neutral" onPick={onPick} />)
    try {
      const group = ui.container.querySelector('[role="radiogroup"][aria-label="Open template"]')!
      expect(group).not.toBeNull()
      const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
      expect(radios).toHaveLength(10)
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
