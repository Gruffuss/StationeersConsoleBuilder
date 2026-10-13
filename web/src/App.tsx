// The editor shell: a project's pages, previewed by the real core, with undo. A dev toggle keeps Task 5's mode that runs
// the vector examples as raw Lua (later browser checks and measurements need their data and tick).
import { inDialog } from './keys'
import { Sidebar } from './editor/shell/Sidebar'
import { Inspector } from './editor/shell/Inspector'
import { PageSettings } from './editor/shell/PageSettings'
import { DevicesRow } from './editor/shell/DevicesRow'
import { TaskBar } from './editor/shell/TaskBar'
import { FrameLabel } from './editor/shell/FrameLabel'
import { SourcePane } from './editor/shell/SourcePane'
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState, useMemo, useSyncExternalStore, type CSSProperties } from 'react'
import { SCENE_ELEMENT } from './codegen/lua'
import { generate, bannerSrc, exportScenes, hasVectorScene } from './codegen/generate'
import { hostOf, simOf } from './codegen/hostOf'
import { readTraps } from './codegen/checks'
import { mapError, type MapEntry } from './codegen/linemap'
import { devicesName } from './codegen/devicesPage'
import { loadCatalog, type Catalog } from './catalog'
import { ChipStore } from './runtime/chipStore'
import { DataPanel } from './editor/DataPanel'
import { LogicPanel } from './editor/LogicPanel'
import { CustomLuaPane } from './editor/CustomLuaPane'
import { SimPanel } from './editor/SimPanel'
import { NamesList } from './editor/logicUi'
import { makeCtx, shownOrder } from './editing/ctx'
import { unitsOf } from './editing/units'
import { shownNatives } from './editing/natives'
import { Header } from './editor/shell/Header'
import { ThemeMenu } from './editor/shell/ThemeMenu'
import { ToolRail } from './editor/shell/ToolRail'
import { StatusBar } from './editor/shell/StatusBar'
import { DevBar } from './editor/shell/DevBar'
import { menusOf } from './editor/shell/menus'
import { messagesOf } from './editor/shell/messages'
import { MessagesList } from './editor/shell/MessagesList'
import { pointerStore } from './editor/shell/pointer'
import { Dialog } from './ui/Dialog'
import { Icon } from './ui/icons'
import { pickNode } from './editing/pick'
import { TOOLS } from './editing/registry'
import { makeRouter } from './editing/router'
import { Breadcrumb } from './editor/Breadcrumb'
import { Layers } from './editor/Layers'
import { CaptureOverlay } from './editor/CaptureOverlay'
import { Canvas, type Renderer, type ViewApi } from './editor/Canvas'
import { CodePane } from './editor/CodePane'
import { ExamplePicker } from './editor/ExamplePicker'
import { FontImport } from './editor/FontImport'
import { ExportControls } from './editor/ExportControls'
import { SaveDialogs } from './editor/shell/SaveDialogs'
import { ShortcutsDialog } from './editor/shell/ShortcutsDialog'
import { createDialogs, DialogHost, ProjectDialogHost } from './editor/shell/DialogHost'
import { ProjectControls, saveJson } from './editor/ProjectControls'
import type { AdoptReport } from './project/adopt'
import { useDownloads } from './editor/downloads'
import { TemplatePicker } from './editor/TemplatePicker'
import { ThemeList } from './editor/ThemeList'
import { ThemeImport } from './editor/ThemeImport'
import { loadThemeLibrary, removeFromThemeLibrary, saveToThemeLibrary } from './theme/library'
import { clearFontNotices, fontsVersion, isKnownFont, subscribeFonts } from './editor/fonts'
import { previewFontWarning, sceneFontNames } from './editor/fontWarnings'
import { pageFontsVersion, subscribePageFonts } from './editor/pageFonts'
import { widgetBox } from './editor/Handles'
import { apply, bounds, viewbox, unview } from './editor/geometry'
import { spanBounds } from './editor/hitTest'
import { shearMatrix } from './editor/text'
import { NativeLayer } from './editor/NativeLayer'
import { PageTabs } from './editor/PageTabs'
import { Pictures } from './editor/pictures'
import { PictureControls } from './editor/PictureControls'
import { PropertyPanel } from './editor/PropertyPanel'
import { PendingColours } from './editor/PaintFields'
import { Selection } from './editor/Selection'
import { WidgetPalette } from './editor/WidgetPalette'
import { WidgetPanel } from './editor/WidgetPanel'
import { EXAMPLE_SIZE, ExampleScripts } from './ExampleScripts'
import { indexOfPath } from './model/numbering'
import { newProject, type Project } from './model/project'
import { ProjectTransfer } from './project/transfer'
import { fragmentToken } from './project/input'
import { readAutosave, writeAutosave, type SavedProject } from './project/autosave'
import type { Scene } from './model/scene'
import { initialState, reducer, selected, type Action, type State } from './model/store'
import { CoreBridge, type Status, type DeviceWrite } from './runtime/bridge'
import type { Frame } from './runtime/frame'
import { SceneChecker } from './srctext/checker'
import { patchFailure, statusLines } from './status'
import { linkNotSaved, pausedNotSaved, storageNotSaved } from './storageText'
import { GameMcp, gameEndpoint } from './runtime/gameMcp'
import { GameLink as GameSession } from './runtime/gameLink'
import { GameLink } from './editor/GameLink'
import { GameLinkStatus } from './editor/GameLinkStatus'
import { DevicePicker } from './editor/DevicePicker'
import { SendSection } from './editor/SendSection'
import { THEMES, themeOf, themesOf } from './theme'
import { nativeAt, widgetAt } from './widgets/core'

const defaultWorker = () => new Worker(new URL('./runtime/core.worker.ts', import.meta.url), { type: 'module' })
const defaultCheck = () => new Worker(new URL('./srctext/check.worker.ts', import.meta.url), { type: 'module' })
const defaultTransfer = () => new Worker(new URL('./project/transfer.worker.ts', import.meta.url), { type: 'module' })
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const unsubscribed = () => () => {}

// What the preview holds: the page layout of the last load and the scenes sent since, the last valid project, and
// what waits to be sent (each surface's src and the scene it prints). `reloaded`: a restart was answered with a load and
// no frame has arrived since.
type Preview = { layout: string; scenes: Map<string, Scene>; vectors: Set<string>; good: Project | null
  patches: Map<string, { src: string; scene: Scene }>; reloaded: boolean }
// A scene change patches; export config, host shape and simulated source keys determine whether to reload.
const keyOf = (p: Project, catalog: Catalog | null) => generate(p, () => '').lua + JSON.stringify(hostOf(p, catalog, null, { values: false }).host)
  + JSON.stringify(Object.entries(simOf(p, catalog).values ?? {}).map(([ref, values]) => [ref, Object.keys(values).sort()]))

const pageOf = (s: State) => s.project.pages.find(p => p.id === s.activePageId) ?? s.project.pages[0]

