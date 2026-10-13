// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { parseSrc } from '../srctext/parse'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { gasColours, ROLES, THEMES, themeOf } from '../theme'
import { linksOf } from '../theme/links'
import { PropertyPanel } from './PropertyPanel'
import { MenuButton } from '../ui/Menu'

let ui: ReturnType<typeof mount> | undefined
it('puts recent and gradient choices directly in the colour panel with no nested dropdown', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.click('Fill colour panel')
  expect(ui!.container.querySelector('.vb-colour-panel select')).toBeNull()
  await h.click('Fill New gradient')
  expect(ui!.container.querySelector('.vb-colour-panel .vb-colour-panel')).toBeNull()
})
afterEach(async () => {
  await run(() => ui?.container.querySelector<HTMLButtonElement>('[aria-label="Discard pending picker colours"]')?.click())
  ui?.unmount(); ui = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear()
})
const settle = () => new Promise(r => setTimeout(r, 0))

it('opens the three mounted colour tabs, links a theme radio and closes without an edit', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  const toggle = ui!.container.querySelector<HTMLButtonElement>('[aria-label="Fill colour panel"]')!
  expect(toggle).not.toBeNull()
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  const colour = h.get('Fill colour')
  await h.click('Fill colour panel')
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  const tabs = ui!.container.querySelector('[role=tablist][aria-label="Fill colour"]')!
  expect(Array.from(tabs.querySelectorAll('button'), b => b.textContent)).toEqual(['Theme', 'Custom', 'Gradient'])
  const swatches = ui!.container.querySelector('[role=radiogroup][aria-label="Fill theme swatch"]')!
  expect(swatches).not.toBeNull()
  expect(swatches.textContent).toContain('UI roles')
  await run(async () => { swatches.querySelector<HTMLButtonElement>('[role=radio][aria-label=accent]')!.click(); await settle() })
  expect(h.node().attrs.f).toBe(h.theme.colors.accent)
  expect(linksOf(h.node())).toEqual({ f: { role: 'accent' } })
  await run(() => Array.from(tabs.querySelectorAll('button')).find(b => b.textContent === 'Custom')!.click())
  expect(h.get('Fill colour')).toBe(colour)
  await run(() => { colour.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(h.get('Fill colour')).toBe(colour)
  expect(h.state().past).toHaveLength(1)
})

it('shows pending picker colours inside the Custom tab', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.edit('Fill colour', '#273849', false)
  const pane = h.get('Fill colour').closest('[role=tabpanel]')!
  expect(pane).not.toBeNull()
  expect(pane.textContent).toContain('Pending picker colours: #273849')
  expect(pane.querySelector('[aria-label="Discard pending picker colours"]')).not.toBeNull()
  expect(h.state().past).toHaveLength(0)
  await h.click('Discard pending picker colours')
})

