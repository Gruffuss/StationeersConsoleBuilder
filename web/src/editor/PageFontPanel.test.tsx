// @vitest-environment happy-dom
import { expect, it, vi, beforeEach } from 'vitest'
import { mount, run } from '../testing'
import { initialState, reducer } from '../model/store'
import { parseSrc } from '../srctext/parse'
import { PageFontPanel } from './PageFontPanel'
import * as loader from './pageFonts'
vi.mock('./pageFonts', async original => ({ ...await original<typeof import('./pageFonts')>(), loadPageFonts: vi.fn(async () => {}) }))
beforeEach(() => vi.clearAllMocks())
it('uses the singular for one delivered face name', () => {
  const state = initialState(), page = state.project.pages[0]
  page.scene.defs = [{ op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Solo' } }]
  const spy = vi.spyOn(loader, 'getPageFontRecord').mockImplementation(link => ({ link, state: 'loaded', names: ['Solo'], subsetFailures: [], notice: '' }))
  const ui = mount(<PageFontPanel page={page} project={state.project} />)
  try { expect(ui.container.textContent).toContain('this link: 1 delivered face name'); expect(ui.container.textContent).not.toContain('1 delivered face names') }
  finally { ui.unmount(); spy.mockRestore() }
})
it('shows a chip for each declaration state and keeps its state word', () => {
  const state = initialState(), page = state.project.pages[0]
  const states = ['loaded', 'failed', 'refused', 'pending', undefined] as const
  page.scene.defs = states.map((_, i) => ({ op: 'FONT', attrs: { src: `https://fonts.googleapis.com/css2?family=State${i}` } }))
  const spy = vi.spyOn(loader, 'getPageFontRecord').mockImplementation(url => {
    const value = states[Number(url.slice(-1))]
    return value ? { link: url, state: value, names: [], subsetFailures: [], cause: '', notice: '' } : undefined
  })
  const ui = mount(<PageFontPanel page={page} project={state.project} />)
  try {
    expect(Array.from(ui.container.querySelectorAll('li .chip')).map(c => [c.textContent, c.className])).toEqual([
      ['loaded', 'chip ok'], ['failed', 'chip crit'], ['refused', 'chip crit'], ['pending', 'chip info'], ['not requested', 'chip idle'],
    ])
  } finally { ui.unmount(); spy.mockRestore() }
})
it('consents only on Add/Load, preserves duplicate declarations, and edits one history entry by index', async () => {
  let state = initialState()
  const parsed = parseSrc('DEFS {\n# keep\n FONT src="https://fonts.googleapis.com/css2?family=Inter"\n FONT src="https://fonts.googleapis.com/css2?family=Inter"\n GL id=keep\n }\n T text=x')
  expect(parsed.errors).toEqual([])
  state.project.pages[0].scene = parsed.scene!
  const draw = () => <PageFontPanel page={state.project.pages[0]} project={state.project} dispatch={a => { state = reducer(state, a); ui.rerender(draw()) }} />
  const ui = mount(draw())
  const button = (text: string) => Array.from(ui.container.querySelectorAll('button')).find(b => b.textContent === text)!
  const type = (text: string) => run(() => {
    const input = ui.container.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  try {
    expect(loader.loadPageFonts).not.toHaveBeenCalled()
    expect(ui.container.querySelectorAll('li')).toHaveLength(2)
    await run(() => button('Load this page\'s fonts').click())
    expect(loader.loadPageFonts).toHaveBeenCalledWith(['https://fonts.googleapis.com/css2?family=Inter'])
    await type('https://fonts.googleapis.com/css2?family=Inter')
    await run(() => button('Add').click())
    expect(state.past).toHaveLength(0)
    expect(ui.container.textContent).toContain('already declared')
    await type('https://blocked.example/font.ttf')
    await run(() => button('Add').click())
    expect(state.past).toHaveLength(1)
    expect(state.project.pages[0].scene.defs.at(-1)!.attrs.src).toBe('https://blocked.example/font.ttf')
    expect(loader.loadPageFonts).toHaveBeenLastCalledWith(['https://blocked.example/font.ttf'])
    await run(() => ui.container.querySelectorAll<HTMLButtonElement>('li button')[1].click())
    expect(state.past).toHaveLength(2)
    expect(state.project.pages[0].scene.defs.map(d => d.op)).toEqual(['FONT', 'GL', 'FONT'])
    state = reducer(state, { type: 'undo' })
    await run(() => ui.rerender(draw()))
    expect(state.project.pages[0].scene.defs.map(d => d.op)).toEqual(['FONT', 'FONT', 'GL', 'FONT'])
    expect(loader.loadPageFonts).toHaveBeenCalledTimes(2)
  } finally { ui.unmount() }
})
it('shows invalid and over-limit declarations without fetching or blocking them', () => {
  const state = initialState(), page = state.project.pages[0]
  page.scene.defs = Array.from({ length: 49 }, (_, i) => ({ op: 'font', attrs: { SRC: `bad${i}` } }))
  page.scene.defs.push({ op: 'FONT', attrs: { src: 5 } })
  const ui = mount(<PageFontPanel page={page} project={state.project} />)
  try {
    expect(ui.container.textContent).toContain('49 distinct FONT links')
    expect(ui.container.textContent).toContain('exceeds 48')
    expect(ui.container.querySelectorAll('li')).toHaveLength(50)
    expect(loader.loadPageFonts).not.toHaveBeenCalled()
    expect(ui.container.querySelector('button')!.disabled).toBe(false)
  } finally { ui.unmount() }
})
