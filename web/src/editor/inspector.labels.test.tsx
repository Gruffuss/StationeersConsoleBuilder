// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { newProject } from '../model/project'
import { node } from '../model/testing'
import { withLayout } from '../editing/layoutRecords'
import { SceneChecker } from '../srctext/checker'
import { checkWorkers } from '../srctext/testing'
import { mount } from '../testing'
import { vanillaPlus as theme } from '../theme/vanillaPlus'
import { controlNames } from '../ui/testing'
import { expandRoot, putWidget } from '../widgets/core'
import { instance } from '../widgets/testing'
import { WIDGETS } from '../widgets/registry'
import { PropertyPanel } from './PropertyPanel'
import { DEF_OPS, NODE_OPS, fieldsFor } from '../schema'
import { WidgetPanel } from './WidgetPanel'
import { Inspector } from './shell/Inspector'
import { harness } from '../editing/testing'

it('identifies a native holder and its game draw layer in the Inspector subtitle', () => {
  const h = harness({ header: {}, defs: [], root: [node('G', { id: 'potato' }, [])] }, {
    natives: [{ ...instance('icon'), group: 'potato' }], sel: { pageId: 'p1', path: [], native: 'ico1' } })
  const ui = mount(<Inspector ctx={h.ctx} tab="Design" onTab={() => {}}>{null}</Inspector>)
  try { expect(ui.container.textContent).toContain('ico1 · in potato · drawn above the page') }
  finally { ui.unmount(); h.checker.dispose() }
})

