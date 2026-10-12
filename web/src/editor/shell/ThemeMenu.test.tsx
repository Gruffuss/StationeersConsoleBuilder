// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { ThemeList } from '../ThemeList'
import { THEMES } from '../../theme'
import { ThemeMenu } from './ThemeMenu'

it('keeps one theme menu, picks by keyboard, aligns right and restores focus on Escape', async () => {
  const choose = vi.fn(), onImport = vi.fn(), ui = mount(<ThemeMenu name="Neutral" onImport={onImport}><ThemeList provided={Object.values(THEMES)} imported={[]} library={[]} value="neutral" notes={[]} onChoose={choose} onAdd={() => {}} onSave={() => {}} onRemove={() => {}} onRemoveLibrary={() => {}} /></ThemeMenu>)
  try {
    const trigger = ui.container.querySelector<HTMLButtonElement>(':scope > .vb-theme-anchor > button')!
    await run(() => trigger.click())
    const menu = ui.container.querySelector<HTMLElement>('[role=menu]')!
    expect(menu).not.toBeNull(); expect(menu.querySelector('select, [aria-haspopup=menu]')).toBeNull()
    expect(menu.parentElement!.style.right).toBe('0px')
    const key = (key: string) => run(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
    await key('ArrowDown'); await key(' ')
    expect(choose).toHaveBeenLastCalledWith('vanilla-plus')
    await run(() => trigger.click()); await key('Escape')
    expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger)
    await run(() => trigger.click()); await key('End'); await key('Enter')
    expect(onImport).toHaveBeenCalledOnce()
  } finally { ui.unmount() }
})
