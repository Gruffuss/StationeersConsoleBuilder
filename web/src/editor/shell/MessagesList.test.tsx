// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount } from '../../testing'
import { MessagesList } from './MessagesList'
import type { Message } from './messages'

it('renders one sourced row and visible level chip per message without a live region', () => {
  const messages: Message[] = ['crit', 'warn', 'info', 'ok'].map(level => ({ level: level as Message['level'], source: 'Source', text: `Text ${level}` }))
  const ui = mount(<MessagesList messages={messages} />)
  expect(ui.container.querySelector('ul')!.className).toBe('vb-message-list')
  const rows = Array.from(ui.container.querySelectorAll('li'))
  expect(rows).toHaveLength(4)
  rows.forEach((row, k) => {
    const spans = row.querySelectorAll('span')
    expect(spans[0].className).toBe(`chip ${messages[k].level}`)
    expect(spans[0].textContent).toBe(messages[k].level.toUpperCase())
    expect(spans[1].className).toBe('unit')
    expect(spans[1].textContent).toBe('Source')
    expect(spans[2].textContent).toBe(messages[k].text)
    expect(spans[2].className).toBe(k === 0 ? 't-crit' : '')
  })
  expect(ui.container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  ui.unmount()
})