const baseline: Record<string, string[]> = {
  "SCENE": [
    "Add shadow",
    "Animate dash",
    "Dash offset",
    "Dash offset mode",
    "Dash pattern",
    "Dash speed",
    "Design height",
    "Design width",
    "Edge softness",
    "Edge softness mode",
    "Fill",
    "Fill New gradient",
    "Fill alpha",
    "Fill colour",
    "Fill gradient kind",
    "Fill hex",
    "Fill mode",
    "Fill opacity",
    "Fill opacity mode",
    "Fill recent colours",
    "Fill rule",
    "Fill theme swatch",
    "Fit to screen",
    "Fixed rectangle boxes (debug)",
    "Font",
    "Font size",
    "Font size mode",
    "Font weight",
    "Hide fills (debug)",
    "Horizontal align",
    "Kerning",
    "Letter spacing",
    "Line corners",
    "Line ends",
    "Minimum font size",
    "Minimum font size mode",
    "No edge softening (debug)",
    "No per-pixel edges (debug)",
    "Sampled edge softness",
    "Sampled edge softness mode",
    "Shadows",
    "Sharp corner limit",
    "Stop dash",
    "Stop time t",
    "Stroke",
    "Stroke New gradient",
    "Stroke alpha",
    "Stroke colour",
    "Stroke gradient kind",
    "Stroke hex",
    "Stroke mode",
    "Stroke opacity",
    "Stroke opacity mode",
    "Stroke recent colours",
    "Stroke theme swatch",
    "Stroke width",
    "Stroke width mode",
    "Text in draw order",
    "Vertical align"
  ],
  "R": [
    "Add shadow",
    "Animate dash",
    "Clickable",
    "Corner radius",
    "Corner radius mode",
    "Dash offset",
    "Dash offset mode",
    "Dash pattern",
    "Dash speed",
    "Draggable",
    "Drop target",
    "Edge softness",
    "Edge softness mode",
    "Fill",
    "Fill New gradient",
    "Fill alpha",
    "Fill colour",
    "Fill gradient kind",
    "Fill gradient position",
    "Fill gradient position mode",
    "Fill hex",
    "Fill mode",
    "Fill opacity",
    "Fill opacity mode",
    "Fill recent colours",
    "Fill theme swatch",
    "Height",
    "Height mode",
    "Hover events",
    "Identifier",
    "Line corners",
    "Line ends",
    "Press and release events",
    "Report click position",
    "Shadow 1 Blur",
    "Shadow 1 Offset X",
    "Shadow 1 Offset Y",
    "Shadow 1 Spread",
    "Shadow 1 alpha",
    "Shadow 1 colour",
    "Shadow 1 down",
    "Shadow 1 hex",
    "Shadow 1 inset",
    "Shadow 1 recent colours",
    "Shadow 1 remove",
    "Shadow 1 up",
    "Shadows",
    "Sharp corner limit",
    "Square-corner switch",
    "Square-corner switch mode",
    "Stop dash",
    "Stop time t",
    "Stroke",
    "Stroke New gradient",
    "Stroke alpha",
    "Stroke colour",
    "Stroke gradient kind",
    "Stroke gradient position",
    "Stroke gradient position mode",
    "Stroke hex",
    "Stroke mode",
    "Stroke opacity",
    "Stroke opacity mode",
    "Stroke recent colours",
    "Stroke theme swatch",
    "Stroke width",
    "Stroke width mode",
    "Visible",
    "Visible mode",
    "Width",
    "Width mode",
    "X position",
    "X position mode",
    "Y position",
    "Y position mode"
  ],
  "T": [
    "Add shadow",
    "Clickable",
    "Draggable",
    "Drop target",
    "Fill",
    "Fill New gradient",
    "Fill alpha",
    "Fill colour",
    "Fill gradient kind",
    "Fill gradient position",
    "Fill gradient position mode",
    "Fill hex",
    "Fill mode",
    "Fill opacity",
    "Fill opacity mode",
    "Fill recent colours",
    "Fill theme swatch",
    "First line style",
    "Fit text",
    "Font",
    "Font size",
    "Font size mode",
    "Font weight",
    "Height",
    "Height mode",
    "Horizontal align",
    "Hover events",
    "Identifier",
    "Kerning",
    "Letter spacing",
    "Line height",
    "Minimum font size",
    "Minimum font size mode",
    "Number format",
    "Outline colour",
    "Outline colour alpha",
    "Outline colour hex",
    "Outline colour picker",
    "Outline colour recent colours",
    "Outline colour theme swatch",
    "Outline width",
    "Outline width mode",
    "Press and release events",
    "Report click position",
    "Shadows",
    "Text",
    "Text when no value",
    "Unit suffix",
    "Vertical align",
    "Visible",
    "Visible mode",
    "Width",
    "Width mode",
    "Wrap lines",
    "X position",
    "X position mode",
    "Y position",
    "Y position mode",
    "s"
  ],
  "G": [
    "Add shadow",
    "Anchor",
    "Animate dash",
    "Blur",
    "Blur mode",
    "Brightness",
    "Brightness mode",
    "Clip path",
    "Contrast",
    "Contrast mode",
    "Dash offset",
    "Dash offset mode",
    "Dash pattern",
    "Dash speed",
    "Edge softness",
    "Edge softness mode",
    "Fade mask",
    "Fill",
    "Fill New gradient",
    "Fill alpha",
    "Fill colour",
    "Fill gradient kind",
    "Fill hex",
    "Fill mode",
    "Fill opacity",
    "Fill opacity mode",
    "Fill recent colours",
    "Fill rule",
    "Fill theme swatch",
    "Fit text",
    "Font",
    "Font size",
    "Font size mode",
    "Font weight",
    "Grayscale",
    "Grayscale mode",
    "Horizontal align",
    "Hue shift",
    "Hue shift mode",
    "Identifier",
    "Invert",
    "Invert mode",
    "Kerning",
    "Layout align",
    "Layout box height",
    "Layout box width",
    "Layout box x",
    "Layout box y",
    "Layout direction",
    "Layout gap",
    "Layout justify",
    "Layout sizing",
    "Letter spacing",
    "Line corners",
    "Line ends",
    "Matrix",
    "Minimum font size",
    "Minimum font size mode",
    "Opacity",
    "Opacity mode",
    "Padding bottom",
    "Padding left",
    "Padding right",
    "Padding top",
    "Position",
    "Remove layout",
    "Rotation",
    "Rotation mode",
    "Same padding on all sides",
    "Sampled edge softness",
    "Sampled edge softness mode",
    "Saturation",
    "Saturation mode",
    "Scale",
    "Sepia",
    "Sepia mode",
    "Shadows",
    "Sharp corner limit",
    "Stop dash",
    "Stop time t",
    "Stroke",
    "Stroke New gradient",
    "Stroke alpha",
    "Stroke colour",
    "Stroke gradient kind",
    "Stroke hex",
    "Stroke mode",
    "Stroke opacity",
    "Stroke opacity mode",
    "Stroke recent colours",
    "Stroke theme swatch",
    "Stroke width",
    "Stroke width mode",
    "Vertical align",
    "Visible",
    "Visible mode",
    "h",
    "w",
    "x",
    "y"
  ],
  "IMG": [
    "Border widths",
    "Choose picture file…",
    "Clickable",
    "Corner radius",
    "Corner radius mode",
    "Crop",
    "Draggable",
    "Draw middle",
    "Drop target",
    "Edge repeat",
    "Fit picture",
    "Height",
    "Height mode",
    "Hover events",
    "Identifier",
    "Nine-slice insets",
    "Opacity",
    "Opacity mode",
    "Picture URL",
    "Picture file",
    "Picture offset",
    "Picture position",
    "Press and release events",
    "Report click position",
    "Smoothing",
    "Source URL",
    "Square-corner switch",
    "Square-corner switch mode",
    "Tile repeat",
    "Tile size",
    "Visible",
    "Visible mode",
    "Width",
    "Width mode",
    "X position",
    "X position mode",
    "Y position",
    "Y position mode",
    "f",
    "s"
  ],
  "part": [
    "Add shadow",
    "Animate dash",
    "Clickable",
    "Corner radius",
    "Corner radius mode",
    "Dash offset",
    "Dash offset mode",
    "Dash pattern",
    "Dash speed",
    "Draggable",
    "Drop target",
    "Edge softness",
    "Edge softness mode",
    "Fill",
    "Fill New gradient",
    "Fill alpha",
    "Fill colour",
    "Fill gradient kind",
    "Fill gradient position",
    "Fill gradient position mode",
    "Fill hex",
    "Fill mode",
    "Fill opacity",
    "Fill opacity mode",
    "Fill recent colours",
    "Fill theme swatch",
    "Height",
    "Height mode",
    "Hover events",
    "Identifier",
    "Line corners",
    "Line ends",
    "Press and release events",
    "Report click position",
    "Reset part",
    "Shadow 1 Blur",
    "Shadow 1 Offset X",
    "Shadow 1 Offset Y",
    "Shadow 1 Spread",
    "Shadow 1 alpha",
    "Shadow 1 colour",
    "Shadow 1 down",
    "Shadow 1 hex",
    "Shadow 1 inset",
    "Shadow 1 recent colours",
    "Shadow 1 remove",
    "Shadow 1 up",
    "Shadows",
    "Sharp corner limit",
    "Square-corner switch",
    "Square-corner switch mode",
    "Stop dash",
    "Stop time t",
    "Stroke",
    "Stroke New gradient",
    "Stroke alpha",
    "Stroke colour",
    "Stroke gradient kind",
    "Stroke gradient position",
    "Stroke gradient position mode",
    "Stroke hex",
    "Stroke mode",
    "Stroke opacity",
    "Stroke opacity mode",
    "Stroke recent colours",
    "Stroke theme swatch",
    "Stroke width",
    "Stroke width mode",
    "Visible",
    "Visible mode",
    "Width",
    "Width mode",
    "X position",
    "X position mode",
    "Y position",
    "Y position mode"
  ],
  "gauge": [
    "Colour by state",
    "Delete",
    "Detach",
    "End angle",
    "Height",
    "Label",
    "Maximum",
    "Minimum",
    "Number format",
    "Show value",
    "Start angle",
    "State data name",
    "Tick count",
    "Unit",
    "Value data name",
    "Width",
    "X position",
    "Y position",
    "gauge1_st preview value",
    "gauge1_v preview value"
  ],
  "button": [
    "Add",
    "Can be disabled",
    "Can be selected",
    "Delete",
    "Detach",
    "Height",
    "Remove",
    "States 1 Label",
    "States 1 State id",
    "States 1 Style",
    "Width",
    "X position",
    "Y position"
  ],
  "input": [
    "Delete",
    "Font size",
    "Height",
    "Placeholder",
    "Starting text",
    "Width",
    "X position",
    "Y position"
  ]
}

