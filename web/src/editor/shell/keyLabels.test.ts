import { expect, it } from 'vitest'
import { keyLabel, keysLabel } from './keyLabels'

it.each([
  ['Mod+Shift+Z', 'Ctrl+Shift+Z'], ['Delete', 'Del'], ['Escape', 'Esc'],
  ['Shift+ArrowUp', 'Shift+↑'], ['Mod+]', 'Ctrl+]'], ['ArrowLeft', '←'],
  ['ArrowRight', '→'], ['ArrowDown', '↓'], ['Enter', 'Enter'], ['Mod++', 'Ctrl++'],
])('displays %s as %s', (name, label) => expect(keyLabel(name)).toBe(label))

it('shows every key and leaves absent keys empty', () => {
  expect(keysLabel(['Mod+Shift+Z', 'Mod+Y'])).toBe('Ctrl+Shift+Z · Ctrl+Y')
  expect(keysLabel()).toBe('')
  expect(keysLabel([])).toBe('')
})
