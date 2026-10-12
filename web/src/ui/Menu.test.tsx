// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../testing'
import { MenuBar, MenuButton, type MenuItem } from './Menu'

function setup() {
  const action = vi.fn(), disabled = vi.fn(), child = vi.fn(), items = vi.fn((): MenuItem[] => [
    { kind: 'group', label: 'Actions', dev: true },
    { kind: 'item', id: 'first', label: 'First', run: action, keys: 'Ctrl+A', note: 'A note', dev: true },
    { kind: 'item', id: 'disabled', label: 'Disabled', disabled: true, run: disabled },
    { kind: 'separator' },
    { kind: 'item', id: 'checked', label: 'Checked', checked: true, run: action },
    { kind: 'note', text: 'Helper' },
    { kind: 'submenu', id: 'sub', label: 'Styles', count: 1, items: [{ kind: 'item', id: 'child', label: 'Child', run: child }] },
  ])
  const ui = mount(<><input aria-label="Canvas focus" /><MenuBar label="Main menus" menus={[{ id: 'edit', label: 'Edit', items }, { id: 'view', label: 'View', items: () => [{ kind: 'item', id: 'fit', label: 'Fit', run: action }] }]} /></>)
  const buttons = Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="menubar"] > button'))
  const find = (text: string) => Array.from(ui.container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find(b => b.textContent?.startsWith(text))!
  const key = (key: string, target: EventTarget = document.body) => run(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })) })
  return { ui, buttons, find, key, action, disabled, child, items }
}

it('renders menubar buttons, ordered items and decorations, runs enabled items and closes', async () => {
  const { ui, buttons, find, action, disabled, items } = setup()
  expect(buttons.map(b => b.textContent)).toEqual(['Edit', 'View'])
  expect(buttons.map(b => b.tabIndex)).toEqual([0, -1])
  expect(items).not.toHaveBeenCalled()
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  buttons[0].dispatchEvent(down)
  expect(down.defaultPrevented).toBe(true)
  await run(() => buttons[0].click())
  expect(items).toHaveBeenCalled()
  expect(ui.container.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe('Edit')
  expect(Array.from(ui.container.querySelectorAll('[role="menu"] > button')).map(b => b.textContent?.split('DEV')[0])).toEqual(['First', 'Disabled', 'Checked', 'Styles1'])
  expect(find('Checked').getAttribute('role')).toBe('menuitemcheckbox')
  expect(find('Checked').getAttribute('aria-checked')).toBe('true')
  expect(find('Disabled').getAttribute('aria-disabled')).toBe('true')
  await run(() => find('Disabled').click())
  expect(disabled).not.toHaveBeenCalled()
  expect(ui.container.querySelector('[role="menu"]')).not.toBeNull()
  const itemDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  find('First').dispatchEvent(itemDown)
  expect(itemDown.defaultPrevented).toBe(true)
  await run(() => find('First').click())
  expect(action).toHaveBeenCalledTimes(1)
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  ui.unmount()
})

it('takes keyboard navigation before document bubbling, skips disabled items and manages submenu focus', async () => {
  const { ui, buttons, find, key, child } = setup()
  buttons[0].focus()
  await key('ArrowDown', buttons[0])
  expect(document.activeElement).toBe(find('First'))
  expect(buttons[0].getAttribute('aria-controls')).toBe(ui.container.querySelector('[role="menu"]')!.id)
  await key('End')
  expect(document.activeElement).toBe(find('Styles'))
  await key('Home')
  expect(document.activeElement).toBe(find('First'))
  await key('ArrowDown')
  expect(document.activeElement).toBe(find('Checked'))
  expect(find('Checked').tabIndex).toBe(0)
  expect(find('First').tabIndex).toBe(-1)
  await key('ArrowDown')
  await key('ArrowRight')
  expect(ui.container.querySelectorAll('[role="menu"]')).toHaveLength(2)
  expect(document.activeElement).toBe(find('Child'))
  await key('ArrowLeft')
  expect(ui.container.querySelectorAll('[role="menu"]')).toHaveLength(1)
  expect(document.activeElement).toBe(find('Styles'))
  await key('ArrowRight')
  await key('Enter')
  expect(child).toHaveBeenCalledTimes(1)
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(buttons[0])
  await key(' ', buttons[0])
  const bubble = vi.fn()
  document.addEventListener('keydown', bubble)
  await key('Escape')
  expect(bubble).not.toHaveBeenCalled()
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(buttons[0])
  document.removeEventListener('keydown', bubble)
  ui.unmount()
})

it('switches menus by hover and arrow keys, closes outside and preserves mouse focus', async () => {
  const { ui, buttons, find, key } = setup()
  const input = ui.container.querySelector('input')!
  input.focus()
  await run(() => buttons[0].click())
  expect(document.activeElement).toBe(input)
  await key('ArrowDown')
  expect(document.activeElement).toBe(find('Checked'))
  await run(() => { buttons[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  expect(find('Fit')).toBeDefined()
  await run(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  buttons[0].focus()
  await key('Enter', buttons[0])
  await key('ArrowRight')
  expect(document.activeElement).toBe(find('Fit'))
  await key('ArrowLeft')
  expect(document.activeElement).toBe(find('First'))
  ui.unmount()
})

it('MenuButton uses the same keyboard and outside-close behaviour', async () => {
  const action = vi.fn()
  const ui = mount(<MenuButton label="More actions" align="end" title="More" className="ibtn" items={() => [{ kind: 'item', id: 'delete', label: 'Delete', run: action }]}><span>…</span></MenuButton>)
  const button = ui.container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!
  expect(button.getAttribute('aria-label')).toBe('More actions')
  button.focus()
  await run(() => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
  expect(document.activeElement?.textContent).toBe('Delete')
  expect(ui.container.querySelector<HTMLElement>('[role="menu"]')!.style.right).toBe('0px')
  await run(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })) })
  expect(action).toHaveBeenCalledTimes(1)
  expect(button.getAttribute('aria-expanded')).toBe('false')
  ui.unmount()
})

it('keeps disabled hover out of navigation and focuses a one-item menu on an arrow key', async () => {
  const { ui, buttons, find, key } = setup()
  await run(() => buttons[0].click())
  await run(() => { find('Disabled').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
  await key('ArrowDown')
  expect(document.activeElement).toBe(find('Checked'))
  await key('Escape')
  ui.container.querySelector('input')!.focus()
  await run(() => buttons[1].click())
  await key('ArrowDown')
  expect(document.activeElement).toBe(find('Fit'))
  ui.unmount()
})
it('closes on Tab without preventing focus from leaving', async () => {
  const { ui, buttons, key } = setup()
  await run(() => buttons[0].click())
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  await run(() => { buttons[0].dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  ui.unmount()
})

it('ignores outside keys and closes when focus leaves the menu root', async () => {
  const { ui, buttons, key, action } = setup()
  await run(() => buttons[0].click())
  const input = ui.container.querySelector('input')!
  const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
  await run(() => { input.dispatchEvent(event) })
  expect(event.defaultPrevented).toBe(false)
  expect(action).not.toHaveBeenCalled()
  await key('ArrowDown', buttons[0])
  await run(() => input.focus())
  expect(document.activeElement).toBe(input)
  expect(ui.container.querySelector('[role="menu"]')).toBeNull()
  ui.unmount()
})
