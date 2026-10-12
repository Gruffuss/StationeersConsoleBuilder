// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { Header } from './Header'
import { ThemeMenu } from './ThemeMenu'

it('shows the project banner, mounted theme choices, paused saving and header actions', async () => {
  const fonts = vi.fn(), imported = vi.fn(), play = vi.fn(), reopen = vi.fn()
  const ui = mount(<Header name="Test" menus={[]} storageMessage="Not saved: test" paused onSave={reopen} play onPlay={play} onFonts={fonts} onExport={() => {}} canExport={false}
    theme={<ThemeMenu name="Neutral" onImport={imported}><button role="menuitemradio" aria-checked="true">Neutral</button></ThemeMenu>} />)
  try {
    expect(ui.container.querySelector('h1')!.textContent).toBe('Test')
    expect(ui.container.querySelector('[aria-label="Play"]')!.getAttribute('aria-pressed')).toBe('true')
    expect(Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === 'Export')!.disabled).toBe(true)
    await run(() => ui.container.querySelector<HTMLButtonElement>('.vb-save')!.click()); expect(reopen).toHaveBeenCalledOnce()
    const trigger = ui.container.querySelector<HTMLButtonElement>('[aria-controls="vb-theme-menu"]')!
    await run(() => trigger.click()); expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(ui.container.querySelector('.vb-theme-menu [role=menuitemradio]')).not.toBeNull()
    await run(() => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === 'Import a design system…')!.click())
    expect(imported).toHaveBeenCalledOnce(); expect(trigger.getAttribute('aria-expanded')).toBe('false')
  } finally { ui.unmount() }
})
