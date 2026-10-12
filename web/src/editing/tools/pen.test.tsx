// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { node } from '../../model/testing'
import { parsePath } from '../../srctext/path'
import { printChecked } from '../../srctext/print'
import { linksOf } from '../../theme/links'
import { TOOLS } from '../registry'
import { harness } from '../testing'

const scene = (...root: ReturnType<typeof node>[]) => ({ header: { w: 460, h: 460 }, defs: [], root })
const pen = () => { const h = harness(scene()); h.key({ key: 'b' }); return h }

it('keeps a filled bow-tie accepted and surfaces its crossing warning on close', async () => {
  const h = pen()
  for (const p of [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }]) h.click(p)
  await h.settle()
  expect(h.root()[0].attrs.d).toBe('M0 0 L100 100 L100 0 L0 100 Z')
  expect(h.root()[0].attrs.f).toBeDefined(); expect(h.state().past).toHaveLength(1)
  expect(h.status()).toMatch(/warning: this P crosses itself/i)
})

it('registers B for the pen and leaves P on the SP path tool', () => {
  expect(TOOLS.find(t => t.key === 'B')?.id).toBe('pen')
  expect(TOOLS.find(t => t.key === 'P')?.id).toBe('path')
})
it('draws M L C Z at zoom 2 and pan in an entered group, checked once', async () => {
  const child = node('R', { x: 200, y: 200, w: 10, h: 10 }), h = harness(scene(node('G', { t: [50, 0] }, [child])))
  h.ctx.dispatch({ type: 'enter', pageId: 'p1', path: [0] })
  h.ctx.setView({ zoom: 2, pan: { x: 30, y: 40 } }); h.key({ key: 'b' })
  // The router receives surface pixels after the canvas removed zoom and pan.
  const press = (kind: 'down'|'move'|'up', x: number, y: number, stamp: number) => h.router.pointer(kind, x, y,
    { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 30+x*2, clientY: 40+y*2, timeStamp: stamp } as PointerEvent)
  press('down', 50, 0, 1000); press('up', 50, 0, 1000)
  press('down', 100, 0, 2000); press('up', 100, 0, 2000)
  press('down', 100, 50, 3000); press('move', 90, 50, 3000); press('up', 90, 50, 3000)
  expect(h.root()[0].c).toEqual([child])
  press('down', 50, 0, 4000); press('up', 50, 0, 4000)
  await h.settle()
  const n = h.root()[0].c![1]
  expect(n, h.status()).toBeDefined()
  expect(parsePath(n.attrs.d as string)).toEqual(parsePath('M0 0 L50 0 C50 0 60 50 50 50 C40 50 0 0 0 0 Z'))
  expect(linksOf(n).f).toEqual({ part: 'shape', field: 'fill' })
  expect(linksOf(n).s).toEqual({ part: 'shape', field: 'stroke' })
  expect(h.state().past).toHaveLength(1)
  expect(h.state().entered?.path).toEqual([0])
})
it('Enter finishes open with line defaults, Backspace removes the last anchor, and Esc writes nothing', async () => {
  const h = pen()
  h.click({ x: 0, y: 0 }); h.drag({ x: 50, y: 50 }, { x: 60, y: 50 }); h.click({ x: 100, y: 0 })
  h.key({ key: 'Backspace' }); h.key({ key: 'Enter' }); await h.settle()
  expect(parsePath(h.root()[0].attrs.d as string)).toEqual(parsePath('M0 0 C0 0 40 50 50 50'))
  expect(h.root()[0].attrs.f).toBeUndefined(); expect(linksOf(h.root()[0]).s).toEqual({ part: 'line', field: 'stroke' })
  expect(h.state().past).toHaveLength(1)
  const cancel = pen(); cancel.click({ x: 0, y: 0 }); cancel.click({ x: 50, y: 50 }); cancel.key({ key: 'Escape' })
  expect(cancel.root()).toEqual([]); expect(cancel.state().past).toHaveLength(0)
})
it('uses saved literal P defaults, shows a live curve, and refuses a failed check', async () => {
  const h = pen(); h.ctx.setDrawDefaults({ P: { attrs: { s: '#112233', sw: 7 }, links: {} } })
  h.click({ x: 10, y: 10 }); h.move({ x: 50, y: 40 })
  expect(renderToStaticMarkup(h.router.overlay({ zoom: 1, frame: null }) as ReactElement)).toContain('vb-band')
  h.click({ x: 50, y: 40 }); h.key({ key: 'Enter' }); await h.settle()
  expect(h.root()[0].attrs).toMatchObject({ s: '#112233', sw: 7 })
  const bad = harness(scene(), { verdict: () => ({ errors: [{ message: 'fixture rejects pen', at: 0 }], traps: [] } as never) })
  bad.key({ key: 'b' }); bad.click({ x: 0, y: 0 }); bad.click({ x: 50, y: 0 }); bad.key({ key: 'Enter' }); await bad.settle()
  expect(bad.root()).toEqual([]); expect(bad.status()).toContain('fixture rejects pen')
})
it('reports an abandoned pen gesture when the authored scene changes', async () => {
  const h = pen(); h.click({ x: 10, y: 10 }); h.click({ x: 50, y: 50 })
  expect(h.ctx.tool()).toBe('pen')
  h.ctx.dispatch({ type: 'editScene', pageId: 'p1', scene: scene(node('P', { d: '$path' })) })
  h.key({ key: 'Enter' }); await h.settle()
  expect(h.root()).toEqual([node('P', { d: '$path' })])
  expect(h.notes.join(' ')).toContain('scene changed; pen gesture not applied')
})
it('does not put a saved closed fill on an open pen path', async () => {
  const h = pen(); h.ctx.setDrawDefaults({ P: { attrs: { f: '#112233', sh: [[1, 2, 3, 0, '#123456']], s: '#445566', sw: 2 }, links: {} } })
  h.click({ x: 0, y: 0 }); h.click({ x: 50, y: 0 }); h.key({ key: 'Enter' }); await h.settle()
  expect(h.root()[0].attrs.f).toBeUndefined(); expect(h.root()[0].attrs.sh).toBeUndefined()
  expect(h.root()[0].attrs.s).toBe('#445566')
})
it('closes a two-anchor cubic contour by clicking its first anchor', async () => {
  const h = pen()
  h.drag({ x: 0, y: 0 }, { x: 0, y: 40 }); h.drag({ x: 100, y: 0 }, { x: 100, y: -40 }); h.click({ x: 0, y: 0 }); await h.settle()
  expect(h.root()[0]?.attrs.d).toBe('M0 0 C0 40 100 40 100 0 C100 -40 0 -40 0 0 Z')
  expect(h.state().past).toHaveLength(1)
})
it('renders open cubic, closed contour and a contour with an oriented hole cleanly in the pinned core', async () => {
  const h = pen(); h.click({ x: 10, y: 10 }); h.drag({ x: 100, y: 100 }, { x: 130, y: 100 }); h.key({ key: 'Enter' }); await h.settle()
  expect(h.root()[0]?.op).toBe('P'); expect(h.root()[0].attrs.d).toContain('C')
  const fixture = { ...h.scene(), root: [...h.root(),
    node('P', { d: 'M150 10 L250 10 L250 110 L150 110 Z', f: '#112233' }),
    node('P', { d: 'M270 10 L370 10 L370 110 L270 110 Z M290 30 L290 90 L350 90 L350 30 Z', f: '#445566' })] }
  const lua = `local ui=ss.ui.surface('main'); ss.ui.activate('main')\nui:element({id='s',type='vector',rect={unit='px',x=0,y=0,w=460,h=460},props={src=[==[${printChecked(fixture)}]==]}})`
  const script = `import assert from 'node:assert/strict'; import {decodeFrame} from './src/runtime/frame.ts';
    const {dotnet}=await import('./public/_framework/dotnet.js'); const runtime=await dotnet.create();
    const api=(await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).VectorBuilder.Wasm.Exports;
    const status=JSON.parse(await api.Load(${JSON.stringify(lua)},460,460,'{}','{}')); assert.equal(status.state,'Running',status.error);
    const frame=decodeFrame(api.Frame('main',1,false).slice().buffer); assert.deepEqual(frame.problems,[]); assert.ok(frame.positions.length>0);
    console.log('pen core fixture clean'); runtime.exit(0);`
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: process.cwd(), timeout: 30000, encoding: 'utf8' })).toContain('pen core fixture clean')
}, 30000)