it.each(['SCENE', 'R', 'T', 'G', 'IMG', 'part', 'gauge', 'button', 'input'])('keeps every %s inspector control', kind => {
  const page = newProject().pages[0]
  const widget = instance(kind === 'part' ? 'panel' : kind === 'input' ? 'textinput' : ['gauge', 'button'].includes(kind) ? kind : 'gauge')
  const selected = kind === 'SCENE' ? null : { pageId: page.id, path: [0] }
  page.scene = { header: { w: 480, h: 480 }, defs: [], root: [] }
  if (['part', 'gauge', 'button', 'input'].includes(kind)) {
    if (kind === 'input') page.natives = [widget]
    else page.scene = putWidget(page.scene, widget, theme)
    if (kind === 'part') selected!.path = [0, ...expandRoot(widget, theme).exp.parts!.body]
  } else if (kind !== 'SCENE') {
    const shape = node(kind, { x: 10, y: 20, w: 100, h: 40, f: '#ffffff', s: '#112233',
      ...(kind === 'T' ? { text: 'A label', oc: '#000000' } : {}),
      ...(kind === 'IMG' ? { src: 'https://example.com/image.png' } : {}),
      ...(kind === 'R' ? { sh: [[0, 0, 4, 0, '#00000080']], dash: [6, 4] } : {}) })
    page.scene.root = [kind === 'G' ? withLayout({ ...shape, c: [node('R', { w: 10, h: 10 })] },
      { dir: 'row', pad: [0, 0, 0, 0], gap: 4, align: 'start', justify: 'start', size: 'fixed', box: [0, 0, 100, 40] }) : shape]
  }
  const checker = new SceneChecker(checkWorkers().make)
  const ui = mount(['gauge', 'button', 'input'].includes(kind)
    ? <WidgetPanel page={page} pages={[page]} widget={widget} native={kind === 'input'} checker={checker} theme={theme}
        dispatch={() => {}} sceneOf={() => page.scene} themeNow={() => theme} pageNow={() => page} />
    : <PropertyPanel page={page} selection={selected} checker={checker} theme={theme} dispatch={() => {}} sceneOf={() => page.scene} />)
  try {
    // New panel toggles, tabs and individual radios are additions; their group keeps the old select's name.
    const original = ui.container.cloneNode(true) as HTMLElement
    original.querySelectorAll('.vb-colour-fields > button, [role=tab], [role=radio], [aria-label="Discard pending picker colours"]').forEach(el => el.remove())
    const names = controlNames(original)
    expect(names).toEqual([...baseline[kind]].sort())
  } finally { ui.unmount(); checker.dispose() }
})

