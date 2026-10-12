// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
import { mount, run } from '../../testing'
import { useReducer } from 'react'
import { initialState, reducer, type Action, type State } from '../../model/store'
import { newProject } from '../../model/project'
import { PageSettings } from './PageSettings'

it('trims changed names, restores Escape, ignores empty names and protects the last page', async () => {
  const page = newProject().pages[0], dispatch = vi.fn(), ui = mount(<PageSettings page={page} pages={[page]} dispatch={dispatch}>Pictures</PageSettings>)
  const input = ui.container.querySelector<HTMLInputElement>('[aria-label="Name"]')!
  const type = async (text: string, key: string) => {
    await run(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })) })
    await run(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
  }
  try {
    await type('  Renamed  ', 'Enter'); expect(dispatch).toHaveBeenLastCalledWith({ type: 'renamePage', pageId: page.id, name: 'Renamed' })
    dispatch.mockClear(); await type('discarded', 'Escape'); expect(input.value).toBe(page.name); expect(dispatch).not.toHaveBeenCalled()
    await type('  ', 'Enter'); expect(dispatch).not.toHaveBeenCalled()
    expect(ui.container.querySelector<HTMLButtonElement>('[aria-label="Remove this page"]')!.disabled).toBe(true)
    expect(ui.container.textContent).toContain('460 × 460 px preview · 480 × 480 design units')
  } finally { ui.unmount() }
})

it('sets No background in one undo step and accepts a colour again', async () => {
  let state!: State
  let dispatch!: (a: Action) => void
  const log: Action[] = []
  function Harness() {
    const [s, send] = useReducer(reducer, initialState())
    state = s; dispatch = send
    return <PageSettings page={s.project.pages[0]} pages={s.project.pages} dispatch={a => { log.push(a); send(a) }}>Pictures</PageSettings>
  }
  const ui = mount(<Harness />), original = state.project.pages[0].background
  try {
    const mode = ui.container.querySelector<HTMLSelectElement>('[aria-label="Page background"]')
    expect(mode).not.toBeNull()
    expect(Array.from(mode!.options).map(o => o.textContent)).toContain('No background')
    await run(() => { mode!.value = 'none'; mode!.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(state.project.pages[0].background).toBeUndefined()
    expect(log).toEqual([{ type: 'setPageBackground', pageId: 'p1', background: undefined }])
    expect(state.past).toHaveLength(1)
    await run(() => dispatch({ type: 'undo' }))
    expect(state.project.pages[0].background).toEqual(original)
    await run(() => dispatch({ type: 'redo' }))
    expect(state.project.pages[0].background).toBeUndefined()
    await run(() => ui.container.querySelector<HTMLButtonElement>('[aria-label="Background colour panel"]')!.click())
    const hex = ui.container.querySelector<HTMLInputElement>('[aria-label="Background hex"]')!
    await run(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(hex, '#12345678')
      hex.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await run(() => { hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(state.project.pages[0].background).toEqual(['#12345678'])
    expect(state.past).toHaveLength(2)
    await run(() => dispatch({ type: 'undo' }))
    expect(state.project.pages[0].background).toBeUndefined()
  } finally { ui.unmount() }
})
