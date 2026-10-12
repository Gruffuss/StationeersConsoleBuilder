// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newProject } from '../model/project'
import type { Scene, Value } from '../model/scene'
import type { Action } from '../model/store'
import { node } from '../model/testing'
import { checkScene, tooLarge, type CheckIssue, type Checked } from '../srctext/check'
import { SceneChecker } from '../srctext/checker'
import { parseSrc } from '../srctext/parse'
import { checkWorkers } from '../srctext/testing'
import { mount, run } from '../testing'
import { themeOf } from '../theme'
import { NOT_APPLIED, PropertyPanel } from './PropertyPanel'
import { linksOf } from '../theme/links'
import { expandRoot, putWidget, widgetOf } from '../widgets/core'
import { instance } from '../widgets/testing'
import { vanillaPlus } from '../theme/vanillaPlus'
import { initialState, nodeAt, reducer } from '../model/store'

it('opens counted Design sections and keeps the hidden heading and field order', () => {
  const h = panel('SCENE w=480 h=480\nR x=10 y=20 w=100 h=40 f=#ffffff', [0])
  expect(h.box.querySelector('h2')?.className).toBe('vh')
  const sections = Array.from(h.box.querySelectorAll<HTMLDetailsElement>('aside > details.disc'))
  expect(sections.length).toBeGreaterThan(0)
  for (const section of sections) {
    expect(section.open).toBe(true)
    expect(section.querySelector(':scope > summary > .ptitle')?.textContent).toBeTruthy()
    expect(Number(section.querySelector(':scope > summary > .unit')?.textContent)).toBe(section.querySelectorAll('.vb-prop > .field').length)
  }
  const x = h.input('x'), field = x.closest('.field')!
  expect(field).not.toBeNull()
  expect(field.querySelector('label')?.textContent).toBe('x')
  expect(field.lastElementChild?.getAttribute('aria-label')).toBe('x mode')
  expect(field.closest('.grid2')).not.toBeNull()
  expect(h.box.querySelector('[aria-label="f colour panel"]')?.closest('.field')).toBe(h.input('f').closest('.field'))
})

it.each([false, true])('names a widget part, edits it without detaching, and Reset part restores the expansion (nested: %s)', async nested => {
  const p = newProject(); p.theme = 'vanilla-plus'
  const root = nested ? [0,0] : [0], w = instance('panel'), path = [...root, ...expandRoot(w, vanillaPlus).exp.parts!.body]
  p.pages[0].scene = putWidget(p.pages[0].scene, w, vanillaPlus)
  if (nested) p.pages[0].scene.root = [node('G', {}, p.pages[0].scene.root)]
  let state = reducer(initialState(p), { type: 'enter', pageId: 'p1', path: root })
  state = reducer(state, { type: 'select', selection: { pageId: 'p1', path } })
  const workers = checkWorkers(), checker = new SceneChecker(workers.make)
  const draw = () => <PropertyPanel page={state.project.pages[0]} selection={state.selection} checker={checker} theme={vanillaPlus}
    sceneOf={() => state.project.pages[0].scene} dispatch={a => { state = reducer(state, a) }} />
  ui = mount(draw())
  expect(ui.container.textContent).toContain(`part body of ${w.uid}`)
  await run(async () => { const field = ui!.container.querySelector<HTMLInputElement>('input[aria-label="f"]')!; setValue(field, '#123456'); enter(field); await settle() })
  expect(widgetOf(nodeAt(state.project.pages[0].scene.root, root)!, vanillaPlus)?.edit?.parts.body.attrs?.f).toBe('#123456')
  await run(async () => { const field = ui!.container.querySelector<HTMLInputElement>('input[aria-label="w"]')!; setValue(field, '300'); enter(field); await settle() })
  expect(nodeAt(state.project.pages[0].scene.root, path)!.attrs.w).toBe(300)
  await run(() => ui!.rerender(draw()))
  await run(async () => { ui!.container.querySelector<HTMLButtonElement>('button[aria-label="Reset part"]')!.click(); await settle() })
  expect(widgetOf(nodeAt(state.project.pages[0].scene.root, root)!, vanillaPlus)?.edit).toBeUndefined()
  expect(nodeAt(state.project.pages[0].scene.root, path)!.attrs.f).not.toBe('#123456')
  checker.dispose()
})