// Owner, 2026-10-13: "these should read as what they are not the code". Every label the Properties panel shows, for every
// node op and the scene header, its shadow and gradient editors included, is a plain name: none is an attribute code. Keys
// the catalogue does not know are listed as the node spells them under "other keys", so that section is left out.
const CODES = new Set([...NODE_OPS, ...DEF_OPS, 'SCENE', 'DATA'].flatMap(op => fieldsFor(op).map(f => f.key)))
it.each(['SCENE', ...NODE_OPS])('labels every %s property row by its plain name, never its code', op => {
  const page = newProject().pages[0], children = op === 'G' || op === 'RP' || op === 'SC' ? [node('R', { w: 10, h: 10 })] : undefined
  page.scene = { header: { w: 480, h: 480 }, defs: [node('GL', { id: 'g', x1: 0, y1: 0, x2: 1, y2: 0, stops: [[0, '#000000'], [1, '#ffffff']] })],
    root: op === 'SCENE' ? [] : [node(op, { id: 'n', f: '@g', s: '#112233', sh: [[0, 0, 4, 0, '#00000080']] }, children)] }
  const checker = new SceneChecker(checkWorkers().make)
  const ui = mount(<PropertyPanel page={page} selection={op === 'SCENE' ? null : { pageId: page.id, path: [0] }} checker={checker} theme={theme}
    dispatch={() => {}} sceneOf={() => page.scene} />)
  try {
    const labels = Array.from(ui.container.querySelectorAll('label'))
      .filter(l => !Array.from(ui.container.querySelectorAll('details')).some(d => d.querySelector(':scope > summary')?.textContent?.startsWith('other keys') && d.contains(l)))
      .map(l => Array.from(l.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim())
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.filter(l => CODES.has(l))).toEqual([])
    expect(controlNames(ui.container).filter(n => /\b(\w+) \1\b/i.test(n))).toEqual([])   // no name says a word twice ("Outline colour colour")
  } finally { ui.unmount(); checker.dispose() }
})

// Owner, 2026-10-13: a widget's own params and data names read as what they are too. Every row label and list legend in a
// widget's Transform, parameters and data names carries its key as the hover hint and never shows it as the label.
it.each(Object.keys(WIDGETS))('labels every %s widget row by its plain name, its key the hover hint', type => {
  const page = newProject().pages[0], widget = instance(type), native = !!WIDGETS[type].native
  if (native) page.natives = [widget]
  else page.scene = putWidget({ header: { w: 480, h: 480 }, defs: [], root: [] }, widget, theme)
  const checker = new SceneChecker(checkWorkers().make)
  const ui = mount(<WidgetPanel page={page} pages={[page]} widget={widget} native={native} checker={checker} theme={theme}
    dispatch={() => {}} sceneOf={() => page.scene} themeNow={() => theme} pageNow={() => page} />)
  try {
    const sections = Array.from(ui.container.querySelectorAll('details'))
      .filter(d => ['Transform', 'parameters', 'data names'].includes(d.querySelector(':scope > summary .ptitle')?.textContent ?? ''))
    const labels = sections.flatMap(d => Array.from(d.querySelectorAll('.vb-prop > .field > label, legend')))
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.filter(l => !l.getAttribute('title') || l.textContent === l.getAttribute('title')).map(l => l.textContent)).toEqual([])
    expect(controlNames(ui.container).filter(n => /\b(\w+) \1\b/i.test(n))).toEqual([])
  } finally { ui.unmount(); checker.dispose() }
})
