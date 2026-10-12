// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { SaveDialogs } from './SaveDialogs'

const opened = (box: HTMLElement) => Array.from(box.querySelectorAll<HTMLDialogElement>('dialog')).filter(d => d.open).map(d => d.querySelector('h2')!.textContent)
it.each(['Continue without autosave', 'Close'])('does not reopen recovery after explicit startup %s', async label => {
  const props = { phase: 'choice' as const, paused: true, discovered: false, busy: false, request: 0, message: 'Not saved', canContinue: true, onContinue: vi.fn(), onBlank: vi.fn(), onDownload: vi.fn(), startup: null, recovery: null }
  const ui = mount(<SaveDialogs {...props} />)
  try {
    await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === label || b.getAttribute('aria-label') === label)!.click())
    ui.rerender(<SaveDialogs {...props} phase="ready" />)
    expect(opened(ui.container)).toEqual([])
    ui.rerender(<SaveDialogs {...props} phase="ready" request={1} />)
    expect(opened(ui.container)).toEqual(['Not saved'])
  } finally { ui.unmount() }
})
it('closes recovery when Blank is confirmed', async () => {
  const props = { phase: 'ready' as const, paused: true, discovered: false, busy: false, request: 0, message: 'Not saved', canContinue: false, onContinue: vi.fn(), onBlank: vi.fn(), onDownload: vi.fn(), startup: null, recovery: null }
  const ui = mount(<SaveDialogs {...props} />)
  try {
    await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === 'Blank project')!.click())
    await run(() => ui.container.querySelector<HTMLButtonElement>('dialog[open] .btn.danger')!.click())
    expect(props.onBlank).toHaveBeenCalledOnce()
    expect(opened(ui.container)).toEqual([])
  } finally { ui.unmount() }
})
it('continues startup on Close only when Continue is offered and confirms Blank with Cancel focused', async () => {
  const proceed = vi.fn(), blank = vi.fn()
  const props = { phase: 'choice' as const, paused: true, discovered: false, busy: false, request: 0, message: 'Not saved', onContinue: proceed, onBlank: blank, onDownload: vi.fn(), startup: null, recovery: null }
  const ui = mount(<SaveDialogs {...props} canContinue />)
  try {
    expect(opened(ui.container)).toEqual(['Choose a project'])
    await run(() => ui.container.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')!.click())
    expect(proceed).toHaveBeenCalledOnce()
    await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === 'Blank project')!.click())
    expect(opened(ui.container)).toContain('Start a blank project?')
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect(blank).not.toHaveBeenCalled()
    await run(() => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('dialog[open] button')).find(b => b.textContent === 'Cancel')!.click())
    ui.rerender(<SaveDialogs {...props} canContinue={false} />)
    expect(ui.container.querySelector('dialog[open] [aria-label="Close"]')).toBeNull()
  } finally { ui.unmount() }
})
it('defers Not saved while busy, closes without resuming saving, and reopens from the header', async () => {
  const props = { phase: 'ready' as const, paused: true, discovered: false, request: 0, message: 'Not saved', onContinue: vi.fn(), onBlank: vi.fn(), onDownload: vi.fn(), startup: null, recovery: null, canContinue: false }
  const ui = mount(<SaveDialogs {...props} busy />)
  try {
    expect(opened(ui.container)).toEqual([])
    ui.rerender(<SaveDialogs {...props} busy={false} />); expect(opened(ui.container)).toEqual(['Not saved'])
    await run(() => ui.container.querySelector<HTMLButtonElement>('dialog[open] [aria-label="Close"]')!.click())
    expect(opened(ui.container)).toEqual([]); expect(props.onContinue).not.toHaveBeenCalled()
    ui.rerender(<SaveDialogs {...props} request={1} busy={false} />); expect(opened(ui.container)).toEqual(['Not saved'])
    ui.rerender(<SaveDialogs {...props} paused={false} busy={false} />); expect(opened(ui.container)).toEqual([])
  } finally { ui.unmount() }
})