it.each(['Escape', 'swatch'])('closes with %s, returns focus and keeps the pending picker draft without committing', async close => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.edit('Fill colour', '#456789', false)
  const picker = h.get('Fill colour'), toggle = h.get('Fill colour panel')
  await run(() => picker.focus())
  if (close === 'Escape') await run(() => { picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  else await h.click('Fill colour panel')
  expect(document.activeElement).toBe(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(picker.value).toBe('#456789')
  expect(h.node().attrs.f).toBe('#ffffff')
  expect(h.state().past).toHaveLength(0)
  await h.click('Discard pending picker colours')
})

it('offers one theme radio tab stop and chooses the next role with an arrow key', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.click('Fill colour panel')
  const group = h.get('Fill theme swatch')
  const radios = group.querySelectorAll<HTMLButtonElement>('[role=radio]')
  expect(Array.from(radios).filter(radio => radio.tabIndex === 0)).toHaveLength(1)
  await run(async () => {
    radios[0].focus()
    radios[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await settle()
  })
  expect(document.activeElement).toBe(radios[1])
  expect(linksOf(h.node())).toEqual({ f: { role: 'surface-screen' } })
  expect(h.state().past).toHaveLength(1)
})

it.each(['hex', 'alpha'])('keeps the %s text draft when the colour panel closes and reopens', async field => {
  const h = panel('R w=100 h=40 f=#ffffff')
  const label = `Fill ${field}`, text = field === 'hex' ? '#123456' : '0.5'
  await h.edit(label, text, false)
  await run(() => h.get(label).focus())
  await run(() => { h.get(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(h.node().attrs.f).toBe('#ffffff')
  expect(h.state().past).toHaveLength(0)
  await h.click('Fill colour panel')
  expect(h.get(label).value).toBe(text)
})
function panel(src: string, themeId?: string, withBar = false) {
  const project = newProject(); project.pages[0].scene = parseSrc('SCENE w=460 h=460\n' + src).scene!
  if (themeId) project.theme = themeId
  let state = initialState(project)
  let path = [0]
  const checker = new SceneChecker(checkWorkers().make), theme = themeOf(project)
  const draw = () => <>{withBar && <MenuButton label="Edit" items={() => []} />}<PropertyPanel page={state.project.pages[0]} selection={{ pageId: 'p1', path }} theme={theme}
    checker={checker} sceneOf={() => state.project.pages[0].scene} dispatch={a => { state = reducer(state, a) }} /></>
  ui = mount(draw())
  const get = (label: string) => {
    const el = ui!.container.querySelector<HTMLInputElement | HTMLSelectElement>(`input[aria-label="${label}"], select[aria-label="${label}"], button[aria-label="${label}"], [role=radiogroup][aria-label="${label}"]`)
    expect(el, label).not.toBeNull(); return el!
  }
  const update = () => ui!.rerender(draw())
  return { get, theme, select: (next: number[]) => run(() => { path = next; update() }), state: () => state, node: () => state.project.pages[0].scene.root[0],
    text: () => ui!.container.textContent,
    edit: (label: string, text: string, finish = true) => run(async () => {
      const el = get(label)
      const colour = el.closest('.vb-colour-fields')
      if (colour) {
        const toggle = colour.querySelector<HTMLButtonElement>(':scope > button')!
        if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
        const tab = label.endsWith('theme swatch') ? 'Theme' : 'Custom'
        Array.from(colour.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(b => b.textContent === tab)!.click()
      }
      if (el.getAttribute('role') === 'radiogroup') {
        const radio = el.querySelector<HTMLButtonElement>(`[role=radio][aria-label="${text}"]`)!
        const gas = radio.closest('details'); if (gas) gas.open = true
        radio.click(); await settle(); update(); return
      }
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, text)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement || el.type === 'color' ? 'change' : 'input', { bubbles: true }))
      if (!(el instanceof HTMLSelectElement) && finish) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await settle(); update()
    }),
    click: (label: string) => run(async () => { (get(label) as unknown as HTMLButtonElement).click(); await settle(); update() }),
  }
}
it.each(['8,4', '8 4', ' 8, 4 ', '8\t4', '[8,4]'])('accepts dash list %s on Enter as the same array', async text => {
  const h = panel('R w=100 h=40 s=#ffffff dash=[6,4]')
  await h.edit('Dash pattern', text)
  expect(h.node().attrs.dash).toEqual([8, 4])
  expect(h.state().past).toHaveLength(1)
  await h.click('Animate dash')
  expect(h.node().attrs.dofs).toBe('=mod(t*20,12)')
})
it.each(['8,,4', '8,', ',4', '8 four', '8 -4', '8 Infinity', '8 1e99', '8;4', '[[8,4]]'])('reads or reports dash list %s with a readable reason', async text => {
  const h = panel('R w=100 h=40 s=#ffffff dash=[6,4]')
  await h.edit('Dash pattern', text)
  if (text === '8 -4') {
    expect(h.node().attrs.dash).toEqual([8, -4]); expect(h.state().past).toHaveLength(1)
    expect(h.text()).not.toContain('Dash entries must be finite')
    return
  }
  expect(h.node().attrs.dash).toEqual([6, 4])
  expect(h.state().past).toHaveLength(0)
  expect(h.text()).toContain('Dash entries must be finite numbers, separated by commas or spaces')
})
it('keeps the final pending picker colour visible after the Edit menu and a selection change', async () => {
  const h = panel('R w=100 h=40 f=#ffffff\nR x=120 w=100 h=40 f="=$colour"', undefined, true)
  await run(() => h.get('Fill colour').focus())
  await h.edit('Fill colour', '#445566', false)
  await h.edit('Fill colour', '#778899', false)
  await run(() => {
    const commands = Array.from(ui!.container.querySelectorAll('button')).find(b => b.textContent === 'Edit')!
    commands.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); commands.click()
  })
  await h.select([1])
  expect(h.text()).toContain('Pending picker colours: #778899')
  expect(h.get('Fill recent colours').querySelector('[role=radio][aria-label="#778899"]')).toBeTruthy()
  expect(h.state().project.pages[0].scene.root[1].attrs.f).toBe('=$colour')
  expect(h.state().past).toHaveLength(0)
  expect(localStorage.getItem('vb.recentColours')).toBeNull()
  await h.edit('Fill recent colours', '#778899')
  expect(h.state().project.pages[0].scene.root[1].attrs.f).toBe('#778899')
  expect(h.node().attrs.f).toBe('#ffffff')
  expect(h.state().past).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('vb.recentColours')!)).toEqual(['#778899'])
  expect(h.text()).not.toContain('Pending picker colours:')
})
it('discards a pending colour without committing it on blur', async () => {
  const h = panel('R w=100 h=40 f=#ffffff', undefined, true)
  await run(() => h.get('Fill colour').focus())
  await h.edit('Fill colour', '#314159', false)
  await run(() => {
    const discard = h.get('Discard pending picker colours')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    discard.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    discard.click()
  })
  expect(h.get('Fill colour').value).toBe('#ffffff')
  await run(() => h.get('Fill colour').blur())
  expect(h.node().attrs.f).toBe('#ffffff'); expect(h.state().past).toHaveLength(0)
})

