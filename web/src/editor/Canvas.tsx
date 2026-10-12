// One surface: the WebGL canvas, fitted to the space it is given, with the text layer, the covers among its labels (where a
// later shape is drawn over a label: gl.ts) and the caller's overlays on top.
// Frames are requested every animation frame (the bridge drops a request while it is busy). A frame that arrives is
// drawn once React has committed its labels, so the canvas, the covers and the text a paint shows are of one frame.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type MutableRefObject } from 'react'
import { createPortal } from 'react-dom'
import type { CoreBridge } from '../runtime/bridge'
import './canvas.css'
import type { Frame, FrameText } from '../runtime/frame'
import type { Scene } from '../model/scene'
import { ownsKeys } from '../keys'
import { fitView, toSurface, zoomAt, type Viewport } from '../editing/view'
import type { Pt } from '../editing/types'
import type { Box as SelectionBox } from './geometry'
import { fontsVersion, subscribeFonts } from './fonts'
import { covers, makeRenderer, startFailure, zIndex, type Box, type Copy } from './gl'
import { drawable, labelFontKey, sameLabels, sameLayout } from './text'
import { measure, TextLayer } from './TextLayer'
import type { Pictures } from './pictures'

export type ViewApi = { fit(): void; actual(): void; fitSelection(): void; pan(dx: number, dy: number): void }
export type Renderer = ReturnType<typeof makeRenderer>
type Pointer = 'down' | 'move' | 'up'

// No geometry: the scene target stays transparent; the display shows the page checker.
const NONE: Frame = { positions: new Float32Array(), coverage: new Float32Array(), colours: new Uint8Array(), indices: new Uint32Array(),
  spans: new Int32Array(), elements: [], text: [], problems: [] }
type Size = { w: number; h: number }
type Shown = { f: Frame; s: Size; labels: FrameText[] }
// The frame's labels the text layer draws; the list it already has when they draw the same (the text layer skips a render).
const labelsOf = (f: Frame, prev: FrameText[] | undefined) => {
  const labels = f.text.filter(drawable)
  return prev && sameLabels(prev, labels) ? prev : labels
}

