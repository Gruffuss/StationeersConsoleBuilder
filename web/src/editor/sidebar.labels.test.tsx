// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { mount, run } from '../testing'
import { controlNames } from '../ui/testing'
import { newPage, newProject } from '../model/project'
import { node } from '../model/testing'
import { harness } from '../editing/testing'
import { putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { PageTabs } from './PageTabs'
import { Layers } from './Layers'
import { WidgetPalette } from './WidgetPalette'
import { Breadcrumb } from './Breadcrumb'

it('keeps the starting pages, expanded layers, widgets and selection path controls', async () => {
  const project = newProject()
  project.pages.push({ ...newPage(project), name: 'Tanks' })
  project.pages.push({ ...newPage(project), name: 'Power', shape: 'custom' })
  const pageUi = mount(<PageTabs pages={project.pages} activeId="p1" dispatch={() => {}} />)
  const drawn = putWidget({ header: {}, defs: [], root: [] }, instance('panel'), vanillaPlus)
  const scene = { ...drawn, root: [node('G', { id: 'outer' }, [node('G', { id: 'inner' }, [node('R', { id: 'box' })])]),
    ...drawn.root, node('R', { id: 'hidden', v: 0 }), { ...node('T', { id: 'locked' }), comments: ['lock'] }], defs: [node('GL', { id: 'paint' })] }
  const h = harness(scene), selection = { pageId: 'p1', path: [0, 0, 0] }, entered = { pageId: 'p1', path: [0, 0] }
  const layerUi = mount(<Layers page={h.ctx.page()} selection={selection} also={[]} entered={entered} dispatch={h.ctx.dispatch} ctx={h.ctx} />)
  const paletteUi = mount(<WidgetPalette onInsert={() => {}} />)
  const crumbUi = mount(<Breadcrumb scene={scene} selection={selection} entered={entered} dispatch={() => {}} />)
  try {
    for (const key of ['root:0', 'root:0.0', 'root:1']) await run(() => layerUi.container.querySelector<HTMLButtonElement>(`[data-layer="${key}"] [aria-label="Expand"]`)!.click())
    expect(controlNames(pageUi.container)).toEqual(['Add page', 'Main', 'Power', 'Remove page Main', 'Remove page Power', 'Remove page Tanks', 'Tanks'])
    expect(controlNames(layerUi.container)).toEqual([
      'Collapse', 'Collapse', 'Collapse', 'GL#paintHideLock',
      'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show', 'Hide / show',
      'Lock / unlock', 'Lock / unlock', 'Lock / unlock', 'Lock / unlock', 'Lock / unlock', 'Lock / unlock', 'Lock / unlock',
      'R#boxHideLock', 'R#hidden · hiddenShowLock', 'T#locked · lockedHideUnlock', 'bodyHide',
      'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'id', 'titleHide',
      '−G#inner · enteredHideLock', '−G#outerHideLock', '−G#pnl1 · panel pnl1HideLock',
    ])
    expect(controlNames(paletteUi.container)).toEqual(['Alert', 'Bar', 'Button', 'Event log', 'Flow duct', 'Gauge', 'Header bar', 'Item / gas icon', 'Key–value table', 'Option group', 'Page tabs', 'Panel', 'Readout row', 'Readout tile', 'Repeater', 'Status light', 'Stepper', 'Text', 'Text input', 'Toggle', 'Vector glyph'])
    expect(controlNames(crumbUi.container)).toEqual(['G#inner', 'G#outer', 'R#box'])
  } finally { pageUi.unmount(); layerUi.unmount(); paletteUi.unmount(); crumbUi.unmount(); h.checker.dispose() }
})
