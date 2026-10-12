// @vitest-environment happy-dom
import { useReducer } from 'react'
import { describe, expect, it } from 'vitest'
import { newPage, newProject } from '../model/project'
import { initialState, reducer, type Action } from '../model/store'
import { mount, run } from '../testing'
import { PageTabs } from './PageTabs'
import { SHAPES } from '../model/shapes'

// The real reducer behind the tabs, so a rename re-renders them; `log` records every dispatch.
const Harness = ({ log, one = false }: { log: Action[]; one?: boolean }) => {
  const [s, dispatch] = useReducer(reducer, undefined, () => {
    const p = newProject()
    return initialState(one ? p : { ...p, pages: [p.pages[0], { ...newPage(p), name: 'Tanks' }] })
  })
  return <PageTabs pages={s.project.pages} activeId={s.activePageId} dispatch={a => { log.push(a); dispatch(a) }} />
}

function setup(one = false) {
  const log: Action[] = []
  const ui = mount(<Harness log={log} one={one} />)
  const button = (text: string) => Array.from(ui.container.querySelectorAll('button')).find(b => (b.getAttribute('aria-label') ?? b.textContent) === text)!
  const input = () => ui.container.querySelector<HTMLInputElement>('input[aria-label="Page name"]')
  const key = (el: Element, k: string) => run(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) })
  return { log, ui, button, input, key }
}

describe('PageTabs', () => {
  it('shows Pages, the current page and each console shape', () => {
    const p = newProject()
    const ui = mount(<PageTabs pages={[p.pages[0], { ...newPage(p), shape: 'custom' }]} activeId="p1" dispatch={() => {}} />)
    try {
      expect(ui.container.querySelector('nav.vb-pages[aria-label="Pages"]')).not.toBeNull()
      const active = ui.container.querySelector('[aria-current="page"]')!
      expect(active.getAttribute('aria-pressed')).toBe('true')
      expect(active.textContent).toContain(SHAPES.square.label)
      expect(ui.container.querySelector('[aria-pressed="false"]')?.textContent).toContain('Custom')
    } finally { ui.unmount() }
  })
  it('shows the page a click picks', async () => {
    const { log, ui, button } = setup()
    await run(() => button('Tanks').click())
    expect(log).toEqual([{ type: 'setActivePage', pageId: 'p2' }])
    expect(button('Tanks').getAttribute('aria-pressed')).toBe('true')
    ui.unmount()
  })

  it('renames with F2 and Enter, and gives the focus back to the renamed tab (N1)', async () => {
    const { log, ui, button, input, key } = setup()
    await key(button('Tanks'), 'F2')
    expect(input()).not.toBeNull()
    expect(document.activeElement).toBe(input())
    input()!.value = 'Pumps'
    await key(input()!, 'Enter')
    expect(log).toEqual([{ type: 'renamePage', pageId: 'p2', name: 'Pumps' }])
    expect(input()).toBeNull()
    expect(document.activeElement).toBe(button('Pumps'))

    await key(button('Pumps'), 'F2')
    expect(document.activeElement).toBe(input())
    input()!.value = 'Valves'
    await key(input()!, 'Escape')
    // Escape puts the old name back and the blur renames to it: the reducer ignores the unchanged name.
    expect(log).toEqual([{ type: 'renamePage', pageId: 'p2', name: 'Pumps' }, { type: 'renamePage', pageId: 'p2', name: 'Pumps' }])
    const s = initialState()
    expect(reducer(s, { type: 'renamePage', pageId: 'p1', name: 'Main' })).toBe(s)
    expect(input()).toBeNull()
    expect(button('Valves')).toBeUndefined()
    expect(document.activeElement).toBe(button('Pumps'))
    ui.unmount()
  })

  it('cannot remove the only page', () => {
    const { ui, button } = setup(true)
    expect(button('Remove page Main').disabled).toBe(true)
    ui.unmount()
  })

  it('adds a page', async () => {
    const { log, ui } = setup()
    await run(() => ui.container.querySelector<HTMLButtonElement>('button[aria-label="Add page"]')!.click())
    expect(log).toEqual([{ type: 'addPage' }])
    expect(ui.container.querySelectorAll('button[aria-label^="Remove page"]')).toHaveLength(3)
    ui.unmount()
  })
})