it('choosing a theme swatch links the key; a hand edit severs it and Detach style keeps its literal', async () => {
  const h = panel('SCENE w=480 h=480\nR x=10 y=10 w=20 h=20 f=#ff0000', [0])
  await h.pick('f theme swatch', 'accent')
  expect(linksOf(h.sets().at(-1)!.root[0])).toEqual({ f: { role: 'accent' } })
  await h.rerender()
  await h.type('f', '#00ff00')
  expect(linksOf(h.sets().at(-1)!.root[0])).toEqual({})
  await h.rerender()
  await h.pick('f theme swatch', 'accent')
  await h.rerender()
  const literal = h.sets().at(-1)!.root[0].attrs.f
  await run(async () => { h.box.querySelector<HTMLButtonElement>('button[aria-label="Detach style"]')!.click(); await settle() })
  expect(h.sets().at(-1)!.root[0].attrs.f).toBe(literal)
  expect(linksOf(h.sets().at(-1)!.root[0])).toEqual({})
})

const parsed = (text: string) => parseSrc(text).scene!
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII='

it('the picture file button embeds a 1x1 PNG with its byte count', async () => {
  const h = panel('SCENE w=480 h=480\n# image\nR x=10 y=20 w=80 h=45', [0])
  const button = Array.from(h.box.querySelectorAll('button')).find(b => b.textContent === 'Choose picture file…')
  expect(button).toBeDefined()
  const input = h.box.querySelector<HTMLInputElement>('input[type=file][aria-label="Picture file"]')!
  await run(async () => {
    Object.defineProperty(input, 'files', { value: [new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'picture.bin', { type: 'application/octet-stream' })] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await vi.waitFor(() => expect(h.sets()).toHaveLength(1), { timeout: 3000 })
  })
  expect(h.sets().at(-1)!.root[0]).toMatchObject({ op: 'IMG', attrs: { src: `data:image/png;base64,${png}` } })
  await h.rerender()
  // What the page grows by: the data URL text, not the decoded file.
  expect(h.box.textContent).toContain(`${`data:image/png;base64,${png}`.length} bytes added to the page`)
  await h.type('Picture URL', 'https://example.com/other.png')
  await h.rerender()
  expect(h.box.textContent).not.toContain(`${atob(png).length} bytes`)
  await h.rerender(h.scene) // undo restores the placeholder
  expect(h.box.textContent).not.toContain(`${atob(png).length} bytes`)
})

it('refuses a WEBP picture file with the game formats message', async () => {
  const h = panel('SCENE w=480 h=480\nIMG w=80 h=45 src=old', [0])
  const input = h.box.querySelector<HTMLInputElement>('input[type=file][aria-label="Picture file"]')
  expect(input).not.toBeNull()
  await run(async () => {
    Object.defineProperty(input!, 'files', { value: [new File(['RIFFxxxxWEBP'], 'a.webp')] })
    input!.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await vi.waitFor(async () => {
    await run(() => {})
    expect(h.alerts()).toContain('the game reads PNG, JPEG, BMP and GIF')
  }, { timeout: 3000 })
  expect(h.sets()).toHaveLength(0)
})

it('the picture URL field writes arbitrary src text on a placeholder and an IMG', async () => {
  for (const text of ['# image\nR w=80 h=45', 'IMG w=80 h=45 src=old']) {
    const h = panel(`SCENE w=480 h=480\n${text}`, [0])
    expect(h.input('Picture URL')).not.toBeNull()
    await h.type('Picture URL', 'file:///b.png')
    expect(h.sets().at(-1)!.root[0]).toMatchObject({ op: 'IMG', attrs: { src: 'file:///b.png' } })
  }
})
const settle = () => new Promise(r => setTimeout(r, 0))
type Typed = HTMLInputElement | HTMLTextAreaElement
const setValue = (e: Typed | HTMLSelectElement, v: string) => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value')!.set!.call(e, v)
  e.dispatchEvent(new Event(e instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const enter = (e: Typed) => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

let ui: ReturnType<typeof mount> | null = null
afterEach(() => { ui?.unmount(); ui = null })

/**
 * The panel on page p1 showing `first`, `path` selected (null: nothing), its checks answered as check.worker.ts does or by
 * `verdict`. Its dispatch sets the page's scene as the store does (sceneOf reads it); the panel shows it on `rerender`.
 */
function panel(first: Scene | string, path: number[] | null, { verdict, inDefs }: { verdict?: (s: Scene) => Checked; inDefs?: true } = {}) {
  const workers = checkWorkers(verdict), checker = new SceneChecker(workers.make), actions: Action[] = []
  let current = typeof first === 'string' ? parsed(first) : first
  const draw = (at = path) => <PropertyPanel page={{ ...newProject().pages[0], scene: current }} selection={at && { pageId: 'p1', path: at, inDefs }}
    checker={checker} theme={themeOf(newProject())} sceneOf={id => id === 'p1' ? current : undefined}
    dispatch={a => { actions.push(a); if (a.type === 'setScene') current = a.scene }} />
  ui?.unmount()
  ui = mount(draw())
  const box = ui.container
  const input = (key: string) => box.querySelector<Typed>(`input[aria-label="${key}"], textarea[aria-label="${key}"]`)!
  return {
    actions, checker, box, input, scene: current,
    worker: () => workers.made[0],
    sets: () => actions.flatMap(a => a.type === 'setScene' ? [a.scene] : []),
    /** The keys listed under the heading `title`. */
    section: (title: string) => Array.from(Array.from(box.querySelectorAll('aside > details.disc')).find(s => s.querySelector('summary .ptitle')?.textContent === title)
      ?.querySelectorAll('.vb-prop > .field > label') ?? [], l => l.textContent),
    /** The texts of the row of `key`. */
    rowOf: (key: string) => box.querySelector(`[aria-label="${key}"]`)!.closest('.vb-prop')!,
    texts: (selector: string, at: ParentNode = box) => Array.from(at.querySelectorAll(selector), e => e.textContent),
    alerts: () => Array.from(box.querySelectorAll('[role=alert]'), e => e.textContent),
    type: (key: string, text: string) => run(async () => {
      setValue(input(key), text)
      enter(input(key))
      await settle()
    }),
    pick: (label: string, value: string) => run(async () => {
      const group = box.querySelector(`[role=radiogroup][aria-label="${label}"]`)
      if (group) {
        const row = group.closest('.vb-colour-fields')!
        row.querySelector<HTMLButtonElement>(':scope > button')!.click()
        Array.from(row.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(b => b.textContent === 'Theme')!.click()
        group.querySelector<HTMLButtonElement>(`[role=radio][aria-label="${value}"]`)!.click()
      } else setValue(box.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!, value)
      await settle()
    }),
    /** Shows the page's scene now, or `s` set from outside (the code pane, undo). */
    rerender: (s?: Scene) => run(() => { if (s) current = s; ui!.rerender(draw()) }),
    select: (at: number[]) => run(async () => { ui!.rerender(draw(at)); await settle() }),
    /** Answers the checks the worker holds. */
    release: () => run(async () => { workers.made[0].release(); await settle() }),
  }
}

describe('PropertyPanel', () => {
  it('shows a filled P crossing as a warning and still allows a property commit', async () => {
    const p = panel('SCENE w=460 h=460\nP d="M0 0 L100 100 L100 0 L0 100 Z" f=#fff', [0])
    await run(async () => { await p.checker.check(p.scene) })
    expect(p.texts('.vb-prop-warning').join(' ')).toContain('this P crosses itself')
    await p.type('sw', '3')
    expect(p.sets().at(-1)!.root[0].attrs.sw).toBe(3)
  })
it('gives the picture URL field one matching visible and accessible name', () => {
  const h = panel('SCENE w=480 h=480\nIMG w=80 h=45 src=old', [0])
  const field = h.input('Picture URL')
  expect(field.labels).toHaveLength(1)
  expect(field.labels![0].textContent).toBe('Picture URL')
})
  it('shows the scene for a missing intermediate path and cannot edit a root node through it', async () => {
    const p = panel('SCENE w=460 h=460\nR w=20', [99, 0])
    expect(p.box.querySelector('h2')!.textContent).toBe('SCENE')
    await p.type('w', '480')
    expect(p.sets()).toHaveLength(1)
    expect(p.sets()[0].header.w).toBe(480)
    expect(p.sets()[0].root).toEqual(p.scene.root)
  })
  it("lists an R's fields by group, each absent one showing what absence means", () => {
    const p = panel('R x=1', [0])
    expect(p.box.querySelector('h2')!.textContent).toBe('R')
    expect(p.section('geometry')).toEqual(['x', 'y', 'w', 'h', 'rx', 'ry'])
    expect(p.section('fill').slice(0, 2)).toEqual(['f', 'fo'])
    expect(p.input('x').value).toBe('1')
    expect(p.input('y').placeholder).toBe('0')
    expect(p.input('ry').placeholder).toBe('same as rx')   // never a made-up 0
    expect(p.input('fat').placeholder).toBe('the gradient is sampled by position')
  })

  it('commits a typed number on Enter: one setScene; an emptied field removes the key', async () => {
    const p = panel('R x=1', [0])
    await p.type('w', '20')
    expect(p.sets()).toHaveLength(1)
    expect(p.sets()[0].root[0].attrs).toEqual({ x: 1, w: 20 })
    await p.rerender()
    await p.type('x', '')
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ x: 1, w: 20 }, { w: 20 }])
    expect(p.alerts()).toEqual([])
  })

  it('refuses what is not a number, and an edit that would make the scene invalid', async () => {
    const p = panel('R x=1', [0])
    await p.type('w', 'abc')
    expect(p.alerts()).toEqual(['a number is expected'])
    const t = panel('T text=hi', [0])
    await t.type('text', '12')
    expect(t.alerts()).toEqual([])
    expect(t.sets()[0].root[0].attrs.text).toBe('12')
    expect(p.actions).toEqual([])
  })

  it('does nothing on Enter in an unchanged field, and clears what an earlier try said', async () => {
    const p = panel('R x=1 f=red', [0])
    await p.type('f', 'red')   // a colour name the code pane set
    await p.type('x', '1')
    await p.type('x', '1.0')   // reads as the same value: no history entry
    expect(p.alerts()).toEqual([])
    await p.type('x', 'abc')
    expect(p.alerts()).toEqual(['a number is expected'])
    await p.type('x', '1')
    expect(p.alerts()).toEqual([])
    expect(p.actions).toEqual([])
  })

  it('switches x to an expression, a data name, and back', async () => {
    const p = panel('R x=1', [0])
    await p.pick('x mode', 'expr')
    await p.type('x', 't*10')
    await p.rerender()
    await p.pick('x mode', 'data')
    await p.type('x', 'level')
    expect(p.sets().map(s => s.root[0].attrs.x)).toEqual(['=t*10', '$level'])
  })

  it('writes a paint as a gradient, a colour expression or a colour word', async () => {
    const p = panel('DEFS {\n    GL id=tank-fill stops=[[0,#000],[1,#fff]]\n}\nR f=#fff', [0])
    await p.pick('f mode', 'gradient')
    await p.type('f', 'tank-fill')
    await p.rerender()
    await p.pick('f mode', 'colourExpr')
    await p.type('f', 'mix(#000,#fff,t)')
    await p.rerender()
    await p.pick('f mode', 'literal')
    await p.type('f', 'Navy')
    await p.rerender()
    await p.type('f', 'reds')
    await p.rerender()
    await p.type('f', '#zz')   // the mod reads it as it reads a word it does not know: reported, drawn magenta
    await p.rerender()
    expect(p.sets().map(s => s.root[0].attrs.f)).toEqual(['@tank-fill', '=mix(#000,#fff,t)', 'Navy', 'reds', '#zz'])
    expect(p.texts('.vb-prop-warning', p.rowOf('f'))).toEqual(['f="#zz": not a colour: the mod reports it and draws the shape magenta; write #hex, none or a colour name'])
    expect(p.alerts()).toEqual([])
  })

  it("edits a T's text bound to data as text, line breaks and all", async () => {
    const p = panel('T text="$tank[i]"', [0])
    expect(p.box.querySelector('select[aria-label="text mode"]')).toBeNull()
    await p.type('text', '$other[j]')
    await p.rerender()
    const q = panel('T text="a\\nb"', [0])
    expect(q.input('text').tagName).toBe('TEXTAREA')
    expect(q.input('text').value).toBe('a\nb')
    await q.type('text', 'a\nc')
    expect([...p.sets(), ...q.sets()].map(s => s.root[0].attrs.text)).toEqual(['$other[j]', 'a\nc'])
  })

  it('offers no mode toggle on a plain number or a pair; a count the mod rounds is kept, with a note', async () => {
    const p = panel('RP n=3 {\n    R\n}', [0])
    expect(p.input('n').value).toBe('3')
    expect(p.box.querySelector('select[aria-label="n mode"]')).toBeNull()
    await p.type('n', '2.5')
    await p.rerender()
    expect(p.sets().map(s => s.root[0].attrs.n)).toEqual([2.5])
    expect(p.texts('.vb-prop-info', p.rowOf('n'))).toEqual(['the mod rounds this to a whole number'])
    const g = panel('G t=[1,2] {\n    R\n}', [0])
    expect(g.box.querySelector('select[aria-label="t mode"]')).toBeNull()
    await g.type('t', '["=t*10",0]')
    expect(g.sets().map(s => s.root[0].attrs.t)).toEqual([['=t*10', 0]])
  })

  it("shows a group's passed-down keys as inherited, not a leaf's default", () => {
    const p = panel('G {\n    T\n}', [0])
    expect(p.input('size').placeholder).toBe('inherited')
    expect(p.input('o').placeholder).toBe('1')   // the G's own
    // a flag passed down is a choice that can go back to inherited
    expect(Array.from(p.box.querySelectorAll('select[aria-label="kern"] option'), o => o.textContent)).toEqual(['(default: inherited)', '1', '0'])
    expect(p.box.querySelector('select[aria-label="cap"] option')!.textContent).toBe('(default: inherited)')
  })

  it('takes a passed-down flag back to inherited, and shows kern as the mod reads it (not 0)', async () => {
    const p = panel('G kern=0 {\n    T\n}', [0])
    await p.pick('kern', '')
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{}])
    expect(panel('T kern=0.3', [0]).box.querySelector<HTMLInputElement>('input[aria-label="kern"]')!.checked).toBe(true)
  })

  it('shows and replaces a flag holding a list 100,000 deep', async () => {
    let deep: Value = [0.3]
    for (let k = 0; k < 100_000; k++) deep = [deep]
    const p = panel({ header: {}, defs: [], root: [node('T', { kern: deep })] }, [0])
    const box = p.box.querySelector<HTMLInputElement>('input[aria-label="kern"]')!
    expect(box.checked).toBe(true)   // Number reads [[0.3]] as 0.3
    await run(async () => { box.click(); await settle() })
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ kern: 0 }])
  })

  it('offers the group defaults on any node with a block, as inherited', () => {
    const p = panel('RP n=2 {\n    R\n}', [0])
    expect(p.section('fill')).toContain('f')
    expect(p.input('f').placeholder).toBe('inherited')
    expect(p.section('other keys')).toEqual([])
    expect(panel('RP n=2', [0]).section('fill')).toEqual([])
  })

  it('reads and writes a group default by its exact key, as the mod passes it down; another spelling is an other key', async () => {
    // The mod passes G f= down and not G F= (SchemaTests.cs): the f row shows only f, and F is a key of its own, with
    // its trap beside it.
    const upper = panel('G F=#ff0000 {\n    R\n}', [0])
    expect(upper.input('f').value).toBe('')
    expect(upper.input('f').placeholder).toBe('inherited')
    expect(upper.section('other keys')).toEqual(['F'])
    expect(upper.input('F').value).toBe('#ff0000')
    await run(async () => { await upper.checker.check(upper.scene) })
    const defaultCase = '"F" does nothing on G: the mod passes a group default down only as written in lower case: write f'
    expect(upper.texts('.vb-prop-warning', upper.rowOf('F'))).toEqual([defaultCase])
    expect(upper.texts('.vb-prop-warning', upper.rowOf('f'))).toEqual([])
    expect(upper.texts(':scope > .vb-props > .vb-prop-warning')).toEqual([])
    // an edit of f writes f, beside the F, which stays as written
    await upper.type('f', '#00ff00')
    expect(upper.sets().map(s => s.root[0].attrs)).toEqual([{ F: '#ff0000', f: '#00ff00' }])
    await upper.rerender()
    expect([upper.input('f').value, upper.input('F').value]).toEqual(['#00ff00', '#ff0000'])
    // ... and an edit of F writes F only
    await upper.type('F', '#0000ff')
    expect(upper.sets().map(s => s.root[0].attrs)[1]).toEqual({ F: '#0000ff', f: '#00ff00' })

    const lower = panel('G f=#ff0000 {\n    R\n}', [0])
    expect(lower.input('f').value).toBe('#ff0000')
    expect(lower.section('other keys')).toEqual([])
    // the header's defaults, and those a block passes down from an op that does not read the key itself (RP's fo)
    const header = panel('SCENE w=10 h=10 F=#ff0000 FIT=contain\nR', null)
    expect([header.input('f').value, header.box.querySelector<HTMLSelectElement>('select[aria-label="fit"]')!.value]).toEqual(['', 'contain'])
    expect(header.section('other keys')).toEqual(['F'])
    const rp = panel('RP n=2 FO=0.5 {\n    R\n}', [0])
    expect(rp.input('fo').value).toBe('')
    expect(rp.section('other keys')).toEqual(['FO'])
    // a shape reads its own fill in any case, so its row is F there
    expect(panel('R F=#ff0000 {\n    R\n}', [0]).input('f').value).toBe('#ff0000')
  })

  it('commits a select and a checkbox on change; "(default)" removes the key', async () => {
    const p = panel('R s=#fff cap=round', [0])
    await p.pick('cap', '')
    await p.rerender()
    await run(async () => { (p.input('click') as HTMLInputElement).click(); await settle() })
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ s: '#fff' }, { s: '#fff', click: 1 }])
  })

  it('lists a key the catalogue does not know on the op under "other keys"', () => {
    const p = panel('R o=0.5', [0])
    expect(p.section('other keys')).toEqual(['o'])
    expect(p.input('o').value).toBe('0.5')
  })

  it("shows the selected node's warnings, one about a key beside that key's row", async () => {
    const ref = (path: number[]) => ({ inDefs: false, path })
    const warnings: CheckIssue[] = [{ message: 'about o', ref: ref([0]), key: 'O' }, { message: 'on the R', ref: ref([0]) },
      { message: 'on the C', ref: ref([1]) }, { message: 'on the scene' }]
    const p = panel('R o=0.5\nC', [0], { verdict: s => ({ ...checkScene(s), warnings }) })
    await run(async () => { await p.checker.check(p.scene) })
    expect(p.texts('.vb-prop-warning', p.rowOf('o'))).toEqual(['about o'])
    expect(p.texts(':scope > .vb-props > .vb-prop-warning')).toEqual(['on the R'])
  })

  it("puts the real traps beside their rows: o on an R, a word align does not take, a T's fit", async () => {
    const p = panel('R o=0.5', [0])
    await run(async () => { await p.checker.check(p.scene) })
    expect(p.texts('.vb-prop-warning', p.rowOf('o'))).toEqual(['"o" does nothing on R: the mod reports it: remove it'])
    const t = panel('T text=a align=middle fit=size', [0])
    await run(async () => { await t.checker.check(t.scene) })
    expect(t.texts('.vb-prop-warning', t.rowOf('align'))).toEqual(['"align" does not take "middle", the mod reports it, and left is used: write left, center, right or justified'])
    expect(t.texts('.vb-prop-warning', t.rowOf('fit'))).toEqual(['"fit" does not take "size", the mod reports it, and none is used: write none, ellipsis or shrink'])
    expect(t.texts('.vb-prop-warning', t.rowOf('size'))).toEqual([])
    expect(t.texts(':scope > .vb-props > .vb-prop-warning')).toEqual([])
  })

  it('lists the SCENE fields when nothing is selected, the root defaults included', async () => {
    const p = panel('SCENE w=200\nR', null, { verdict: s => ({ ...checkScene(s), warnings: [{ message: 'on the scene' }] }) })
    expect(p.box.querySelector('h2')!.textContent).toBe('SCENE')
    expect(p.section('scene').slice(0, 4)).toEqual(['w', 'h', 'fit', 'ztext'])
    expect(p.section('fill')).toContain('f')
    expect(p.section('stroke')).toContain('s_')
    expect(p.section('text')).toEqual(expect.arrayContaining(['size', 'font']))
    expect(p.input('w').value).toBe('200')
    await run(async () => { await p.checker.check(p.scene) })
    expect(p.texts('.vb-prop-warning')).toEqual(['on the scene'])
    await p.type('h', '50')
    expect(p.sets().map(s => s.header)).toEqual([{ w: 200, h: 50 }])
  })

  it('keeps the focus in a field across its commit: it is not remounted', async () => {
    const p = panel('R x=1', [0])
    const w = p.input('w')
    w.focus()
    await p.type('w', '20')
    await p.rerender()
    expect(p.input('w')).toBe(w)
    expect(document.activeElement).toBe(w)
    expect(w.value).toBe('20')
  })

  it('commits what was typed and left when another node is selected', async () => {
    const p = panel('R x=1\nC', [0])
    await run(() => setValue(p.input('w'), '20'))
    expect(p.actions).toEqual([])
    await p.select([1])
    expect(p.box.querySelector('h2')!.textContent).toBe('C')
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ x: 1, w: 20 }])
  })

  it('commits a blur and the unmount after it once', async () => {
    const p = panel('R x=1\nC', [0])
    p.worker().held = true
    await run(() => { setValue(p.input('w'), '20'); p.input('w').focus(); p.input('w').blur() })
    expect(p.worker().waiting).toHaveLength(1)
    await p.select([1])   // before the blur's check lands
    for (let k = 0; k < 3; k++) await p.release()
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ x: 1, w: 20 }])
  })

  it('does not apply an edit whose node changed while it was checked, and says so', async () => {
    const p = panel('R x=1', [0])
    p.worker().held = true
    await p.type('w', '20')
    await p.rerender(parsed('R x=5'))   // the code pane, while the check is out
    for (let k = 0; k < 3; k++) await p.release()
    expect(p.actions).toEqual([])
    expect(p.alerts()).toEqual([NOT_APPLIED])
  })

  it('makes two quick edits of one node, the second on top of the first', async () => {
    const p = panel('R x=1', [0])
    p.worker().held = true
    await p.type('w', '20')
    await p.type('h', '30')   // before w's check lands
    for (let k = 0; k < 4; k++) await p.release()
    expect(p.sets().map(s => s.root[0].attrs)).toEqual([{ x: 1, w: 20 }, { x: 1, w: 20, h: 30 }])
    expect(p.alerts()).toEqual([])
  })

  it('shows no stale warning while the check of a scene changed from outside is pending', async () => {
    const p = panel('R o=0.5\nC', [0])
    await run(async () => { await p.checker.check(p.scene) })
    expect(p.texts('.vb-prop-warning')).toEqual(['"o" does nothing on R: the mod reports it: remove it'])
    p.worker().held = true
    await p.rerender(parsed('C\nR o=0.5'))   // an undo or the code pane: the path now holds the C
    expect(p.texts('.vb-prop-warning')).toEqual([])
  })

  it('says a theme_ gradient is the builder’s, which a theme switch, a load or a widget edit writes again (ruling 3)', () => {
    const defs = 'DEFS {\n    GL id=theme_row stops=[[0,#000000],[1,#FFFFFF]]\n    GL id=mine stops=[[0,#000000],[1,#FFFFFF]]\n}\nR x=1'
    expect(panel(defs, [0], { inDefs: true }).box.textContent).toContain('a theme switch, a load, or an edit of a widget')
    expect(panel(defs, [0], { inDefs: true }).box.textContent).not.toContain('(ruling 3)')
    expect(panel(defs, [1], { inDefs: true }).box.textContent).not.toContain('A theme_ gradient is the builder')
  })
  it('applies an edit whose scene is too large to check here, and says so as information (a budget is no verdict)', async () => {
    const p = panel('R x=1', [0], { verdict: s => s.root[0].attrs.w ? tooLarge('x') : checkScene(s) })
    await p.type('w', '20')
    expect(p.alerts()).toEqual([])
    expect(p.texts('[role=status]', p.rowOf('w'))).toEqual(['this scene is too large to check here (x); it is not sent to the preview'])
    expect(p.actions.map(a => a.type === 'setScene' && a.scene.root[0].attrs)).toEqual([{ x: 1, w: 20 }])
  })

  it('writes nothing on a blur after a mode switch with the text unchanged', async () => {
    const p = panel('R x=1', [0])
    await p.pick('x mode', 'expr')
    await run(() => { p.input('x').focus(); p.input('x').blur() })
    await run(async () => { await settle() })
    expect(p.actions).toEqual([])
    expect(p.input('x').getAttribute('list')).toBe('vb-expr')
    expect(Array.from(p.box.querySelectorAll('#vb-expr option'), o => o.getAttribute('value'))).toEqual(expect.arrayContaining(['=i1', '=i2']))
    await p.pick('f mode', 'colourExpr')
    expect(p.input('f').getAttribute('list')).toBe('vb-colour')
    expect(Array.from(p.box.querySelectorAll('#vb-colour option'), o => o.getAttribute('value'))).toContain('=mix(')
  })

  it('makes an edit again on the newer scene when the page changed elsewhere while it was checked', async () => {
    const p = panel('R x=1\nC', [0])
    p.worker().held = true
    await p.type('w', '20')
    const s = p.scene
    await p.rerender({ ...s, root: [s.root[0], node('C', { cx: 5 })] })
    for (let k = 0; k < 3; k++) await p.release()
    expect(p.sets().map(x => x.root.map(n => n.attrs))).toEqual([[{ x: 1, w: 20 }, { cx: 5 }]])
  })

  it("edits a gradient's id and stops in the defs", async () => {
    const p = panel('DEFS {\n    GL id=g stops=[[0,#000],[1,#fff]]\n}', [0], { inDefs: true })
    expect(p.box.querySelector('h2')!.textContent).toBe('GL')
    expect(p.input('stops').value).toBe('[[0,#000],[1,#fff]]')
    await p.type('stops', '[[0,#f00],[1,#00f]]')
    await p.rerender()
    await p.type('id', 'h')
    expect(p.sets().map(s => s.defs[0].attrs)).toEqual([{ id: 'g', stops: [[0, '#f00'], [1, '#00f']] }, { id: 'h', stops: [[0, '#f00'], [1, '#00f']] }])
  })

  it("shows a USE's ref read-only, and no hidden key as an other key", () => {
    const p = panel({ header: {}, defs: [], root: [node('USE', { ref: 'tank', label: 'A' })] }, [0])
    expect(p.section('read-only')).toEqual(['ref'])
    expect(p.box.querySelector('output')!.textContent).toBe('tank')
    expect(p.section('other keys')).toEqual(['label'])
    expect(p.input('ref')).toBeNull()
  })

  it('notes a font that is neither bundled nor imported, and offers the known ones', () => {
    const p = panel('T font=code', [0])
    expect(p.box.querySelector('.vb-prop-info')!.textContent)
      .toContain('font "code": unless the player has this face, the game uses its fallback and reports it')
    expect(p.input('font').getAttribute('list')).toBe('vb-fonts')
    expect(Array.from(p.box.querySelectorAll('#vb-fonts option'), o => o.getAttribute('value'))).toContain('Barlow')
    expect(panel('T font=Barlow', [0]).box.querySelector('.vb-prop-info')).toBeNull()
    expect(panel('T font=123', [0]).box.querySelector('.vb-prop-info')!.textContent).toContain('font "123"')
  })

  it('suggests no colour function in an expression: mix reads as 0 in a number', () => {
    const options = Array.from(panel('R x=1', [0]).box.querySelectorAll('#vb-expr option'), o => o.getAttribute('value'))
    expect(options).toContain('=sin(')
    expect(options).not.toContain('=mix(')
  })
})
it.each([['true', true], ['false', false]] as const)('shows literal flag %s as the mod reads it', (word, checked) => {
  const p = panel(`T kern=${word} wrap=${word}`, [0])
  expect(p.box.querySelector<HTMLInputElement>('input[aria-label="kern"]')!.checked).toBe(checked)
  expect(p.box.querySelector<HTMLInputElement>('input[aria-label="wrap"]')!.checked).toBe(checked)
})
