// @vitest-environment happy-dom
import { useReducer } from 'react'
import { describe, expect, it } from 'vitest'
import { initialState, reducer, type Action, type State } from '../model/store'
import { mount, run } from '../testing'
import { PageShape } from './PageShape'
import { SIZES } from '../model/shapes'

// The real reducer behind the control, showing the active page; `log` records the control's dispatches, and `api` lets a
// test act as the rest of the editor (undo, a page switch) and read the state.
const api = {} as { dispatch: (a: Action) => void; state: State }
const Harness = ({ log, init }: { log: Action[]; init: State }) => {
  const [s, dispatch] = useReducer(reducer, init)
  Object.assign(api, { dispatch, state: s })
  return <PageShape page={s.project.pages.find(p => p.id === s.activePageId)!} dispatch={a => { log.push(a); dispatch(a) }} />
}

const shape = (pageId: string, shape: 'custom' | '2x1', size?: { w: number; h: number }): Action => ({ type: 'setPageShape', pageId, shape, size })

function setup(init = initialState()) {
  const log: Action[] = []
  const ui = mount(<Harness log={log} init={init} />)
  const select = ui.container.querySelector<HTMLSelectElement>('select[aria-label="Console size"]')!
  const choose = (value: string) => run(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const input = (label: 'Width (px)' | 'Height (px)') => ui.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
  const shown = () => [input('Width (px)')?.value, input('Height (px)')?.value]
  // Types into a controlled input as a user does: past React's value tracker, then an input event.
  const type = (label: 'Width (px)' | 'Height (px)', value: string) => run(() => {
    const el = input(label)!
    el.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const blur = () => run(() => (document.activeElement as HTMLElement).blur())
  return { log, ui, select, choose, input, shown, type, blur }
}

describe('PageShape', () => {
  it('dispatches the shape chosen', async () => {
    const { log, ui, choose } = setup()
    await choose('2x1')
    expect(log).toEqual([expect.objectContaining({ type: 'setPageShape', pageId: 'p1', shape: '2x1' })])
    ui.unmount()
  })

  it('shows a width and a height for Custom without touching the page, and dispatches them on blur', async () => {
    const { log, ui, select, choose, input, shown, type, blur } = setup()
    await choose('2x1')
    expect(input('Width (px)')).toBeNull()
    await choose('custom')
    expect(log).toHaveLength(1)   // the 2×1 only: choosing Custom keeps the shape, its 1080 × 480 units and the history
    expect(api.state.project.pages[0]).toMatchObject({ shape: '2x1', scene: { header: { w: 1080, h: 480 } } })
    expect(select.value).toBe('custom')
    expect([input('Width (px)')!.type, input('Height (px)')!.type]).toEqual(['number', 'number'])
    expect(shown()).toEqual(['1036', '460'])
    await type('Width (px)', '800')
    await type('Height (px)', '400')
    await blur()
    expect(log.at(-1)).toEqual(shape('p1', 'custom', { w: 800, h: 400 }))
    expect(api.state.project.pages[0].scene.header).toMatchObject({ w: 960, h: 480 })
    ui.unmount()
  })

  it('commits a custom size on Enter', async () => {
    const { log, ui, choose, type } = setup()
    await choose('custom')
    await type('Height (px)', '300')
    await run(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(log.at(-1)).toEqual(shape('p1', 'custom', { w: 460, h: 300 }))
    ui.unmount()
  })

  it("keeps an emptied field's value", async () => {
    const { log, ui, choose, type, blur } = setup()
    await choose('custom')
    await type('Width (px)', '')
    await type('Height (px)', '300')
    await blur()
    expect(log.at(-1)).toEqual(shape('p1', 'custom', { w: 460, h: 300 }))
    ui.unmount()
  })

  it('shows the size the store keeps after a clamp, even when the clamp changes nothing', async () => {
    const { ui, choose, shown, type, blur } = setup()
    await choose('custom')
    await type('Width (px)', '9000')
    await blur()
    expect(shown()).toEqual(['8192', '460'])
    await type('Width (px)', '99999')   // clamps to the 8192 the page has: the store does nothing
    await blur()
    expect(shown()).toEqual(['8192', '460'])
    await type('Height (px)', '460.4')
    await blur()
    expect(shown()).toEqual(['8192', '460'])
    ui.unmount()
  })

  it('shows the page size again on an undo and on a switch to another custom page', async () => {
    const init = ([{ type: 'addPage' }, shape('p1', 'custom', { w: 800, h: 400 }), shape('p2', 'custom', { w: 300, h: 200 }),
      { type: 'setActivePage', pageId: 'p1' }] as Action[]).reduce(reducer, initialState())
    const { ui, shown, type, blur } = setup(init)
    expect(shown()).toEqual(['800', '400'])
    await type('Width (px)', '900')
    await blur()
    expect(shown()).toEqual(['900', '400'])
    await run(() => api.dispatch({ type: 'undo' }))
    expect(shown()).toEqual(['800', '400'])
    await run(() => api.dispatch({ type: 'setActivePage', pageId: 'p2' }))
    expect(shown()).toEqual(['300', '200'])
    ui.unmount()
  })

  it('offers the sizes, not the models, and sets a chosen size by its representative model', async () => {
    const { ui, select, choose } = setup()
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([...SIZES.map(s => [s.keys[0], s.label]), ['custom', 'Custom']])
    const page = () => api.state.project.pages[0]
    await choose('v3x2')
    expect([select.value, page().shape, page().size, page().scene.header]).toEqual(['v3x2', 'v3x2', { w: 460, h: 714 }, { w: 960, h: 1490, fit: 'contain' }])
    await choose('vmonitor')
    expect([select.value, page().shape, page().size, page().scene.header]).toEqual(['vmonitor', 'vmonitor', { w: 460, h: 943 }, { w: 480, h: 984, fit: 'contain' }])
    ui.unmount()
  })

  it("shows a page on any model of a size as that size, keeping the page's own model", async () => {
    const start = initialState(), id = start.project.pages[0].id
    const { log, ui, select, choose } = setup(reducer(start, { type: 'setPageShape', pageId: id, shape: '3x3-lcm' }))
    expect([select.value, select.selectedOptions[0].textContent]).toEqual(['3x3', '3×3'])
    expect(api.state.project.pages[0].shape).toBe('3x3-lcm')
    await choose('2x2')
    expect(log).toEqual([{ type: 'setPageShape', pageId: id, shape: '2x2', size: { w: 460, h: 460 } }])
    ui.unmount()
  })

  it('marks the Air Conditioner face beta', () => {
    const { ui, select } = setup()
    expect(Array.from(select.options).find(o => o.value === 'ac')!.textContent).toContain('(beta)')
    ui.unmount()
  })
})