it('commits colour and alpha through the real panel, one undo step each', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.edit('Fill colour', '#123456')
  expect(h.node().attrs.f).toBe('#123456'); expect(h.state().past).toHaveLength(1)
  await h.edit('Fill alpha', '0.5')
  expect(h.node().attrs.f).toBe('#12345680'); expect(h.state().past).toHaveLength(2)
  expect(JSON.parse(localStorage.getItem('vb.recentColours')!)).toEqual(['#12345680', '#123456'])
})
it('commits a picker burst once on blur, keeping only its final colour in recents', async () => {
  localStorage.setItem('vb.recentColours', JSON.stringify(['#abcdef']))
  const h = panel('R w=100 h=40 f=#ffffff80')
  const picker = h.get('Fill colour') as HTMLInputElement
  await run(() => picker.focus())
  for (const colour of ['#112233', '#445566', '#778899']) await h.edit('Fill colour', colour, false)
  expect(h.node().attrs.f).toBe('#ffffff80')
  expect(h.state().past).toHaveLength(0)
  expect(JSON.parse(localStorage.getItem('vb.recentColours')!)).toEqual(['#abcdef'])
  await run(async () => { picker.blur(); await settle() })
  expect(h.node().attrs.f).toBe('#77889980')
  expect(h.state().past).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem('vb.recentColours')!)).toEqual(['#77889980', '#abcdef'])
  const restored = reducer(h.state(), { type: 'undo' })
  expect(restored.project.pages[0].scene.root[0].attrs.f).toBe('#ffffff80')
})
it.each(Object.keys(THEMES))('selects a token with its style link and lists every %s swatch', async themeId => {
  const h = panel('R w=100 h=40 f=#123456', themeId)
  const swatches = h.get('Fill theme swatch')
  // The theme'Stroke own colours, then every shared game gas colour once: 39 gases' fills and symbol inks and 13 split halves.
  const own = Object.keys(THEMES[themeId].colors).filter(k => !Object.hasOwn(gasColours, k))
  const offered = Array.from(swatches.querySelectorAll('[role=radio]'), o => o.getAttribute('aria-label'))
  expect(offered).toEqual([...ROLES, ...own.filter(k => !ROLES.includes(k)), ...Object.keys(gasColours)])
  expect(offered).toHaveLength(own.length + 91)
  expect(own).toHaveLength(themeId === 'neutral' ? 26 : 43)
  if (themeId === 'neutral') expect(own).toEqual(ROLES)
  await h.edit('Fill theme swatch', 'accent')
  expect(h.node().attrs.f).toBe(h.theme.colors.accent)
  expect(linksOf(h.node())).toEqual({ f: { role: 'accent' } })
  expect(h.get('Fill')).toBeTruthy(); expect(h.get('Fill colour')).toBeTruthy()
})
it.each(Object.keys(THEMES))('offers shared gas halves and inks as linked %s swatches', async themeId => {
  const h = panel('R w=100 h=40 f=#123456', themeId)
  const swatches = h.get('Fill theme swatch')
  for (const name of ['gas.Oxygen', 'gas.Hydrogen', 'gas.Hydrogen.2', 'gas.Hydrogen.ink', 'gas.LiquidHydrogen.2']) {
    expect(Array.from(swatches.querySelectorAll('[role=radio]'), o => o.getAttribute('aria-label'))).toContain(name)
  }
  await h.edit('Fill theme swatch', 'gas.Hydrogen.2')
  expect(h.node().attrs.f).toBe('#8F8F8F')
  expect(linksOf(h.node())).toEqual({ f: { role: 'gas.Hydrogen.2' } })
})
it('animates dash offset and stops at t zero, one undo step for each', async () => {
  const h = panel('L p=[0,0,100,0] s=#ffffff dash=[6,4]')
  await h.edit('Dash speed', '20'); expect(h.state().past).toHaveLength(0)
  await h.click('Animate dash')
  expect(h.node().attrs.dofs).toBe('=mod(t*20,10)'); expect(h.state().past).toHaveLength(1)
  await h.click('Stop dash')
  expect(h.node().attrs.dofs).toBe(0); expect(h.state().past).toHaveLength(2)
})
it('stops only its known animation at the chosen t, preserving an arbitrary expression', async () => {
  const h = panel('L p=[0,0,100,0] s=#ffffff dash=[6,4] dofs="=mod(t*20,10)"')
  await h.edit('Stop time t', '1.1'); await h.click('Stop dash')
  expect(h.node().attrs.dofs).toBe(2)
  await run(() => { ui?.unmount(); ui = undefined })
  const x = panel('L p=[0,0,100,0] s=#ffffff dash=[6,4] dofs="=sin(t)"')
  expect((x.get('Stop dash') as unknown as HTMLButtonElement).disabled).toBe(true)
  expect(x.node().attrs.dofs).toBe('=sin(t)')
})
it('adds, edits, moves and removes shadow rows in single undo steps', async () => {
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.click('Add shadow'); await h.edit('Shadow 1 Offset X', '3'); await h.click('Add shadow')
  await h.edit('Shadow 2 Offset X', '8'); await h.click('Shadow 2 up')
  expect((h.node().attrs.sh as unknown[][]).map(x => x[0])).toEqual([8, 3])
  expect(h.state().past).toHaveLength(5)
  await h.click('Shadow 1 inset')
  expect((h.node().attrs.sh as unknown[][])[0][5]).toBe('inset')
  await h.click('Shadow 1 down'); await h.click('Shadow 2 remove')
  expect((h.node().attrs.sh as unknown[][]).map(x => x[0])).toEqual([3])
})
it('retains an expression paint until a literal is deliberately committed', async () => {
  const h = panel('R w=100 h=40 f="=if(1,#ffffff,#000000)"')
  expect(h.get('Fill').value).toBe('=if(1,#ffffff,#000000)')
  expect(h.state().past).toHaveLength(0)
  expect((h.get('Fill alpha') as HTMLInputElement).disabled).toBe(true)
  await h.edit('Fill hex', '#123456')
  expect(h.node().attrs.f).toBe('#123456'); expect(h.state().past).toHaveLength(1)
})
it('hides ml for round joins and explains the clamped miter', async () => {
  const h = panel('R w=100 h=40 s=#ffffff join=round')
  expect(ui!.container.querySelector('[aria-label="Sharp corner limit"]')).toBeNull()
  expect(h.text()).toContain('clamped miter')
  await h.edit('Line corners', 'miter'); expect(h.get('Sharp corner limit')).toBeTruthy()
})
it('keeps valid recent colours for the session when browser storage refuses a write', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('refused') })
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.edit('Fill colour', '#654321')
  expect(h.node().attrs.f).toBe('#654321')
  expect(h.get('Fill recent colours').querySelector('[role=radio][aria-label="#654321"]')).toBeTruthy()
})
it('keeps new session recents on remount when stored recents remain readable but writes fail', async () => {
  localStorage.setItem('vb.recentColours', JSON.stringify(['#abcdef']))
  const storage = localStorage
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.getItem(key), setItem() { throw Error('refused') } })
  const h = panel('R w=100 h=40 f=#ffffff')
  await h.edit('Fill hex', '#fedcba')
  expect(storage.getItem('vb.recentColours')).toBe('["#abcdef"]')
  ui!.unmount(); ui = undefined
  const remounted = panel('R w=100 h=40 f=#ffffff')
  expect(remounted.get('Fill recent colours').querySelector('[role=radio][aria-label="#fedcba"]')).toBeTruthy()
  expect(remounted.get('Fill recent colours').querySelector('[role=radio][aria-label="#abcdef"]')).toBeTruthy()
})
it('updates mounted stroke and gradient-stop recents when a fill colour is chosen', async () => {
  const h = panel('DEFS { GL id=mine stops=[[0,#ffffff],[1,#000000]] }\nR w=100 h=40 f=#ffffff s=@mine')
  await h.edit('Fill hex', '#102030')
  for (const label of ['Stroke recent colours', 'Stroke Stop 1 recent colours'])
    expect(h.get(label).querySelector('[role=radio][aria-label="#102030"]')).toBeTruthy()
})
it('limits recent literals to 12 and rejects invalid alpha and nonfinite speed', async () => {
  localStorage.setItem('vb.recentColours', JSON.stringify(['__proto__', '#123456', ...Array.from({length: 14}, (_, i) => '#' + i.toString(16).padStart(6, '0'))]))
  const h = panel('R w=100 h=40 f=#123456 s=#ffffff dash=[6,4]')
  expect(h.get('Fill recent colours').querySelectorAll('[role=radio]')).toHaveLength(12)
  await h.edit('Fill alpha', '2'); expect(h.node().attrs.f).toBe('#123456')
  await h.edit('Dash speed', 'Infinity'); await h.click('Animate dash')
  expect(h.node().attrs.dofs).toBeUndefined(); expect(h.state().past).toHaveLength(0)
})
it('reads group paint by its exact key rather than a stray uppercase key', async () => {
  const h = panel('G F=#ff0000 f=#00ff00 s_=#ffffff { R w=100 h=40 }')
  expect(h.get('Fill colour').value).toBe('#00ff00')
  await h.edit('Stroke colour', '#123456'); expect(h.node().attrs.s_).toBe('#123456')
  expect(h.node().attrs.F).toBe('#ff0000')
})
it('recent literals from different paint keys share the browser list', async () => {
  localStorage.setItem('vb.recentColours', '[]')
  const h = panel('R w=100 h=40 f=#ffffff s=#ffffff')
  await h.edit('Fill colour', '#aabbcc'); await h.edit('Stroke colour', '#ddeeff')
  expect(JSON.parse(localStorage.getItem('vb.recentColours')!)).toEqual(['#ddeeff', '#aabbcc'])
})
it.each([['[5]', 10], ['[2,3,4]', 18]])('animates odd dash %s with its true period %s', async (dash, period) => {
  const h = panel(`L p=[0,0,100,0] s=#ffffff dash=${dash}`)
  await h.click('Animate dash')
  expect(h.node().attrs.dofs).toBe(`=mod(t*20,${period})`)
})
it('animates a negative dash entry as zero without changing the stored pattern', async () => {
  const h = panel('L p=[0,0,100,0] s=#ffffff dash=[6,-4]')
  expect((h.get('Animate dash') as unknown as HTMLButtonElement).disabled).toBe(false)
  await h.click('Animate dash')
  expect(h.node().attrs.dofs).toBe('=mod(t*20,6)')
  expect(h.node().attrs.dash).toEqual([6, -4]); expect(h.state().past).toHaveLength(1)
})
it('stores a negative dash entry, which the mod counts as zero', async () => {
  const h = panel('L p=[0,0,100,0] s=#ffffff dash=[6,4]')
  await h.edit('Dash pattern', '[6,-4]')
  expect(h.node().attrs.dash).toEqual([6,-4]); expect(h.state().past).toHaveLength(1)
  expect(h.text()).not.toContain('Dash entries must be finite')
})
it('renders and preserves the flat single-shadow form when adding another shadow', async () => {
  const h = panel('R w=100 h=40 f=#ffffff sh=[8,4,6,0,#112233]')
  expect(h.get('Shadow 1 Offset X').value).toBe('8')
  await h.click('Add shadow')
  expect(h.node().attrs.sh).toEqual([[8, 4, 6, 0, '#112233'], [0, 0, 4, 0, '#00000080']])
  expect(h.state().past).toHaveLength(1)
})
