// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { newProject } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { mount, run } from '../testing'
import { CustomLuaPane } from './CustomLuaPane'

it('shows the hooks disclosure and draft helper around the code textarea', () => {
  const ui = mount(<CustomLuaPane project={newProject()} dispatch={() => {}} />)
  try {
    const hooks = ui.container.querySelector<HTMLDetailsElement>('details.disc')!
    expect(hooks.open).toBe(true)
    expect(hooks.querySelector('summary')!.textContent).toBe('Hooks and names')
    expect(hooks.textContent).toContain('U.before_reads(dt)')
    expect(ui.container.querySelector('h2.ptitle')!.textContent).toBe('Custom Lua')
    expect(ui.container.textContent).toContain('Kept as written between markers in the export.')
    expect(ui.container.textContent).toContain('Typing stays a draft; leaving the editor commits it as one undo step.')
    expect(ui.container.querySelector('textarea.area')).not.toBeNull()
  } finally { ui.unmount() }
})

describe('CustomLuaPane', () => {
  it('edits the custom block as transient steps and commits one undo step on blur; names the API', async () => {
    const actions: Action[] = []
    const ui = mount(<CustomLuaPane project={{ ...newProject(), customLua: 'U.x = 1' }} dispatch={a => actions.push(a)} />)
    const area = ui.container.querySelector('textarea')!
    await run(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'U.x = 2')
      area.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await run(() => { area.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(actions).toEqual([{ type: 'setLogic', patch: { customLua: 'U.x = 2' }, transient: true }, { type: 'commitDrag' }])
    expect(ui.container.textContent).toContain('U.before_reads(dt)')
    ui.unmount()
  })
  it('groups a typing burst for undo and redo, preserves Lua verbatim and treats the code as text', async () => {
    let s = initialState({ ...newProject(), customLua: 'U.x = 1' })
    const dispatch = (a: Action) => { s = reducer(s, a) }
    const ui = mount(<CustomLuaPane project={s.project} dispatch={dispatch} />)
    const render = () => ui.rerender(<CustomLuaPane project={s.project} dispatch={dispatch} />)
    const area = ui.container.querySelector('textarea')!
    const type = async (text: string) => {
      await run(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, text)
        area.dispatchEvent(new Event('input', { bubbles: true }))
      })
      render()
    }
    await type('U.x = 2')
    const lua = '-- <script>alert(1)</script>\nU.x = "λ"\n'
    await type(lua)
    expect(s.past).toHaveLength(0)
    expect(s.project.customLua).toBe(lua)
    expect(ui.container.querySelector('script')).toBeNull()
    await run(() => { area.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(s.past).toHaveLength(1)
    s = reducer(s, { type: 'undo' })
    render()
    expect(area.value).toBe('U.x = 1')
    s = reducer(s, { type: 'redo' })
    render()
    expect(area.value).toBe(lua)
    ui.unmount()
  })
})