/** `makeWorker` starts the core's worker, `makeCheckWorker` a scene checker's (tests hand in fakes). */
export function App({ makeWorker = defaultWorker, makeCheckWorker = defaultCheck, makeTransferWorker = defaultTransfer, makeExportWorker = defaultWorker, makeCaptureWorker = defaultWorker }: {
  makeWorker?: () => Worker; makeCheckWorker?: () => Worker; makeTransferWorker?: () => Worker; makeExportWorker?: () => Worker; makeCaptureWorker?: () => Worker
} = {}) {
  const download = useDownloads()
  const [themeLibrary, setThemeLibrary] = useState(loadThemeLibrary)
  const [dialogs] = useState(createDialogs)
  // The game link (M6 Task 10, OQ17 (a)): one per tab, in memory only; it asks the game nothing until the player clicks.
  const [game] = useState(() => new GameSession(new GameMcp({ endpoint: gameEndpoint() })))
  const { setDialog, setProjectDialog } = dialogs
  // The status bar's game item: one element for the tab, so it never mounts or re-wraps with a gesture (hook H3).
  const gameStatus = useMemo(() => <GameLinkStatus link={game} onOpen={() => setDialog('game')} />, [game, setDialog])
  const [sourceOpen, setSourceOpen] = useState(true), [messagesOpen, setMessagesOpen] = useState(false)
  const [saveRequest, setSaveRequest] = useState(0)
  const [diagnostics, setDiagnostics] = useState({ errors: 0, warnings: 0 })
  const [gap, setGap] = useState('10'), [viewSlot, setViewSlot] = useState<HTMLDivElement | null>(null)
  const viewApi = useRef<ViewApi | null>(null)
  const [exportTransfer, setExportTransfer] = useState<ProjectTransfer | null>(null)
  useEffect(() => {
    const transfer = new ProjectTransfer(makeTransferWorker)
    setExportTransfer(transfer)
    return () => transfer.dispose()
  }, [makeTransferWorker])
  const [bridge, setBridge] = useState<CoreBridge | null>(null)
  const [pictures] = useState(() => new Pictures())
  useSyncExternalStore(pictures.subscribe, () => pictures.version, () => pictures.version)
  useEffect(() => { pictures.connect(bridge); return () => pictures.connect(null) }, [bridge, pictures])
  useEffect(() => () => pictures.dispose(), [pictures])
  // Made in an effect, as the bridge is: StrictMode runs the cleanup and the setup again, and a disposed checker is dead.
  const [checker, setChecker] = useState<SceneChecker | null>(null)
  const checkerRef = useRef<SceneChecker | null>(null)   // for the editing context, made once
  checkerRef.current = checker
  useEffect(() => {
    const c = new SceneChecker(makeCheckWorker)
    setChecker(c)
    return () => c.dispose()
  }, [makeCheckWorker])
  const landed = useSyncExternalStore(checker?.subscribe ?? unsubscribed, () => checker?.version ?? -1)   // a landed check renders again
  // The store sits in a ref and a dispatch updates it at once, so a drag reads the state it just wrote even before the
  // render that shows it.
  const [store] = useState(() => ({ state: initialState() }))
  const [, rendered] = useReducer((n: number) => n + 1, 0)
  const get = useCallback(() => store.state, [store])
  const pageNow = (id: string) => get().project.pages.find(p => p.id === id)
  const sceneOf = (id: string) => pageNow(id)?.scene   // the panels' commits that land late ask the store
  const themeNow = () => themeOf(get().project)
  const state = store.state
  const [tab, setTab] = useState<'Design' | 'Data' | 'Logic' | 'Sim' | 'Lua'>('Design')
  const [sidebarTab, setSidebarTab] = useState<'Layers' | 'Widgets'>('Layers')
  const [play, setPlay] = useState(false)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [active, setActive] = useState('main')       // the surface the chip last activated (Status.active)
  const [writes, setWrites] = useState<DeviceWrite[]>([])
  const chipStore = useRef(new ChipStore())
  const [chipRevision, replaceChip] = useReducer((n: number) => n + 1, 0)
  const lastPointer = useRef({ x: 0, y: 0 })
  const sentSim = useRef('')
  const visited = useRef<string | null>(null)   // the page the chip was last asked to show; null before the first load
  const [loadedPages, setLoadedPages] = useState(new Set<string>())
  const loadedShape = useRef('')                // the loaded host's simulated devices without values (item 9)
  const [scripts, setScripts] = useState(false)   // the dev "Run example script" mode
  const [compare, setCompare] = useState(false)   // dev, in that mode: a console capture over the canvas
  const [renderer, setRenderer] = useState<Renderer | null>(null)
  const [example, setExample] = useState('')   // the example script last sent, in that mode
  const [exampleFontScene, setExampleFontScene] = useState<Scene | undefined>()
  const [core, setCore] = useState('booting the core…')
  const [run, setRun] = useState<Status | null>(null)
  const [patchError, setPatchError] = useState('')   // the last patch's failure, kept until a patch succeeds or a load
  const [problems, setProblems] = useState('')
  const preview = useRef<Preview>({ layout: '', scenes: new Map(), vectors: new Set(), good: null, patches: new Map(), reloaded: false })
  const shown = useRef<Frame | null>(null)   // the frame on the canvas
  const [note, setNote] = useState('')   // the editing layer's status line (ctx.note)
  const [adoption, setAdoption] = useState<AdoptReport | null>(null)
  const asked = useRef(new Map<string, Scene[]>())
  const [phase, setPhase] = useState<'loading' | 'choice' | 'ready'>('loading')
  const started = phase === 'ready'
  const startRef = useRef(false)
  const transferRef = useRef<ProjectTransfer | null>(null)
  const startupRound = useRef(0)
  const fragmentRead = useRef<{ token: string; pending: boolean; retry: boolean; error?: string } | null>(null)
  const pendingStartup = useRef<{ project: Project; notice: string; token?: string } | null>(null)
  const saving = useRef({ revision: 0, known: false, paused: true, generation: 0, rotate: false, token: null as string | null,
    saved: null as Project | null, failure: null as 'conflict' | 'unavailable' | null,
    sent: null as { text: string; project: Project; generation: number; token: string | null } | null })
  const loadMode = useRef<{ token?: string; restore: boolean } | null>(null)
  const saveQueue = useRef<{ transfer: ProjectTransfer; busy: boolean; timer?: ReturnType<typeof setTimeout>;
    pending: { project: Project; generation: number; token: string | null } | null } | null>(null)
  const [discoveredSave, setDiscoveredSave] = useState(false)
  const [storageMessage, setStorageMessage] = useState('Loading saved project…')
  const [slots, setSlots] = useState<{ current: SavedProject | null; recovery: SavedProject | null }>({ current: null, recovery: null })
  const resetProjectRuntime = useCallback((next: State) => {
    setAdoption(null)
    pictures.clearPages()
    setDiscoveredSave(false)
    clearFontNotices()
    chipStore.current = new ChipStore()
    setWrites([])
    setActive(next.project.pages[0].surface)
    sentSim.current = ''
    visited.current = null
    loadedShape.current = ''
    preview.current = { layout: '', scenes: new Map(), vectors: new Set(), good: null, patches: new Map(), reloaded: false }
    asked.current.clear()
    shown.current = null
    setRun(null)
    setPatchError('')
    setProblems('')
    // Startup's worker is pristine; later loads must discard queued operations and late statuses.
    if (startRef.current) { setCore('booting the core…'); replaceChip() }
    setLoadedPages(new Set())
  }, [])
  const dispatch = useCallback((a: Action) => {
    if (!startRef.current) return
    const next = reducer(store.state, a)
    if (next === store.state) return
    store.state = next
    if (a.type === 'loadProject') {
      ++startupRound.current
      ++saving.current.generation
      saving.current.rotate = !loadMode.current?.restore
      saving.current.token = loadMode.current?.token ?? null
      saving.current.saved = loadMode.current?.restore ? next.project : null
      if (!loadMode.current?.token) { fragmentRead.current = null; removeProjectFragment() }
      resetProjectRuntime(next)
    }
    rendered()
  }, [store, resetProjectRuntime])

  function removeProjectFragment(expected?: string) {
    const url = new URL(location.href), params = new URLSearchParams(url.hash.slice(1))
    if (expected !== undefined && (params.getAll('p').length !== 1 || params.get('p') !== expected)) return
    if (!params.has('p')) return
    params.delete('p')
    url.hash = params.toString()
    history.replaceState(history.state, '', url.href)
  }
  function restoreProjectFragment(token: string) {
    const url = new URL(location.href), params = new URLSearchParams(url.hash.slice(1))
    if (params.has('p')) return
    params.set('p', token)
    url.hash = params.toString()
    history.replaceState(history.state, '', url.href)
  }
  async function readFragment(transfer: ProjectTransfer, round: number) {
    let attempt = fragmentRead.current
    const active = () => transferRef.current === transfer && round === startupRound.current
    try {
      const hash = location.hash, params = new URLSearchParams(hash.slice(1))
      if (params.has('p')) {
        attempt = { token: params.get('p') ?? '', pending: true, retry: false }
        fragmentRead.current = attempt
        removeProjectFragment()
        attempt.token = fragmentToken(hash)!
      } else if (attempt?.error) return { error: attempt.error, retry: attempt.retry }
      else if (!attempt?.pending) { fragmentRead.current = null; return null }
      // StrictMode restarts the effect with the same refs; a real remount has no token to retry.
      const token = attempt!.token
      const read = await transfer.read(token, 'token')
      if (active()) { attempt!.pending = false; attempt!.retry = true; restoreProjectFragment(token) }
      return { ...read, token }
    } catch (error) {
      const retry = /could not complete here|Project transfer failed|Project transfer returned an unreadable reply/.test(message(error))
      if (active() && attempt) {
        attempt.pending = false; attempt.retry = retry; attempt.error = message(error)
        if (retry) restoreProjectFragment(attempt.token)
      }
      return { error: message(error), retry }
    }
  }
  function installStartup(read: { project: Project; notice: string }) {
    store.state = { ...initialState(read.project), notice: read.notice }
    resetProjectRuntime(store.state)
    setNote(read.notice)
    startRef.current = true
    setPhase('ready')
    rendered()
  }
  function onLoad(project: Project, notice = '', token?: string, restore = false) {
    loadMode.current = { token, restore }
    dispatch({ type: 'loadProject', project })
    loadMode.current = null
    setNote(notice)
  }
  async function startStartup(transfer: ProjectTransfer) {
    const round = ++startupRound.current
    startRef.current = false
    setPhase('loading')
    setStorageMessage('Loading saved project…')
    const fragment = readFragment(transfer, round)
    const [storage, link] = await Promise.all([readAutosave(), fragment])
    if (transferRef.current !== transfer || round !== startupRound.current) return
    const current = storage.kind === 'ready' ? storage.current : null
    setSlots({ current, recovery: storage.recovery ?? null })
    saving.current.revision = current?.revision ?? 0
    saving.current.known = storage.kind === 'ready'
    saving.current.paused = storage.kind !== 'ready'
    saving.current.failure = storage.kind === 'ready' ? null : 'unavailable'
    pendingStartup.current = link && 'project' in link ? link : null
    if (link && 'error' in link) {
      setPhase('choice')
      setStorageMessage(linkNotSaved(String(link.error), !!link.retry))
      return
    }
    if (storage.kind === 'unavailable') {
      setPhase('choice')
      setStorageMessage(storageNotSaved(storage.reason, !!fragmentRead.current?.retry))
      return
    }
    try {
      const read = link ?? (current ? await transfer.read(current.text, 'json') : { project: newProject(), notice: '' })
      if (transferRef.current !== transfer || round !== startupRound.current) return
      ++saving.current.generation
      saving.current.saved = !link && current ? read.project : null
      saving.current.rotate = !!link
      saving.current.token = link?.token ?? null
      installStartup({ ...read, notice: [read.notice, storage.notice].filter(Boolean).join('\n') })
      setStorageMessage('')
    } catch (error) {
      if (transferRef.current !== transfer || round !== startupRound.current) return
      setPhase('choice')
      saving.current.known = false
      pauseSave(message(error))
    }
  }
  async function openStored(record: SavedProject, restore: boolean) {
    const transfer = transferRef.current, round = ++startupRound.current
    if (!transfer) return
    try {
      const read = await transfer.read(record.text, 'json')
      if (transferRef.current !== transfer || round !== startupRound.current) return
      fragmentRead.current = null
      removeProjectFragment()
      saving.current.saved = restore ? read.project : null
      saving.current.rotate = !restore
      saving.current.token = null
      if (startRef.current) onLoad(read.project, read.notice, undefined, restore)
      else { ++saving.current.generation; installStartup(read) }
      if (!saving.current.paused) setStorageMessage('')
    } catch (error) {
      if (transferRef.current === transfer && round === startupRound.current) pauseSave(message(error))
    }
  }
  function chooseBlank() {
    ++startupRound.current
    fragmentRead.current = null
    removeProjectFragment()
    saving.current.rotate = true
    saving.current.token = null
    saving.current.saved = null
    const project = newProject()
    if (startRef.current) onLoad(project)
    else { ++saving.current.generation; installStartup({ project, notice: '' }) }
    if (!saving.current.paused) setStorageMessage('')
  }
  function continueUnsaved() {
    ++startupRound.current
    saving.current.paused = true
    ++saving.current.generation
    saving.current.token = pendingStartup.current?.token ?? null
    saving.current.rotate = true
    installStartup(pendingStartup.current ?? { project: newProject(), notice: '' })
  }
  function pauseSave(reason: string, conflict?: SavedProject) {
    reason = reason.trimEnd()
    setDiscoveredSave(false)
    saving.current.paused = true
    saving.current.failure = conflict ? 'conflict' : 'unavailable'
    if (conflict) setSlots(s => ({ ...s, current: conflict }))
    const queue = saveQueue.current
    if (queue) { clearTimeout(queue.timer); queue.pending = null }
    setStorageMessage(pausedNotSaved(reason, !!fragmentRead.current?.retry))
  }
  function confirmSave(record: SavedProject, snapshot: NonNullable<typeof saving.current.sent>) {
    saving.current.revision = record.revision
    saving.current.known = true
    saving.current.saved = snapshot.project
    const current = get()
    if (saving.current.generation === snapshot.generation) {
      saving.current.rotate = false
      if ((current.dragBase ?? current.project) === snapshot.project) {
        if (snapshot.token) {
          removeProjectFragment(snapshot.token)
          if (fragmentRead.current?.token === snapshot.token) fragmentRead.current = null
        }
        saving.current.token = null
        setStorageMessage('Saved' + (fragmentRead.current?.retry ? '. Reload will retry the project link.' : ''))
      }
    }
  }
  async function pumpSave(queue: NonNullable<typeof saveQueue.current>) {
    if (queue.busy || saving.current.paused || saveQueue.current !== queue) return
    queue.busy = true
    try {
      while (queue.pending && !saving.current.paused && saveQueue.current === queue) {
        const snapshot = queue.pending
        queue.pending = null
        if (snapshot.project === saving.current.saved && !saving.current.rotate) continue
        const text = await queue.transfer.text(snapshot.project)
        if (saveQueue.current !== queue) return
        const now = get(), latest = now.dragBase ?? now.project
        if (latest !== snapshot.project || saving.current.generation !== snapshot.generation) continue
        const rotate = saving.current.rotate
        const sent = { ...snapshot, text }
        saving.current.sent = sent
        const result = await writeAutosave(text, saving.current.revision, new Date().toISOString(), rotate)
        if (saveQueue.current !== queue) return
        if (result.kind === 'unavailable' || (result.kind === 'conflict' && result.record.text !== text)) {
          if (result.kind === 'conflict') pauseSave('Conflict: another tab saved a newer project', result.record)
          else pauseSave(result.reason)
          break
        }
        confirmSave(result.record, sent)
      }
    } catch (error) {
      if (saveQueue.current === queue) pauseSave(message(error))
    } finally { queue.busy = false }
  }
  function enqueueSave(queue: NonNullable<typeof saveQueue.current>) {
    if (!startRef.current || saving.current.paused || saveQueue.current !== queue) return
    const state = get(), project = state.dragBase ?? state.project
    // An in-flight write may displace this currently saved snapshot.
    if (project === saving.current.saved && !saving.current.rotate && !queue.busy) return
    queue.pending = { project, generation: saving.current.generation, token: saving.current.token }
    void pumpSave(queue)
  }
  function scheduleSave() {
    const queue = saveQueue.current
    if (!queue) return
    clearTimeout(queue.timer)
    if (!startRef.current || saving.current.paused) return
    const state = get(), project = state.dragBase ?? state.project
    if (project === saving.current.saved && !saving.current.rotate && !queue.busy) {
      setStorageMessage(previous => previous.startsWith('Saved') ? previous : '')
      return
    }
    setStorageMessage('Not saved: changes are waiting for autosave')
    queue.timer = setTimeout(() => enqueueSave(queue), 500)
  }
  async function retryAutosave(reload = false, replaceDiscovered = false) {
    const transfer = transferRef.current
    if (!transfer) return
    if (!startRef.current && !reload) { void startStartup(transfer); return }
    const round = ++startupRound.current
    saving.current.paused = true
    const storage = await readAutosave()
    if (transferRef.current !== transfer || round !== startupRound.current) return
    if (storage.kind === 'unavailable') { setSlots(s => ({ ...s, recovery: storage.recovery ?? s.recovery })); pauseSave(storage.reason); return }
    setSlots({ current: storage.current, recovery: storage.recovery })
    const revision = storage.current?.revision ?? 0
    if (!reload && saving.current.known && revision !== saving.current.revision) {
      const sent = saving.current.sent
      // A lost commit acknowledgement can be reconciled only against the exact payload we issued.
      if (sent && storage.current?.text === sent.text) confirmSave(storage.current, sent)
      else {
        if (storage.current) pauseSave('Conflict: another tab saved a newer project', storage.current)
        else pauseSave('The saved project is missing; choose Blank explicitly')
        return
      }
    }
    if (reload && !storage.current) { pauseSave('No saved project to reload; choose Blank explicitly'); return }
    if (!reload && storage.current) {
      try {
        const read = await transfer.read(storage.current.text, 'json')
        if (transferRef.current !== transfer || round !== startupRound.current) return
        if ((!saving.current.known || discoveredSave) && !replaceDiscovered) {
          saving.current.revision = revision; saving.current.known = true; saving.current.failure = null
          setDiscoveredSave(true)
          setStorageMessage('Not saved: Retry found saved project "' + read.project.name + '". Reload it, or save the current project instead. Saving current will move the saved project to recovery and replace the recovery project. Autosave paused until you choose.')
          return
        }
      }
      catch (error) {
        if (transferRef.current === transfer && round === startupRound.current) pauseSave(message(error))
        return
      }
      if (transferRef.current !== transfer || round !== startupRound.current) return
    }
    setDiscoveredSave(false)
    saving.current.revision = revision
    saving.current.known = true
    saving.current.paused = false
    saving.current.failure = null
    if (reload) await openStored(storage.current!, true)
    else scheduleSave()
    if (storage.notice) setNote(previous => [previous, storage.notice].filter(Boolean).join('\n'))
  }
  async function downloadProjectJson() {
    const transfer = transferRef.current
    if (!transfer) return
    const state = get(), project = state.dragBase ?? state.project
    try {
      await saveJson(project, transfer, download, () => transferRef.current === transfer)
    } catch (error) { if (transferRef.current === transfer) setNote('JSON download failed: ' + message(error) + '; keep the original JSON file') }
  }
  async function loadFragment(transfer: ProjectTransfer) {
    if (!new URLSearchParams(location.hash.slice(1)).has('p')) return
    if (!startRef.current) { void startStartup(transfer); return }
    const round = ++startupRound.current
    try {
      const read = await readFragment(transfer, round)
      if (transferRef.current !== transfer || round !== startupRound.current || !read) return
      if ('error' in read) setNote(read.error + (read.retry ? '. Reload will retry the project link.' : ''))
      else onLoad(read.project, read.notice, read.token)
    } catch (error) {
      if (transferRef.current === transfer && round === startupRound.current) setNote(message(error))
    }
  }
  useEffect(() => {
    const transfer = new ProjectTransfer(makeTransferWorker)
    transferRef.current = transfer
    const queue: NonNullable<typeof saveQueue.current> = { transfer, busy: false, pending: null }
    saveQueue.current = queue
    const pagehide = () => { clearTimeout(queue.timer); enqueueSave(queue) }
    const hashchange = () => { void loadFragment(transfer) }
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('hashchange', hashchange)
    void startStartup(transfer)
    return () => {
      if (transferRef.current === transfer) transferRef.current = null
      if (saveQueue.current === queue) saveQueue.current = null
      clearTimeout(queue.timer)
      queue.pending = null
      window.removeEventListener('pagehide', pagehide)
      window.removeEventListener('hashchange', hashchange)
      ++startupRound.current
      startRef.current = false
      transfer.dispose()
    }
  }, [makeTransferWorker])
  // The editing layer (M2c): one context over this store, and the router that gives the canvas's pointer to the active
  // tool and the document's keys to the open gesture, the commands and the tools.
  const [editor] = useState(() => {
    const ctx = makeCtx({ get, dispatch, checker: () => checkerRef.current, frame: () => shown.current, redraw: rendered, note: setNote,
      pick: px => { const page = pageOf(store.state); return pickNode(shown.current, page, shownOrder(shown.current, page, ctx.order()), px) } })
    return { ctx, router: makeRouter(ctx) }
  })
  const { project } = state
  const page = pageOf(state)
  const picturePage = scripts ? 'main' : play ? project.pages.find(p => p.surface === active)?.id ?? active : page.id
  const canvasSize = scripts ? EXAMPLE_SIZE : play ? project.pages.find(p => p.surface === active)?.size ?? project.pages[0].size : page.size
  const hostNotes = useMemo(() => hostOf(project, catalog, null).notes, [project.simDevices, catalog])
  const committed = state.dragBase ?? project
  useEffect(() => {
    scheduleSave()
    return () => { clearTimeout(saveQueue.current?.timer) }
  }, [committed, started])
  const committedReady = committed.pages.every(p => checker?.get(p.scene) !== undefined)
  useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)
  useSyncExternalStore(subscribePageFonts, pageFontsVersion, pageFontsVersion)
  const gen = useMemo(() => generate(committed, pg => committedReady ? checker!.get(pg.scene)!.src! : ''), [committed, checker, committedReady])
  const previewScene = play ? project.pages.find(p => p.surface === active)?.scene ?? page.scene : page.scene
  const previewNames = useMemo(() => sceneFontNames(previewScene), [previewScene])
  const fontNote = previewFontWarning(previewScene, previewNames.attributes.filter(n => !isKnownFont(n)), previewNames.tags.filter(n => !isKnownFont(n)))
  const readable = !!gen.lua
  const traps = useMemo(() => readable ? readTraps(committed, themeOf(committed)) : [], [committed, readable])
  useEffect(() => {
    if (!catalog && (['Data', 'Logic', 'Sim'].includes(tab) || project.roles.length || project.simDevices.length))
      void loadCatalog().then(setCatalog).catch(e => setNote(`catalogue failed to load: ${e instanceof Error ? e.message : e}`))
  }, [catalog, tab, project.roles.length, project.simDevices.length])
  const selection = state.selection?.pageId === page.id ? state.selection : null
  const theme = themeOf(project)
  const themeNames = useMemo(() => new Map([...themesOf(project), ...themeLibrary.themes].map(t => [t.id, t.name])), [project.themes, themeLibrary.themes])
  const themeTaken = useMemo(() => new Set([...themesOf(project), ...themeLibrary.themes].map(t => t.id)), [project.themes, themeLibrary.themes])
  const widget = selection && !selection.inDefs ? widgetAt(page.scene, selection.path, theme) : null   // a widget root (Q2)
  const native = selection?.native ? nativeAt(page, selection.native, theme) : null   // a native widget (Q10)
  const chosen = widget ?? native   // what the widget form shows (WidgetPanel) instead of the property panel
  // Every page's check, once it has landed. A page with src is clean; one too large to check here is not invalid, but
  // is not sent either, so its reason is information. `asked`: per page, the scenes asked to be checked since the one
  // last sent, oldest first (the checker answers in that order), for the patch sender.
  useEffect(() => {
    if (!started || !checker) return
    for (const p of project.pages) {
      void checker.check(p.scene)
      const l = asked.current.get(p.id) ?? []
      if (l[l.length - 1] !== p.scene) asked.current.set(p.id, [...l, p.scene])
    }
  }, [project, checker, started])
  const checks = project.pages.map(p => checker?.get(p.scene))
  const ready = checks.every(c => c !== undefined)
  const issues = project.pages.flatMap((p, k) => (checks[k]?.errors ?? []).map(e => `${checks[k]!.tooLarge ? 'info: ' : ''}${p.name}: ${e.message}`))
  const issuesKey = issues.join('\n')
  const order = editor.ctx.order()
  // The dev scripts mode edits nothing: its keys stay unrouted (no tool key, command or undo acts on the hidden project).
  const routeKey = useEffectEvent((e: KeyboardEvent) => { if (startRef.current && !scripts && !play && !inDialog(e.target)) editor.router.key(e) })
  useEffect(() => {
    const key = (e: KeyboardEvent) => routeKey(e)
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  // Loads a project whose pages all checked clean (the patch effect's last good one), so each has its src. Each
  // surface's ui:size() is its page's size.
  const load = useEffectEvent((b: CoreBridge, p: Project, restart = false) => {
    const { lua, map, pages } = generate(p, pg => checker?.get(pg.scene)?.src!)
    if (!lua) return false
    // Size the Devices surface only when a role scans the network; other surfaces use their own page size.
    const devices = p.roles.some(r => r.pin === undefined && r.ref === undefined)
    const sizes = Object.fromEntries([...p.pages.map(x => [x.surface, x.size] as const), ...devices ? [[devicesName(p), p.pages[0].size] as const] : []])
    b.load(lua, (p.pages.find(x => x.id === state.activePageId) ?? p.pages[0]).size, sizes, Object.fromEntries(p.pages.map(x => [x.surface, x.scene])),
      () => {
        chipStore.current.beforeLoad(lua, !restart && p.settings.wipeOnReexport)
        setActive(p.pages[0].surface)
        setLoadedPages(new Set(p.pages.map(x => x.id)))
        return JSON.stringify(hostOf(p, catalog, chipStore.current).host)
      }, map)
    preview.current.vectors = new Set(pages.filter(pg => !pg.empty).map(pg => pg.id))
    sentSim.current = JSON.stringify(simOf(p, catalog))
    loadedShape.current = JSON.stringify(hostOf(p, catalog, null, { values: false }).host.devices)
    if (!play) { b.visit(state.activePageId); visited.current = state.activePageId }
    return true
  })

  // A restart leaves an empty chip: load the project again. If that load is followed by another restart before any
  // frame, stop there instead of restarting forever; the next edit loads it.
  const restarted = useEffectEvent((b: CoreBridge) => {
    const v = preview.current
    v.patches.clear()
    if (scripts || !v.good) return
    if (v.reloaded) {
      v.reloaded = false
      v.layout = ''
      return
    }
    v.reloaded = true
    load(b, v.good, true)
  })

  useEffect(() => {
    let carried: string | null = null   // the chip's error, as the last load or tick reported it
    const b = new CoreBridge(makeWorker, {
      ready: ms => { pictures.connect(b); setCore(`core ready in ${Math.round(ms)} ms`) },   // a restarted core is no longer halted
      status: (s, request, loadedFrom) => {
        chipStore.current.update(s)
        if (s.active) setActive(s.active)
        if (s.writes?.length) setWrites(w => [...w, ...s.writes!].slice(-50))
        if (request === 'patch' || request === 'pointer' || request === 'visit' || request === 'sim') return setPatchError(patchFailure(s, carried))
        carried = s.error
        if (request === 'load') setPatchError('')   // a new chip (a project or an example script): older failures are not its
        setRun(s.error ? { ...s, error: mapError(s.error, loadedFrom as MapEntry[] ?? []) } : s)
      },
      halted: why => {
        setCore(`halted: ${why}`)
        setRun(null)
        setPatchError('')
        setProblems('')
        restarted(b)
      },
    })
    preview.current.layout = ''   // a new chip holds nothing
    visited.current = null
    setLoadedPages(new Set())
    setBridge(b)
    return () => b.dispose()
  }, [chipRevision])

  // Checked scenes patch at once, including a drag's last landed check. Only the pause computes the reload key.
  useEffect(() => {
    if (!started || !bridge || scripts) return
    const v = preview.current
    if (ready && !issues.length) {
      if (v.layout) project.pages.forEach((p, k) => {
        if (v.scenes.has(p.id) && v.scenes.get(p.id) !== p.scene && v.vectors.has(p.id) && hasVectorScene(p.scene))
          v.patches.set(p.surface, { src: checks[k]!.src! + bannerSrc(p.scene.header), scene: p.scene })
      })
      v.scenes = new Map(project.pages.map(p => [p.id, p.scene]))
      v.good = project
      asked.current.clear()
    } else if (checker && v.good && v.layout && !issues.length) {
      for (const p of project.pages) {
        const l = asked.current.get(p.id) ?? []
        let k = l.length - 1
        while (k >= 0 && checker.get(l[k]) === undefined) k--
        if (k < 0) continue
        const s = l[k]
        asked.current.set(p.id, l.slice(k))
        const src = checker.get(s)!.src
        if (src != null && v.scenes.has(p.id) && v.scenes.get(p.id) !== s && v.vectors.has(p.id) && hasVectorScene(s)) {
          v.patches.set(p.surface, { src: src + bannerSrc(s.header), scene: s })
          v.scenes.set(p.id, s)
        }
      }
    }
    const timer = !state.dragBase && ready && !issues.length ? setTimeout(() => {
      const layout = keyOf(project, catalog)
      if (layout === v.layout) return
      if (!load(bridge, project)) return
      v.layout = layout
      v.patches.clear()
    }, 150) : undefined
    const raf = v.patches.size ? requestAnimationFrame(() => {
      for (const [surface, { src, scene }] of v.patches) bridge.patch(surface, SCENE_ELEMENT, src, scene)
      v.patches.clear()
    }) : undefined
    return () => { clearTimeout(timer); if (raf !== undefined) cancelAnimationFrame(raf) }
  }, [bridge, project, state.dragBase, issuesKey, ready, scripts, landed, catalog, started])

  // Selecting a page in edit mode shows it in the chip. A load visits the editor's page itself, so this waits for one and skips
  // the page just visited; it never patches: a patch of a page the chip has not built becomes its declaration (ruling P19).
  useEffect(() => {
    if (play) { visited.current = null; return }
    if (!bridge || scripts || !preview.current.layout || !loadedPages.has(page.id) || visited.current === page.id) return
    visited.current = page.id
    bridge.visit(page.id)
  }, [bridge, page.id, play, loadedPages])

  useEffect(() => {
    if (!started || !bridge || scripts) return
    const json = JSON.stringify(simOf(project, catalog))
    if (json === sentSim.current) return
    // Same devices, same access, same pins: only values moved, so they go out now; anything else waits for item 3's key check.
    if (JSON.stringify(hostOf(project, catalog, null, { values: false }).host.devices) === loadedShape.current) { sentSim.current = json; bridge.sim(json) }
  }, [bridge, project, catalog, started])

  // The set shown: on the active page (`selection` is null for one left on another page, and the others share its page).
  // The store's notice: what the last code-pane edit or load did besides the edit (a widget detached, natives left out).
  const status = statusLines(core, run, [storageMessage, note === state.notice ? '' : note, state.notice, selection && state.also.length ? `${state.also.length + 1} selected (the panel shows the last)` : '',
    patchError, ...(scripts ? [] : [...issues, ...(fontNote ? [`Preview fonts: ${fontNote}`] : []), ...(ready && !issues.length ? gen.problems.map(p => `${p.level}: ${p.message}`) : []),
      ...traps.map(p => `${p.level}: ${p.message}`), ...hostNotes.map(n => `info: ${n}`)]), problems])
  const fitKey = JSON.stringify(selected(state))
  const fitBoxes = useMemo(() => {
    const set = selected(state).filter(s => s.pageId === page.id && !s.inDefs)
    const boxes = new Map(unitsOf(page.scene, set, theme, page.natives).map(u => [u.sel, u.box]))
    const natives = new Map(shownNatives(page, theme).map(n => [n.uid, n.el.box]))
    return set.map(s => ({ s, b: s.native ? natives.get(s.native) : boxes.get(s) }))
  }, [page.scene, page.id, page.natives, theme, fitKey])
  const selectionBox = useMemo(() => {
    const fitPoints: number[] = [], unit = viewbox(page.scene.header, page.size)
    for (const { s, b } of fitBoxes) {
      if (b) for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y + b.h]]) fitPoints.push(...apply(unit, x, y))
      else if (!s.native && shownOrder(shown.current, page, order) && shown.current) {
        const element = shown.current.elements.findIndex(e => e.id === SCENE_ELEMENT && e.scene === page.id)
        const node = indexOfPath(order!, page.scene.root, s.path), box = node === null ? null : spanBounds(shown.current, element, node)
        if (box) fitPoints.push(box.x0, box.y0, box.x1, box.y1)
        for (const t of shown.current.text.filter(t => t.element === element && t.node === node)) {
          const [a, b, c, d] = shearMatrix(t) ?? [1, 0, 0, 1], angle = -t.rotation * Math.PI / 180
          for (const [x, y] of [[-t.w / 2, -t.h / 2], [t.w / 2, -t.h / 2], [t.w / 2, t.h / 2], [-t.w / 2, t.h / 2]]) {
            const u = a * x + c * y, v = b * x + d * y
            fitPoints.push(t.x + t.w / 2 + Math.cos(angle) * u - Math.sin(angle) * v, t.y + t.h / 2 + Math.sin(angle) * u + Math.cos(angle) * v)
          }
        }
      }
    }
    return bounds(fitPoints)
  }, [fitBoxes, page.size.w, page.size.h, order, shown.current])
  const messages = messagesOf({ storage: storageMessage, note, notice: state.notice, selected: selection ? state.also.length : 0, patchError, scripts, issues, fontNote, problems: ready && !issues.length ? gen.problems : [], traps, hostNotes, frameProblems: problems, core, run })
  // Chrome reads settled edits; transient geometry stays in the canvas until the gesture commits.
  const headerChrome = useMemo(() => (scripts ? <DevBar scripts={scripts} onScripts={v => { preview.current.layout = ''; setScripts(v) }} compare={compare} onCompare={setCompare}>
      {bridge && <ExampleScripts bridge={bridge} onRun={setExample} onFontScene={setExampleFontScene} />}
    </DevBar> : <Header name={project.name} menus={menusOf(editor.ctx, gap, {
      project: { name: project.name, newFromTemplate: () => setProjectDialog('new'), openFile: () => setProjectDialog('new'), openText: () => setProjectDialog('new'),
        saveJson: () => { void downloadProjectJson() }, shareLink: () => setProjectDialog('share'), fonts: () => setDialog('fonts'), exportScript: () => setDialog('export'), adoptionReport: adoption ? () => setProjectDialog('adopt') : null },
      view: { navigable: !play, fit: () => viewApi.current?.fit(), actual: () => viewApi.current?.actual(), fitSelection: selectionBox ? () => viewApi.current?.fitSelection() : null, pan: (x, y) => viewApi.current?.pan(x, y),
        source: sourceOpen, setSource: setSourceOpen, play, setPlay },
      help: { shortcuts: () => setDialog('shortcuts'), openExample: () => setProjectDialog('new'), scripts, setScripts: v => { preview.current.layout = ''; setScripts(v) }, compare, setCompare },
    })} storageMessage={storageMessage} paused={started && saving.current.paused} onSave={() => setSaveRequest(n => n + 1)} play={play} onPlay={() => setPlay(v => !v)} onFonts={() => setDialog('fonts')} onExport={() => setDialog('export')} canExport={started && !!exportTransfer}
      theme={<ThemeMenu name={theme.name} onImport={() => setDialog('import')}><ThemeList provided={Object.values(THEMES)} imported={themesOf(project).filter(t => !Object.hasOwn(THEMES, t.id))}
        library={themeLibrary.themes} value={themeOf(project).id} notes={themeLibrary.notes}
        onChoose={theme => dispatch({ type: 'setTheme', theme })} onAdd={theme => dispatch({ type: 'addTheme', theme })}
        onRemove={id => dispatch({ type: 'removeTheme', id })} onSave={theme => {
          if (saveToThemeLibrary(theme)) setThemeLibrary(loadThemeLibrary())
          else setNote('Theme could not be saved to this browser; it remains in the project')
        }} onRemoveLibrary={id => {
          if (removeFromThemeLibrary(id)) setThemeLibrary(loadThemeLibrary())
          else setNote('Theme could not be removed from this browser')
        }} /></ThemeMenu>} />), [scripts, compare, bridge, committed, fitKey, JSON.stringify(state.entered), gap, play, sourceOpen, page.id, selectionBox !== null, storageMessage, started, saving.current.paused, adoption, themeLibrary, theme, exportTransfer, editor.ctx.tool(), editor.ctx.settings()])
  const sidebarChrome = useMemo(() => (!scripts && <Sidebar tab={sidebarTab} onTab={setSidebarTab}
        layers={<><PageTabs pages={project.pages} activeId={picturePage} dispatch={dispatch} /><DevicesRow project={project} play={play} active={active} problems={gen.problems} /><Layers key={page.id} page={page} selection={selection} also={state.also} entered={state.entered} dispatch={dispatch} ctx={editor.ctx} /></>}
        widgets={<WidgetPalette onInsert={type => dispatch({ type: 'insertWidget', pageId: page.id, widget: type })} />} />), [scripts, sidebarTab, committed, fitKey, JSON.stringify(state.entered), picturePage, play, active, JSON.stringify(gen.problems), editor.ctx])
  const inspectorChrome = useMemo(() => (!scripts && <Inspector ctx={editor.ctx} tab={tab} onTab={setTab}>{checker && <>
        {tab === 'Design' && <PendingColours />}
        {!selection && tab === 'Design' && <details className="disc vb-page-section" open><summary>Page</summary><PageSettings key={page.id} page={page} pages={project.pages} dispatch={dispatch}><PictureControls notes={pictures.notes(picturePage)} canLoad={pictures.canLoad(picturePage)} onLoad={() => { void pictures.loadPictures(picturePage) }} /></PageSettings></details>}{/* only with nothing selected, first (owner, 2026-10-13) */}
        {tab === 'Design' && (chosen
        ? <WidgetPanel key={chosen.uid} page={page} pages={project.pages.map(p => ({ id: p.id, name: p.name }))} widget={chosen}
            boundName={Object.hasOwn(project.bindings, `@${chosen.uid}.name`)} native={!!native} checker={checker} theme={theme} dispatch={dispatch} sceneOf={sceneOf} themeNow={themeNow} pageNow={pageNow} />
        : <PropertyPanel page={page} selection={selection} checker={checker} theme={theme} dispatch={dispatch} sceneOf={sceneOf} />)}
        {tab === 'Data' && <DataPanel project={project} theme={theme} dispatch={dispatch} catalog={catalog} />}
        {tab === 'Logic' && <LogicPanel project={project} theme={theme} dispatch={dispatch} catalog={catalog} roleDevice={id => {
          const role = project.roles.find(r => r.id === id)
          // A pick is one role edit, written as the panel writes any: one setLogic, one undo step.
          return role && <DevicePicker role={role} link={game} onPick={next => dispatch({ type: 'setLogic', patch: { roles: project.roles.map(r => r.id === id ? next : r) } })} />
        }} />}
        {tab === 'Sim' && <SimPanel project={project} dispatch={dispatch} catalog={catalog} writes={writes} notes={hostNotes}
          onClearWrites={() => { setWrites([]); bridge?.sim(JSON.stringify({ clearWrites: true })) }}
          onWipePersist={() => { chipStore.current.wipePersist(); bridge?.sim(JSON.stringify({ wipePersist: true })) }} />}
        {tab === 'Lua' && <CustomLuaPane project={project} dispatch={dispatch} />}
        </>}
      </Inspector>), [scripts, tab, committed, fitKey, JSON.stringify(state.entered), checker, theme, chosen?.uid, catalog, writes, hostNotes, pictures.version, picturePage, editor.ctx, editor.ctx.tool(), editor.ctx.settings()])
  const dialogChrome = useMemo(() => {
    const fonts = <FontImport key={chipRevision} page={page} project={project} dispatch={dispatch} />
    const exporter = (open: boolean) => exportTransfer && <ExportControls open={open} project={committed} checker={checker} makeWorker={makeExportWorker} transfer={exportTransfer}
      onNotice={(message, selection) => { if (selection) { setDialog(null); dispatch({ type: 'setActivePage', pageId: selection.pageId }); dispatch({ type: 'select', selection }) } else setNote(message) }}
      send={ready => <SendSection ready={ready} scenes={exportScenes(committed)} link={game} />} />
    const importer = <ThemeImport names={themeNames} taken={themeTaken} pages={project.pages} onAdd={theme => dispatch({ type: 'addTheme', theme })} onKeep={theme => {
        if (!saveToThemeLibrary(theme)) return false
        setThemeLibrary(loadThemeLibrary()); return true
      }} />
    // The starters' projects load the first time the New dialog opens.
    const templates = (open: string | null) => <TemplatePicker theme={themeOf(project)} active={open === 'new'} onPick={p => { onLoad(p); setProjectDialog(null) }} />
    const examples = <div><span className="chip idle">DEV</span><ExamplePicker onPick={p => { onLoad(p); setProjectDialog(null) }} /></div>
    return <>
    <DialogHost dialogs={dialogs} name="fonts">{open => <Dialog open={open} title="Fonts" size="lg" onClose={() => setDialog(null)}>{fonts}</Dialog>}</DialogHost>
    <DialogHost dialogs={dialogs} name="export">{open => <Dialog open={open} title="Export" size="lg" onClose={() => setDialog(null)} headExtra={<span className="unit">{project.pages.length} pages · {theme.name}</span>}>{exporter(open)}</Dialog>}</DialogHost>
    <DialogHost dialogs={dialogs} name="import">{open => <Dialog open={open} title="Import a design system" size="xl" onClose={() => setDialog(null)}>{importer}</Dialog>}</DialogHost>
    <DialogHost dialogs={dialogs} name="game">{open => <Dialog open={open} title="Game link" size="md" onClose={() => setDialog(null)}><GameLink link={game} page={page} dispatch={dispatch} /></Dialog>}</DialogHost>
    <DialogHost dialogs={dialogs} name="shortcuts">{open => <ShortcutsDialog open={open} onClose={() => setDialog(null)} ctx={editor.ctx} />}</DialogHost>
    {exportTransfer && <ProjectDialogHost dialogs={dialogs}>{open => <ProjectControls project={committed} onLoad={onLoad} transfer={exportTransfer} onNotice={setNote} makeCaptureWorker={makeCaptureWorker} adoption={adoption} onAdoption={setAdoption}
      dialogs={{ open, onOpen: setProjectDialog,
        templates: templates(open), examples,
      }} />}</ProjectDialogHost>}
  </>
  }, [dialogs, committed, page.id, checker, exportTransfer, chipRevision, theme, themeNames, themeTaken, adoption, makeCaptureWorker, makeExportWorker])
  return <div className="vb-shell">
    <div inert={!started} style={{ display: 'contents' }}>
    {!scripts && <NamesList project={project} />}
    {headerChrome}
    {dialogChrome}
    <div className={`vb-workspace${scripts ? ' vb-scripts' : ''}`}>
      {!scripts && <ToolRail ctx={editor.ctx} />}
      {sidebarChrome}
      <div className="vb-center"><div className="vb-canvas-area" role="main" aria-label="Work area" style={{ '--vb-cursor': TOOLS.find(t => t.id === editor.ctx.tool())?.cursor ?? 'default' } as CSSProperties}>
      {bridge && <div className="vb-preview" onPointerLeave={() => !scripts && play && bridge.pointer(active, lastPointer.current.x, lastPointer.current.y, 'leave')}
        onWheel={e => !scripts && play && bridge.pointer(active, lastPointer.current.x, lastPointer.current.y, 'wheel', -Math.sign(e.deltaY))}>
      <Canvas key={chipRevision} bridge={bridge} surface={scripts ? 'main' : play ? active : page.surface} size={canvasSize} tag={!scripts} scene={scripts ? exampleFontScene : previewScene}
        pictures={pictures} picturePage={picturePage}
        navigate={!scripts && !play} selectionBox={selectionBox} viewSlot={viewSlot} viewApi={viewApi}
        chrome={scripts || play ? undefined : ({ zoom }) => <>
          <FrameLabel page={page} dispatch={dispatch} onCustom={() => { setTab('Design'); dispatch({ type: 'select', selection: null }); requestAnimationFrame(() => {
            const section = document.querySelector<HTMLDetailsElement>('.vb-page-section'), select = section?.querySelector<HTMLSelectElement>('select[aria-label="Console size"]')
            if (section) section.open = true
            select?.scrollIntoView({ block: 'center' }); select?.focus()
          }) }} />
          <TaskBar ctx={editor.ctx} box={selectionBox} zoom={zoom} onDataNames={() => { setTab('Design'); requestAnimationFrame(() => document.getElementById('vb-widget-data-names')?.scrollIntoView()) }} />
        </>}
        onHover={p => { const u = p && apply(unview(viewbox(page.scene.header, page.size)), p.x, p.y); pointerStore.set(u ? { x: u[0], y: u[1] } : null) }}
        onPointer={scripts ? undefined : play ? (kind, x, y, ev) => {
          lastPointer.current = { x, y }; bridge.pointer(active, x, y, kind, 0, ev.pointerId)
        } : editor.router.pointer} onRenderer={setRenderer} fixedZoom={scripts && compare ? 1 : undefined}
        children={scripts ? (compare ? () => <CaptureOverlay renderer={renderer} size={EXAMPLE_SIZE} run={example} /> : undefined)
          : play ? undefined : ({ zoom, pan, frame }) => {
            const o = shownOrder(frame, page, order)   // the frame the canvas shows
            return <>
              {/* Placeholders leave presses to the canvas router; handles stay above them. */}
              <NativeLayer page={page} theme={theme} zoom={zoom} selected={new Set(selected(state).flatMap(s => s.pageId === page.id && s.native ? [s.native] : []))}
                onSelect={uid => dispatch({ type: 'select', selection: { pageId: page.id, path: [], native: uid } })} />
              <Selection frame={frame} zoom={zoom} scene={page.scene} natives={page.natives} theme={theme} selection={selection}
                node={selection && !selection.inDefs && o ? indexOfPath(o, page.scene.root, selection.path) : null}
                rect={page.size} handles={!!TOOLS.find(t => t.id === editor.ctx.tool())?.handles && !state.also.length}
                widget={widgetBox(page.scene, selection && !selection.inDefs ? selection.path : undefined, theme)} />
              {editor.router.overlay({ zoom, pan, frame })}
            </>
          }}
        onFrame={f => {
          shown.current = f
          preview.current.reloaded = false
          setProblems(f.problems.map(p => `problem: ${p.message}`).join('\n'))
        }} /></div>}
      {!scripts && play && <div className="vb-play-banner raised"><span>Playing: pointer and wheel go to the chip. Press Play again to edit.</span><span className="unit">{project.pages.find(p => p.surface === active)?.name ?? active} · {active}</span></div>}
      {!scripts && <Breadcrumb scene={page.scene} natives={page.natives} theme={theme} selection={selection} entered={state.entered} dispatch={dispatch} />}
      </div>
      {!scripts && <SourcePane name={page.name} open={sourceOpen} onClose={() => setSourceOpen(false)} counts={diagnostics}>{started && checker && <CodePane scene={page.scene} pageId={page.id} selection={state.selection} dispatch={dispatch} checker={checker} onDiagnostics={setDiagnostics} />}</SourcePane>}
      </div>
      {inspectorChrome}
        </div>
    <section id="vb-messages" className="vb-messages sunk" aria-label="Messages" hidden={!messagesOpen}>
      <div className="vb-messages-head"><span className="ptitle">Messages</span><span className="unit">errors are read aloud; the run line is only shown</span><button className="ibtn flat" aria-label="Close Messages" onClick={() => setMessagesOpen(false)}><Icon name="close" /></button></div>
      <MessagesList messages={messages} />
    </section>
    <StatusBar ctx={editor.ctx} play={play} setViewSlot={setViewSlot} gap={gap} onGap={setGap} source={sourceOpen} onSource={setSourceOpen} game={gameStatus} messages={messages} status={status} messagesOpen={messagesOpen} onMessages={setMessagesOpen} />
    </div>
    <SaveDialogs phase={phase} paused={saving.current.paused} discovered={discoveredSave} busy={editor.router.busy()} request={saveRequest} message={storageMessage}
      canContinue={!started && saving.current.paused && (pendingStartup.current !== null || fragmentRead.current === null)}
      onContinue={continueUnsaved} onBlank={chooseBlank} onDownload={() => void downloadProjectJson()}
      startup={<>
        {slots.current && <button className="btn primary" onClick={() => void openStored(slots.current!, true)}>Open saved project</button>}
        {slots.recovery && <button className="btn" onClick={() => void openStored(slots.recovery!, false)}>Open recovery project</button>}
        {saving.current.failure !== 'conflict' && <button className="btn" onClick={() => void retryAutosave()}>Retry autosave</button>}
      </>}
      recovery={<>
        <button className="btn" onClick={() => void retryAutosave(true)}>Reload saved project</button>
        {discoveredSave && <button className="btn" onClick={() => void retryAutosave(false, true)}>Save current project instead</button>}
        {slots.recovery && <button className="btn" onClick={() => void openStored(slots.recovery!, false)}>Open recovery project</button>}
        {saving.current.failure !== 'conflict' && <button className="btn" onClick={() => void retryAutosave()}>Retry autosave</button>}
      </>} />

  </div>
}
