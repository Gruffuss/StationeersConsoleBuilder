// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { loadCatalog } from '../catalog'
import { newProject } from '../model/project'
import { initialState, reducer } from '../model/store'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { vanillaPlus as t } from '../theme/vanillaPlus'
import { instance } from '../widgets/testing'
import { WidgetPanel } from './WidgetPanel'

function panel(kind: string, name: string, boundName = false) {
  const p = newProject()
  p.pages[0].natives = [{ ...instance('icon'), params: { ...instance('icon').params, kind, name } }]
  let state = initialState(p)
  const page = () => state.project.pages[0]
  const render = () => <WidgetPanel page={page()} pages={[]} widget={page().natives![0]} native boundName={boundName}
    checker={new SceneChecker(checkWorkers().make)} theme={t} themeNow={() => t} sceneOf={() => page().scene}
    pageNow={() => page()} dispatch={a => { state = reducer(state, a); ui.rerender(render()) }} />
  const ui = mount(render())
  const field = () => ui.container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="name"]')!
  return { ui, field, names: () => page().natives![0].params.name,
    options: () => Array.from(ui.container.querySelectorAll('datalist option'), e => e.getAttribute('value')),
    warning: () => ui.container.querySelector('[role=status]')?.textContent,
    type: (name: string) => run(() => {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field()), 'value')!.set!.call(field(), name)
      field().dispatchEvent(new Event('input', { bubbles: true }))
      field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }) }
}

it.each([['gas', 'Oxygen'], ['slot', 'Chip']])('offers %s catalogue keys in a name datalist', (kind, name) => {
  const h = panel(kind, name)
  expect(h.field()?.tagName).toBe('INPUT')
  expect((h.field() as HTMLInputElement).list?.id).toBeTruthy()
  expect(h.options()).toContain(name)
  h.ui.unmount()
})

it('offers prefab catalogue keys and known device prefab names', async () => {
  const h = panel('prefab', 'ActiveVent')
  await run(async () => { await loadCatalog() })
  expect(h.options()).toContain('ActiveVent')
  expect(h.options()).toContain('StructureGasSensor')
  h.ui.unmount()
})

it.each([['gas', 'O2', 'Oxygen'], ['gas', 'N2', 'Nitrogen'], ['gas', 'CH4', 'Methane'], ['gas', 'X', 'Pollutant'],
  ['gas', 'oxygen', 'Oxygen'], ['slot', 'chip', 'Chip'], ['slot', 'CustomSlot', undefined]])(
  'warns for %s name %s, suggests %s, and keeps the chosen value', async (kind, name, suggestion) => {
    const h = panel(kind, kind === 'gas' ? 'Oxygen' : 'Chip')
    await h.type(name)
    expect(h.names()).toBe(name)
    expect(h.warning()).toContain('not in the')
    if (suggestion) expect(h.warning()).toContain(suggestion)
    expect(h.ui.container.querySelector('[role=alert]')).toBeNull()
    await h.type(kind === 'gas' ? 'Oxygen' : 'Chip')
    expect(h.warning()).toBeUndefined()
    h.ui.unmount()
  })

it.each([['gas', 'CO2'], ['gas', 'gas:Oxygen'], ['slot', 'slot:ProgrammableChip'], ['prefab', 'CustomPrefab'], ['prefab', '-1234']])(
  'keeps %s name %s without a warning', (kind, name) => {
    const h = panel(kind, name)
    expect(h.warning()).toBeUndefined()
    expect(h.names()).toBe(name)
    h.ui.unmount()
  })

it('does not warn for an empty parked icon name', () => {
  const h = panel('gas', '')
  expect(h.warning()).toBeUndefined()
  h.ui.unmount()
})
it('does not warn about the static name when an icon name is bound', () => {
  const h = panel('gas', 'UnknownGas', true)
  expect(h.warning()).toBeUndefined()
  h.ui.unmount()
})