export function Canvas({ bridge, surface, size, tag, onFrame, children, chrome, onPointer, fixedZoom, onRenderer, scene, navigate = false, viewport, selectionBox, pictures, picturePage = surface, viewSlot, viewApi, onHover }: {
  bridge: CoreBridge; surface: string; size: { w: number; h: number }; tag: boolean; onFrame?: (f: Frame) => void
  children?: (ctx: { zoom: number; pan: Pt; frame: Frame | null }) => ReactNode  /* overlays: selection, handles */
  chrome?: (ctx: { zoom: number; pan: Pt; frame: Frame | null }) => ReactNode
  onPointer?: (kind: Pointer, x: number, y: number /* surface px */, ev: PointerEvent) => void
  fixedZoom?: number  /* zoom forced to this value, devicePixelRatio taken as 1 */
  onRenderer?: (r: Renderer | null) => void  /* the renderer once created, null on unmount */
  scene?: Scene
  navigate?: boolean
  viewport?: Viewport
  selectionBox?: SelectionBox | null  /* in surface px */
  pictures?: Pictures; picturePage?: string
  viewSlot?: HTMLElement | null; viewApi?: MutableRefObject<ViewApi | null>; onHover?: (p: Pt | null) => void
}) {
  const box = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), renderer = useRef<Renderer | null>(null)
  const coverCanvas = useRef<HTMLCanvasElement>(null), cover = useRef<Renderer | null>(null)
  const text = useRef<HTMLDivElement>(null), extents = useRef<(Box | null)[]>([]), deeper = useRef<HTMLCanvasElement[]>([])
  const measured = useRef<{ labels: FrameText[]; zoom: number; fontKeys: string[]; w: number; h: number } | null>(null)
  const held = useRef(new Map<number, { left: number; top: number; view: Viewport }>())  // a press keeps its coordinate space until release
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  const [frame, setFrame] = useState<Frame | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)   // what the canvases and the text layer show
  const [loaded, setLoaded] = useState(new Map<string, number>())   // web fonts loaded since: text may have moved
  const fonts = useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)
  const [failed, setFailed] = useState<string | null>(null)
  const [views, setViews] = useState(new Map<string, Viewport>())
  const [zoomDraft, setZoomDraft] = useState<string | null>(null)
  const [space, setSpace] = useState(false), spaceHeld = useRef(false)
  const panning = useRef<{ id: number; start: Pt; view: Viewport } | null>(null)
  const touches = useRef(new Map<number, Pt>())
  const pinch = useRef<{ ids: number[]; distance: number; centre: Pt; client: Pt; view: Viewport } | null>(null)
  const skip = useRef(new Set<number>())  // navigation's releases never reach a drawing tool
  const fitted = fitView(size, avail, navigate ? 24 : 0)
  const v = fixedZoom !== undefined ? { zoom: fixedZoom, pan: { x: 0, y: 0 } }
    : viewport ?? (navigate ? views.get(surface) : undefined) ?? fitted
  const { zoom, pan } = v, dpr = fixedZoom === undefined ? devicePixelRatio : 1
  const visible = fixedZoom === undefined ? avail : { w: size.w * zoom, h: size.h * zoom }
  const scale = zoom * dpr  // device px per surface px: tessellation, independent of the backing size
  const setView = (next: Viewport) => {
    if (![next.zoom, next.pan.x, next.pan.y].every(Number.isFinite) || next.zoom < 0.01 || next.zoom > 64) return
    setViews(prev => new Map(prev).set(surface, next))
    setZoomDraft(null)
  }
  const api: ViewApi = {
    fit: () => { setViews(prev => { const next = new Map(prev); next.delete(surface); return next }); setZoomDraft(null) },
    actual: () => setView({ zoom: 1, pan: { x: (avail.w - size.w) / 2, y: (avail.h - size.h) / 2 } }),
    fitSelection: () => { if (!selectionBox) return
        const b = selectionBox, fit = fitView({ w: Math.max(b.w, 1e-6), h: Math.max(b.h, 1e-6) }, avail)
        setView({ ...fit, pan: { x: avail.w / 2 - (b.x + b.w / 2) * fit.zoom, y: avail.h / 2 - (b.y + b.h / 2) * fit.zoom } }) },
    pan: (dx, dy) => setView({ ...v, pan: { x: pan.x + dx, y: pan.y + dy } }),
  }
  useLayoutEffect(() => {
    if (viewApi) viewApi.current = navigate ? api : null
    return () => { if (viewApi) viewApi.current = null }
  })
  const centre = { x: avail.w / 2, y: avail.h / 2 }
  const commitZoom = () => {
    if (zoomDraft !== null && zoomDraft.trim()) setView(zoomAt(v, centre, Number(zoomDraft) / (100 * zoom)))
    setZoomDraft(null)
  }
  useEffect(() => { setZoomDraft(null) }, [surface, navigate])

  const navigationKey = useEffectEvent((e: KeyboardEvent) => {
    if (!navigate || fixedZoom !== undefined) return
    if (e.key === ' ' && (e.type === 'keyup' || !ownsKeys(e.target) &&
      (!(e.target instanceof Element) || e.target === document.body || e.target.closest('.vb-overlay')))) {
      spaceHeld.current = e.type === 'keydown'; setSpace(spaceHeld.current); e.preventDefault()
    }
    if (e.key === 'Escape' && panning.current) {
      setView(panning.current.view); panning.current = null; e.preventDefault(); e.stopPropagation()
    }
    if (e.key === 'Escape' && pinch.current) {
      setView(pinch.current.view); pinch.current = null; e.preventDefault(); e.stopPropagation()
    }
  })
  useEffect(() => {
    const key = (e: KeyboardEvent) => navigationKey(e)
    const blur = () => { spaceHeld.current = false; setSpace(false); panning.current = pinch.current = null; touches.current.clear() }
    document.addEventListener('keydown', key, true); document.addEventListener('keyup', key, true)
    window.addEventListener('blur', blur)
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('keyup', key, true); window.removeEventListener('blur', blur) }
  }, [])

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setAvail({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(stage.current!)
    return () => ro.disconnect()
  }, [])

  // Without WebGL the page keeps its status and text layer, and says why the canvas is missing.
  const rendererChanged = useEffectEvent((r: Renderer | null) => onRenderer?.(r))
  useEffect(() => {
    let r: Renderer
    try { r = renderer.current = makeRenderer(canvas.current!) }
    catch (e) {
      console.error(e)
      setFailed(startFailure(e))
      return
    }
    // Without the cover, every label stays on top of the canvas; the page still works, and says why in the console.
    let c: Renderer | null = null
    try { c = cover.current = makeRenderer(coverCanvas.current!, true) }
    catch (e) { console.error(e) }
    rendererChanged(r)
    return () => { r.dispose(); c?.dispose(); renderer.current = cover.current = null; rendererChanged(null) }  // StrictMode makes them twice
  }, [])
  useEffect(() => {
    const faces = document.fonts as FontFaceSet | undefined
    const more = (e: Event) => {
      const fontfaces = (e as FontFaceSetLoadEvent).fontfaces
      if (!Array.isArray(fontfaces)) return
      setLoaded(prev => {
        const next = new Map(prev)
        for (const face of fontfaces) {
          const name = face.family.replace(/^['"]|['"]$/g, '')
          next.set(name, (next.get(name) ?? 0) + 1)
        }
        return next
      })
    }
    faces?.addEventListener?.('loadingdone', more)
    return () => faces?.removeEventListener?.('loadingdone', more)
  }, [])

  // A canvas clears its buffer when its width or height changes. Before the browser paints, the surface shown gets its own
  // last frame again, or the checker when it has none at this size (a new shape is drawn by the next frame, not
  // stretched): a resize or a page switch shows neither a blank canvas nor another page's art until the next frame.
  const last = useRef(new Map<string, { f: Frame; w: number; h: number }>())   // each surface's last frame, at its size
  const sizes = useRef(new Map<string, { w: number; h: number }>())   // each surface's size, as last shown
  useLayoutEffect(() => {
    sizes.current.set(surface, size)
    const l = last.current.get(surface), f = l && l.w === size.w && l.h === size.h ? l.f : NONE
    setShown(prev => ({ f, s: size, labels: labelsOf(f, prev?.labels) }))
  }, [surface, size.w, size.h, scale])

  // A frame asked for before a page switch is kept for its own surface, not drawn over another.
  const arrived = useEffectEvent((f: Frame, of: string) => {
    const at = sizes.current.get(of)
    if (at) last.current.set(of, { f, w: at.w, h: at.h })
    if (of !== surface) return
    if (renderer.current) pictures?.setTextureLimit(Math.min(renderer.current.maxTextureSize, cover.current?.maxTextureSize ?? Infinity))
    pictures?.observe(picturePage, [...f.pending ?? [], ...(f.images ?? []).map(i => i.src)])
    setShown(prev => ({ f, s: size, labels: labelsOf(f, prev?.labels) }))
    setFrame(f)
    onFrame?.(f)
  })
  useEffect(() => bridge.onFrame((f, _, of) => arrived(f, of)), [bridge])

  // Drawn once committed (layout effects run before the browser paints): the canvas; each label's box and text as the
  // text layer laid them out, when they may have moved; then the covers, each covered label's text set at its layer's
  // place among them (zIndex), and each deeper layer on a canvas of its own.
  useLayoutEffect(() => {
    if (shown) renderer.current?.draw(shown.f, shown.s, undefined, undefined, v, visible, src => pictures?.image(src))
  }, [shown, zoom, pan.x, pan.y, visible.w, visible.h, dpr])
  useLayoutEffect(() => {
    if (!shown) return
    const prev = measured.current, { labels, s } = shown
    const fontKeys = labels.map(t => labelFontKey(t, loaded))
    const changed = prev && prev.zoom === zoom && prev.w === s.w && prev.h === s.h
      ? new Set(labels.flatMap((t, i) => prev.labels[i] && sameLayout(t, prev.labels[i]) && prev.fontKeys[i] === fontKeys[i] ? [] : [i])) : undefined
    extents.current = measure(text.current!, zoom, extents.current, changed)
    measured.current = { labels, zoom, fontKeys, w: s.w, h: s.h }
  }, [shown?.labels, shown?.s.w, shown?.s.h, zoom, fonts, loaded])
  useLayoutEffect(() => {
    if (!shown || !cover.current) return
    const cs = covers(shown.f, shown.s, extents.current), copied = new Set<number>()
    const copy: Copy = (k, [x, y, w, h], [tw, th]) => {
      const source = coverCanvas.current
      if (!source || source.width <= 0 || source.height <= 0 || w <= 0 || h <= 0) return
      copied.add(k)
      const c = deeper.current[k - 1] ??= text.current!.appendChild(Object.assign(document.createElement('canvas'), { className: 'vb-cover' }))
      if (c.width !== w) c.width = w
      if (c.height !== h) c.height = h
      Object.assign(c.style, { left: `${x * visible.w / tw - pan.x}px`, top: `${y * visible.h / th - pan.y}px`,
        width: `${w * visible.w / tw}px`, height: `${h * visible.h / th}px`,
        zIndex: String(zIndex.cover(k)) })
      const g = c.getContext('2d')
      g?.clearRect(0, 0, w, h)
      g?.drawImage(source, x, y, w, h, 0, 0, w, h)
    }
    cover.current.draw(shown.f, shown.s, cs, copy, v, visible, src => pictures?.image(src))
    deeper.current.forEach((c, k) => { if (!copied.has(k + 1)) { c.width = 0; c.height = 0 } })
    const layers = cs.reduce((n, c) => Math.max(n, c.layer), 0), byLabel = new Map(cs.map(c => [c.label, c]))
    shown.f.textCovers = shown.f.text.filter(drawable).map((t, i) => byLabel.get(i)?.cover ?? t.cover)
    for (const c of deeper.current.splice(layers)) c?.remove()
    text.current!.querySelectorAll<HTMLElement>('[data-label]').forEach(e => {
      const c = byLabel.get(+e.dataset.label!), value = c ? String(zIndex.text(c.layer)) : ''
      if (e.style.zIndex !== value) e.style.zIndex = value
    })
  }, [shown, fonts, loaded, zoom, pan.x, pan.y, visible.w, visible.h, dpr])

  useEffect(() => {
    if (!(scale > 0 && visible.w > 0 && visible.h > 0)) return
    let raf = requestAnimationFrame(function loop() {
      bridge.frame(surface, scale, tag)
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [bridge, surface, scale, tag, visible.w, visible.h])

  // Up, cancel and a lost capture all end a press; only the first of them reports 'up', so a drag always ends once.
  const pointer = (kind: Pointer) => (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = held.current.get(e.pointerId), r = press ?? e.currentTarget.getBoundingClientRect()
    const view = press?.view ?? v
    const p = toSurface(view, { x: e.clientX - r.left, y: e.clientY - r.top })
    if (!navigate && (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h)) {
      if (kind === 'down' || !held.current.has(e.pointerId)) return
      p.x = Math.max(0, Math.min(size.w, p.x)); p.y = Math.max(0, Math.min(size.h, p.y))
    }
    if (kind === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId)  // a drag keeps reporting outside the surface
      held.current.set(e.pointerId, { left: r.left, top: r.top, view: { zoom: view.zoom, pan: { ...view.pan } } })
      if (navigate && !panning.current && (spaceHeld.current || e.button === 1)) {
        skip.current.add(e.pointerId)
        panning.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, view: v }
        e.preventDefault()
        return
      }
    }
    if (kind === 'up' && !held.current.delete(e.pointerId)) return
    if (navigate && e.pointerType === 'touch') {
      const point = { x: e.clientX, y: e.clientY }
      if (kind !== 'up') touches.current.set(e.pointerId, point)
      if (kind === 'down' && touches.current.size === 2 && !pinch.current) {
        const [a, b] = [...touches.current.entries()], origin = held.current.get(a[0])!
        const first = toSurface(origin.view, { x: a[1].x - origin.left, y: a[1].y - origin.top })
        const client = { x: (a[1].x + b[1].x) / 2, y: (a[1].y + b[1].y) / 2 }
        // The first finger may have begun drawing: a second finger turns that gesture into navigation.
        if (!skip.current.has(a[0])) onPointer?.('up', first.x, first.y, new PointerEvent('pointercancel', { pointerId: a[0], pointerType: 'touch' }))
        for (const id of touches.current.keys()) skip.current.add(id)
        panning.current = null
        pinch.current = { ids: [a[0], b[0]], distance: Math.hypot(b[1].x - a[1].x, b[1].y - a[1].y),
          centre: { x: client.x - origin.left, y: client.y - origin.top }, client, view: v }
        return
      }
      const gesture = pinch.current
      if (gesture) {
        if (kind === 'up') {
          if (e.type === 'pointercancel') setView(gesture.view)
          pinch.current = null
        } else if (gesture.ids.includes(e.pointerId)) {
          const [a, b] = gesture.ids.map(id => touches.current.get(id)!)
          const next = zoomAt(gesture.view, gesture.centre, Math.hypot(b.x - a.x, b.y - a.y) / gesture.distance)
          setView({ ...next, pan: { x: next.pan.x + (a.x + b.x) / 2 - gesture.client.x, y: next.pan.y + (a.y + b.y) / 2 - gesture.client.y } })
        }
        if (kind === 'up') { touches.current.delete(e.pointerId); skip.current.delete(e.pointerId) }
        return
      }
      if (kind === 'up') touches.current.delete(e.pointerId)
    }
    const drag = panning.current
    if (drag?.id === e.pointerId) {
      if (e.type === 'pointercancel') setView(drag.view)
      else setView({ ...drag.view, pan: { x: drag.view.pan.x + e.clientX - drag.start.x, y: drag.view.pan.y + e.clientY - drag.start.y } })
      if (kind === 'up') { panning.current = null; skip.current.delete(e.pointerId) }
      return
    }
    if (skip.current.has(e.pointerId)) { if (kind === 'up') skip.current.delete(e.pointerId); return }
    onPointer?.(kind, p.x, p.y, e.nativeEvent)
  }
  const up = pointer('up')

  // A native listener can prevent the browser's own Ctrl-wheel zoom (React's delegated wheel listener is passive).
  // Ctrl or Cmd with the wheel zooms at the pointer (a trackpad pinch arrives as Ctrl + wheel); a plain wheel or a
  // two-finger scroll pans, Shift turning a mouse wheel sideways.
  const wheel = useEffectEvent((e: WheelEvent) => {
    if (!navigate || fixedZoom !== undefined || panning.current) return
    e.preventDefault()
    const unit = (page: number) => e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page : 1
    if (e.ctrlKey || e.metaKey) {
      const r = stage.current!.getBoundingClientRect()
      setView(zoomAt(v, { x: e.clientX - r.left, y: e.clientY - r.top }, Math.exp(-e.deltaY * unit(avail.h) * 0.002)))
      return
    }
    const sideways = e.shiftKey && !e.deltaX
    setView({ ...v, pan: { x: v.pan.x - (sideways ? e.deltaY : e.deltaX) * unit(avail.w), y: v.pan.y - (sideways ? 0 : e.deltaY) * unit(avail.h) } })
  })
  useEffect(() => {
    const el = stage.current!, f = (e: WheelEvent) => wheel(e)
    el.addEventListener('wheel', f, { passive: false })
    return () => el.removeEventListener('wheel', f)
  }, [])

  const css = { width: size.w * zoom, height: size.h * zoom }
  const backing = { width: Math.floor(visible.w * dpr), height: Math.floor(visible.h * dpr) }
  const textSize = useMemo(() => ({ w: size.w, h: size.h }), [size.w, size.h])   // one object per size: the text layer's memo holds
  const controls = <div className="vb-view-controls" role="group" aria-label="Canvas view" onMouseDown={e => { if ((e.target as Element).closest('button')) e.preventDefault() }}>
      <label>Zoom <input aria-label="Zoom percent" type="number" min="1" max="6400" step="any" value={zoomDraft ?? Math.round(zoom * 10000) / 100}
        onChange={e => setZoomDraft(e.target.value)} onBlur={commitZoom}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setZoomDraft(null) }} /> %</label>
      <button type="button" aria-label="Fit page" onClick={api.fit}>Fit</button>
      <button type="button" aria-label="100 percent" onClick={api.actual}>100 %</button>
      <button type="button" aria-label="Fit selection" disabled={!selectionBox} onClick={api.fitSelection}>Fit selection</button>
      {([['left', -40, 0, '←'], ['right', 40, 0, '→'], ['up', 0, -40, '↑'], ['down', 0, 40, '↓']] as const).map(([name, x, y, label]) =>
        <button type="button" key={name} aria-label={`Pan ${name}`} onClick={() => api.pan(x, y)}>{label}</button>)}
      {!viewSlot && <span>Space-drag to pan</span>}
    </div>
  return <div ref={box} className="vb-canvas">
    {navigate && (viewSlot ? createPortal(controls, viewSlot) : viewApi ? null : controls)}
    <div ref={stage} className="vb-stage" style={fixedZoom === undefined ? undefined : { width: visible.w, height: visible.h, flex: 'none', margin: 'auto' }}>
      {failed
        ? <p className="vb-error" role="alert">{failed}</p>
        : <canvas ref={canvas} {...backing} style={{ width: visible.w, height: visible.h }} />}
      <div className="vb-overlay" onPointerDownCapture={e => {
        if (!navigate) return
        if (spaceHeld.current || e.button === 1 || e.pointerType === 'touch' && touches.current.size > 0) {
          pointer('down')(e); e.stopPropagation()
        } else if (e.pointerType === 'touch') {
          const r = e.currentTarget.getBoundingClientRect()
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          held.current.set(e.pointerId, { left: r.left, top: r.top, view: { zoom: v.zoom, pan: { ...v.pan } } })
        }
      }} onPointerDown={pointer('down')} onPointerMove={e => {
        const r = e.currentTarget.getBoundingClientRect()
        onHover?.(toSurface(v, { x: e.clientX - r.left, y: e.clientY - r.top }))
        pointer('move')(e)
      }} onPointerLeave={() => onHover?.(null)}
        onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} style={{ cursor: space ? 'grab' : undefined }}>
        <div className="vb-view" style={{ ...css, transform: `translate(${pan.x}px, ${pan.y}px)` }}>
        {/* Its own stacking context: the labels and the covers order among themselves, under the overlays. */}
        <div ref={text} className="vb-text" style={{ isolation: 'isolate' }}>
          <TextLayer labels={shown?.labels ?? NONE.text} zoom={zoom} size={textSize} scene={scene} />
          {!failed && <canvas ref={coverCanvas} className="vb-cover" {...backing}
            style={{ left: -pan.x, top: -pan.y, width: visible.w, height: visible.h, zIndex: zIndex.cover(0) }} />}
        </div>
        {children?.({ zoom, pan, frame })}
        </div>
      </div>
    </div>
    <div className="vb-canvas-chrome" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>{chrome?.({ zoom, pan, frame })}</div>
  </div>
}
