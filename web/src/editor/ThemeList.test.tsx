// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { THEMES } from '../theme'
import { imported } from '../theme/testing'

it('lists provided, project and browser themes with callback-only controls', async () => {
  const { ThemeList } = await import('./ThemeList')
  const browser = { ...imported, id: 'ds-browser', name: 'Browser theme' }, other = { ...imported, id: 'ds-other', name: 'Other' }
  const onChoose = vi.fn(), onAdd = vi.fn(), onRemove = vi.fn(), onSave = vi.fn(), onRemoveLibrary = vi.fn()
  const ui = mount(<ThemeList provided={Object.values(THEMES)} imported={[imported, other]} library={[imported, browser]} value={imported.id}
    onChoose={onChoose} onAdd={onAdd} onRemove={onRemove} onSave={onSave} onRemoveLibrary={onRemoveLibrary} notes={['A browser record could not be read']} />)
  try {
    expect(ui.container.querySelector('select')).toBeNull()
    expect(ui.container.querySelector('[aria-label="Save Imported test to browser"]')!.textContent).toBe('Save Imported test to browser')
    expect(ui.container.querySelector('[aria-label="Remove Imported test from project"]')!.textContent).toBe('Remove Imported test from project')
    expect(Array.from(ui.container.querySelectorAll('.mgroup')).map(g => g.textContent)).toEqual(['Provided', 'Project', 'This browser'])
    expect(ui.container.querySelector('[role="menuitemradio"][aria-label="Imported test"]')!.getAttribute('aria-checked')).toBe('true')
    await run(() => ui.container.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-label="Browser theme"]')!.click())
    expect(onAdd).toHaveBeenCalledWith(browser)
    await run(() => ui.container.querySelector<HTMLButtonElement>(`[role="menuitemradio"][aria-label="${THEMES.neutral.name}"]`)!.click())
    expect(onChoose).toHaveBeenCalledWith('neutral')
    const click = (label: string) => run(() => ui.container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
    // The current theme's Remove asks too, so the store's refusal can say why (a disabled button says nothing).
    await click('Remove Imported test from project'); expect(onRemove).toHaveBeenLastCalledWith(imported.id)
    await click('Remove Other from project'); expect(onRemove).toHaveBeenLastCalledWith(other.id)
    await click('Save Imported test to browser'); expect(onSave).toHaveBeenCalledWith(imported)
    await click('Remove Browser theme from browser'); expect(onRemoveLibrary).toHaveBeenCalledWith(browser.id)
    expect(ui.container.querySelector('[role="status"]')!.textContent).toContain('A browser record could not be read')
  } finally { ui.unmount() }
})

it('omits empty Project and This browser headings while keeping library notes', async () => {
  const { ThemeList } = await import('./ThemeList')
  const ui = mount(<ThemeList provided={Object.values(THEMES)} imported={[]} library={[]} value="neutral" notes={['Library unavailable']}
    onChoose={() => {}} onAdd={() => {}} onRemove={() => {}} onSave={() => {}} onRemoveLibrary={() => {}} />)
  try {
    expect(Array.from(ui.container.querySelectorAll('.mgroup')).map(g => g.textContent)).toEqual(['Provided'])
    expect(ui.container.querySelector('[role=status]')!.textContent).toBe('Library unavailable')
  } finally { ui.unmount() }
})
