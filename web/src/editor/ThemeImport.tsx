import { Component, type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ROLES, STYLES, THEMES, type Theme } from '../theme'
import { importedId, sanitizeTheme, THEME_FILE, type ThemeFile } from '../theme/file'
import { faceName } from '../theme/faces'
import { themePrompt } from '../theme/prompt'
import { droppedFiles } from '../theme/import/drop'
import { fetchDesignSystem } from '../theme/import/fetch'
import { systemRoot } from '../theme/import/files'
import { autoChoices, type Choices } from '../theme/import/match'
import { proposeTheme, type MappingReport, type Source } from '../theme/import/map'
import { readDesignSystem } from '../theme/import/tokens'
import type { DesignSystem } from '../theme/import/types'
import fontCatalogue from '../catalog/fonts.json'
import { NO_CTX, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Json, Param, Params } from '../widgets/types'
import { fontsVersion, importedFonts, importFont, subscribeFonts } from './fonts'
import { WidgetParam } from './WidgetParam'

type Actions = { taken: ReadonlySet<string>; names?: ReadonlyMap<string, string>; pages: readonly { id: string; name: string }[]; onAdd: (theme: Theme) => void; onKeep: (theme: Theme) => boolean }
type Input = { ds: DesignSystem } | { file: ThemeFile }
type MappingField = 'roles' | 'styles' | 'styleRules' | 'parts' | 'geo'
type Overrides = Partial<Omit<Choices, MappingField>> & { [K in MappingField]?: K extends 'roles' | 'geo' ? Choices[K] : Partial<Choices[K]> }
const reason = (e: unknown) => e instanceof Error ? e.message : String(e)
const from = (source?: Source) => !source ? '' : 'base' in source ? 'from ' + source.base : 'player' in source ? 'from player'
  : 'token' in source ? 'token ' + source.token : 'rule' in source ? 'CSS ' + source.rule : source.derived
const displayValue = (value: unknown) => typeof value === 'number'
  ? Number(Math.abs(value) < 0.01 ? value.toPrecision(3) : value.toFixed(2))
  : typeof value === 'string' ? value.replace(/^(#[0-9a-f]{6})ff$/i, '$1') : value
const displayJson = (value: unknown) => JSON.stringify(value, (_key, v: unknown) => displayValue(v))
const fontAvailability = (face: string, report: MappingReport, local: ReadonlySet<string>) => {
  if (!face) return 'Built-in vector font'
  const supplied = report.fonts.find(f => f.face === face)?.supplied ?? (local.has(face) ? 'local' : fontCatalogue.faces.some(f => f.name === face && f.fontsMod) ? 'mod' : 'none')
  return { mod: 'Fonts mod', local: 'this browser', file: 'a file in the design system', none: 'none; use the Fonts panel' }[supplied]
}

const projectParam = (p: Param): boolean => p.type === 'page' || p.key === 'keys' || p.type === 'list' && p.item.some(projectParam)
function dropProjectDefaults(theme: Theme | null | undefined, notes: string[]) {
  for (const [widget, params] of Object.entries(theme?.widgetDefaults ?? {})) for (const p of WIDGETS[widget]?.params ?? []) if (projectParam(p) && Object.hasOwn(params, p.key)) {
    theme!.widgetDefaults = { ...theme!.widgetDefaults, [widget]: Object.fromEntries(Object.entries(theme!.widgetDefaults![widget]).filter(([key]) => key !== p.key)) }; notes.push('theme.widgetDefaults.' + widget + '.' + p.key + ': project references dropped; set them in the Widget panel')
  }
}

function distinctName(theme: Theme | undefined, report: MappingReport, names: ReadonlySet<string>, ids: ReadonlySet<string>) {
  if (!theme || !names.has(theme.name.trim().toLowerCase())) return
  const original = theme.name; let n = 1
  do { theme.name = original + ' (imported' + (n === 1 ? '' : ' ' + n) + ')'; n++ } while (names.has(theme.name.trim().toLowerCase()))
  theme.id = importedId(theme.name, ids)
  report.sources.name = { derived: 'distinct theme name' }
  report.notes.push('theme.name: ' + JSON.stringify(original) + ' already exists; using ' + JSON.stringify(theme.name))
}

export function ThemeImport(props: Actions) {
  const [link, setLink] = useState(''), [text, setText] = useState(''), [prompt, setPrompt] = useState('')
  const [input, setInput] = useState<Input>(), [sourceRevision, setSourceRevision] = useState(0), [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const files = useRef(new Map<string, Uint8Array>()), request = useRef<AbortController | null>(null), generation = useRef(0)
  useEffect(() => () => { generation.current++; request.current?.abort() }, [])
  const accept = (incoming: ReadonlyMap<string, Uint8Array>, notes: string[], replace = false) => {
    const rooted = systemRoot(incoming), received = new Map(rooted.files)
    if (!replace && text.trim()) {
      JSON.parse(text)
      if (received.has('tokens.json') && new TextDecoder().decode(received.get('tokens.json')) !== text)
        notes.push('tokens.json: pasted JSON takes precedence over the selected file')
      received.set('tokens.json', new TextEncoder().encode(text))
    }
    if (replace) files.current = new Map()
    for (const [path, bytes] of received) files.current.set(path, bytes)
    const json = [...files.current].filter(([path]) => path.endsWith('.json')).sort(([a], [b]) => a.length - b.length)
    for (const [path, bytes] of json) {
      let value: unknown
      try { value = JSON.parse(new TextDecoder().decode(bytes)) } catch { continue }
      if (value && typeof value === 'object' && Object.hasOwn(value, 'format') && (value as { format: unknown }).format === THEME_FILE) {
        const read = sanitizeTheme(value, THEMES.neutral, { taken: props.taken })
        if (!read.theme) throw Error(read.notes.join('\n'))
        if (replace) setSourceRevision(n => n + 1)
        setInput({ file: value as ThemeFile }); setStatus([path + ': selected as a theme file; its own values take precedence over design-system tokens and CSS', ...notes, ...read.notes].join('\n')); return
      }
    }
    const ds = readDesignSystem(files.current)
    ds.notes.push(...notes, ...rooted.notes.filter(note => !note.startsWith('tokens.json: not found')))
    if (replace) setSourceRevision(n => n + 1)
    setInput({ ds }); setStatus('Files read. Review the mapping before adding the theme.')
  }
  const read = async (job: () => Promise<{ files: Map<string, Uint8Array>; notes: string[] }>, replace = false) => {
    const round = ++generation.current; request.current?.abort(); setBusy(true); setStatus('Reading files…')
    try { const result = await job(); if (round === generation.current) accept(result.files, result.notes, replace) }
    catch (e) {
      if (round === generation.current) {
        if (replace) { files.current.clear(); setInput(undefined) }
        setStatus(reason(e))
      }
    }
    finally { if (round === generation.current) setBusy(false) }
  }
  const stop = () => { generation.current++; request.current?.abort(); setBusy(false); setStatus('Read stopped; the previous mapping is kept.') }
  const copy = async () => {
    const value = themePrompt() + (link.trim() ? '\n\nDesign system: ' + link.trim() : ''); setPrompt(value)
    try { await navigator.clipboard.writeText(value); setStatus('Prompt copied. Paste the answer below or choose its theme file.') }
    catch (e) { setStatus('Copy failed: ' + reason(e).replace(/[.\s]+$/, '') + '. Select the prompt text and copy it.') }
  }
  return <section className="vb-theme-import" aria-label="Import theme">
      <h2>Import theme</h2>
      <h3>1. Fetch a link</h3>
      <label>Design-system link <input aria-label="Design-system link" type="url" value={link} onChange={e => setLink(e.target.value)} /></label>
      <button type="button" disabled={busy || !link.trim()} onClick={() => void read(() => {
        const controller = request.current = new AbortController(); return fetchDesignSystem(link, controller.signal)
      }, true)}>Fetch</button>
      {busy && <button type="button" onClick={stop}>Stop reading</button>}
      <h3>2. Files or paste</h3>
      <div role="group" aria-label="Drop design-system files" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void read(() => droppedFiles(e.dataTransfer)) }}>
        Drop design-system files here, or choose them below.
      </div>
      <label>Design-system folder <input aria-label="Design-system folder" type="file" multiple {...{ webkitdirectory: '' }} onChange={e => {
        const picked = e.target.files; if (picked) void read(() => droppedFiles(picked)); e.target.value = ''
      }} /></label>
      <label>Zip or files <input aria-label="Zip or files" type="file" multiple onChange={e => {
        const picked = e.target.files; if (picked) void read(() => droppedFiles(picked)); e.target.value = ''
      }} /></label>
      <label>Tokens or theme JSON <textarea aria-label="Tokens or theme JSON" rows={6} value={text} onChange={e => setText(e.target.value)} /></label>
      <button type="button" disabled={busy || !text.trim()} onClick={() => {
        try { JSON.parse(text); accept(new Map([['tokens.json', new TextEncoder().encode(text)]]), []) } catch (e) { setStatus('JSON: ' + reason(e)) }
      }}>Read JSON</button>
      <button type="button" onClick={() => { stop(); files.current.clear(); setInput(undefined); setText(''); setStatus('Files cleared.') }}>Clear files</button>
      <h3>3. Ask for a theme file</h3>
      <p>Copy the prompt, paste it into Claude with your link or files, then paste or choose the theme file it returns.</p>
      <button type="button" onClick={() => void copy()}>Copy prompt</button>
      {prompt && <label>Prompt to copy <textarea aria-label="Prompt to copy" readOnly rows={6} value={prompt} /></label>}
      <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{status}</p>
      {input && <MappingBoundary input={input}><ThemeMapping key={sourceRevision + ('ds' in input ? 'ds' : 'file')} input={input} {...props} /></MappingBoundary>}
  </section>
}

class MappingBoundary extends Component<{ input: Input; children: ReactNode }, { error?: string }> {
  state: { error?: string } = {}
  // The message is followed by our own full stop: its own trailing stops and spaces go.
  static getDerivedStateFromError(error: unknown) { return { error: reason(error).replace(/[.\s]+$/, '') } }
  componentDidUpdate(previous: { input: Input }) {
    if (previous.input !== this.props.input && this.state.error !== undefined) this.setState({ error: undefined })
  }
  render() {
    return this.state.error !== undefined ? <p role="status">Mapping could not be read here{this.state.error ? ': ' + this.state.error : ''}. Choose files or read JSON again.</p> : this.props.children
  }
}

export function ThemeMapping({ input, taken, names, pages, onAdd, onKeep }: Actions & { input: Input }) {
  const ds = 'ds' in input ? input.ds : undefined
  const [overrides, setOverrides] = useState<Overrides>({})
  const choices = useMemo<Choices>(() => {
    const auto = ds ? autoChoices(ds) : { ...autoChoices(readDesignSystem(new Map())), name: 'file' in input ? input.file.theme.name : '' }
    if (!ds) auto.roles = Object.fromEntries(ROLES.map(role => [role, role]))
    return { ...auto, ...overrides, roles: { ...auto.roles, ...overrides.roles }, styles: { ...auto.styles, ...overrides.styles },
      styleRules: { ...auto.styleRules, ...overrides.styleRules }, parts: { ...auto.parts, ...overrides.parts }, geo: { ...auto.geo, ...overrides.geo } }
  }, [input, overrides])
  const [fileChanges, setFileChanges] = useState<Partial<ThemeFile['theme']>>({}), [status, setStatus] = useState(''), [busy, setBusy] = useState(false)
  const file = useMemo(() => 'file' in input ? { ...input.file, theme: { ...input.file.theme, ...fileChanges } } : undefined, [input, fileChanges])
  const [kept, setKept] = useState<{ id: string; choices: Choices; file: ThemeFile | undefined }>()
  const version = useSyncExternalStore(subscribeFonts, fontsVersion, fontsVersion)
  const local = useMemo(() => new Set(importedFonts()), [version])
  const proposed = useMemo(() => {
    const ids = new Set(taken)
    const owned = kept?.choices === choices && kept.file === file
    if (owned) ids.delete(kept!.id)
    const occupied = new Set([...Object.values(THEMES).map(t => t.name), ...[...(names ?? [])].filter(([id]) => !owned || id !== kept!.id).map(([, name]) => name)].map(name => name.trim().toLowerCase()))
    if (ds) {
      const result = proposeTheme(ds, choices, ids, local)
      dropProjectDefaults(result.theme, result.report.notes)
      result.report.notes.push(...result.report.fonts.filter(f => f.supplied === 'local').map(f => f.face + ': this browser already has a local face; kept existing font'))
      distinctName(result.theme, result.report, occupied, ids)
      return result
    }
    const read = sanitizeTheme({ ...file, theme: { ...file!.theme, name: choices.name } }, THEMES[choices.base], { taken: ids })
    dropProjectDefaults(read.theme, read.notes)
    const report: MappingReport = { sources: {}, dropped: [], cannotDraw: [], fonts: [], notes: read.notes }
    const queue: { value: unknown; raw: unknown; path: string }[] = [{ value: read.theme, raw: file!.theme, path: '' }]
    for (let at = 0; at < queue.length; at++) {
      const item = queue[at]; report.sources[item.path] = item.raw === undefined ? { base: THEMES[choices.base].name } : { player: true }
      if (item.value && typeof item.value === 'object') for (const [key, value] of Object.entries(item.value)) queue.push({ value,
        raw: item.raw && typeof item.raw === 'object' && Object.hasOwn(item.raw, key) ? (item.raw as Record<string, unknown>)[key] : undefined,
        path: item.path ? item.path + '.' + key : key })
    }
    for (const note of read.notes) if (note.includes('filled from ' + THEMES[choices.base].name)) report.sources[note.split(':')[0].replace(/^theme\./, '')] = { base: THEMES[choices.base].name }
    distinctName(read.theme, report, occupied, ids)
    return { theme: read.theme, report }
  }, [ds, choices, file, taken, names, local, kept])
  const { theme: t, report } = proposed
  // Each keystroke renders the mapping again, and a large design system puts thousands of options under each of dozens
  // of selects. The lists are made once per design system (a theme file's colour names once per set of names), and
  // each list's option elements once, so React leaves those options alone on a render.
  const lists = useMemo(() => ds && { rules: [...new Set(ds.rules.filter(r => !r.at).flatMap(r => r.selectors.map(s => s.text)))],
    colours: ds.colours.map(c => c.name), styles: ds.styles.map(s => s.name), lengths: ds.lengths.filter(l => l.px !== undefined).map(l => l.name) }, [ds])
  const colourNames = Object.keys(t?.colors ?? {}).join('\n')
  const fileColours = useMemo(() => colourNames ? colourNames.split('\n') : [], [colourNames])
  const optionLists = useMemo(() => new WeakMap<readonly string[], ReactNode[]>(), [])
  const optionsOf = (list: readonly string[]) => {
    let made = optionLists.get(list)
    if (!made) optionLists.set(list, made = list.map(option => <option key={option}>{option}</option>))
    return made
  }
  if (!t) return <p role="status">{report.notes.join('\n')}</p>
  const source = (path: string) => from(report.sources[path] ?? report.sources[path.split('.')[0]])
  const change = (field: MappingField, key: string, value: string) => setOverrides(c => ({ ...c, [field]: { ...c[field], [key]: value || null } }))
  const select = (label: string, value: string | null | undefined, options: readonly string[], put: (value: string) => void) => <label>{label}
    <select aria-label={label} value={value ?? ''} onChange={e => put(e.target.value)}><option value="">from {THEMES[choices.base].name}</option>
      {optionsOf(options)}</select></label>
  const rules = lists?.rules ?? []
  const setDefaults = (widget: string, params: Params) => {
    const kept = Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'x' && key !== 'y' && key !== 'keys'))
    const defaults = { ...t.widgetDefaults, [widget]: { ...t.widgetDefaults?.[widget], ...kept } }
    if (ds) setOverrides(c => ({ ...c, widgetDefaults: defaults }))
    else setFileChanges(f => ({ ...f, widgetDefaults: defaults }))
  }
  const useFonts = async () => {
    setBusy(true); const notes: string[] = []
    for (const font of report.fonts) if (font.supplied === 'file' && font.file && ds?.files.has(font.file)) {
      const face = font.face
      if (importedFonts().includes(face)) { notes.push(face + ': this browser already has a local face; kept existing font'); continue }
      const weight = ds.fonts.filter(f => f.path === font.file).flatMap(f => [f.weight[0], f.weight[1], ...Array.from({ length: 9 }, (_, i) => (i + 1) * 100)]
        .filter(w => w >= f.weight[0] && w <= f.weight[1] && face === faceName(f.family, w, f.style !== 'normal')))[0]
      try { if (!await importFont(face, Uint8Array.from(ds.files.get(font.file)!).buffer, true, undefined, weight)) notes.push(face + ': in use for this session; browser storage unavailable') }
      catch (e) { notes.push(face + ': ' + reason(e)) }
    }
    setStatus(notes.join('\n') || (report.fonts.some(f => f.supplied === 'file') ? 'Font files imported in this browser.' : 'No needed file faces to import; existing faces were kept.')); setBusy(false)
  }
  const widgets = Object.values(WIDGETS).filter(m => t.widgetDefaults?.[m.type] || ds && (ds.components.some(c => c.name.toLowerCase() === m.type)
    || ds.rules.some(r => r.selectors.some(s => s.parts.some(p => p.kind === 'class' && (p.value.toLowerCase() === m.type || p.value.toLowerCase().endsWith('-' + m.type)))))
    || Object.entries(choices.parts).some(([part, rule]) => rule && part.split('.')[0] === m.type)))
  const paintText = (value: unknown) => displayJson(value) + ' ' + [...new Set(JSON.stringify(value).match(/[A-Za-z][A-Za-z0-9_.-]*/g) ?? [])].filter(key => Object.hasOwn(t.colors, key)).map(key => key + '=' + displayValue(t.colors[key])).join(' ')
  const actions = <>
    <button type="button" onClick={() => { setKept({ id: t.id, choices, file }); onAdd(t); setStatus('Theme added to the project. Undo restores the previous theme.') }}>Add theme</button>
    <button type="button" onClick={() => {
      if (onKeep(t)) { setKept({ id: t.id, choices, file }); setStatus('Theme kept in this browser.') }
      else setStatus('Theme could not be kept: browser storage unavailable. Add theme keeps it in the project.')
    }}>Keep in this browser</button>
  </>
  return <section className="vb-theme-mapping" aria-label="Theme mapping">
    <h2>Mapping: {ds?.name ?? t.name}</h2>
    <div role="group" aria-label="Theme actions at top">{actions}</div>
    <p role="status" style={{ whiteSpace: 'pre-wrap' }}>{status}</p>
    <label>Theme name <input aria-label="Theme name" value={overrides.name ?? t.name} onChange={e => setOverrides(c => ({ ...c, name: e.target.value }))} /></label>
    {ds && ds.themes.length > 1 && <label>Colour theme <select aria-label="Colour theme" value={choices.colourTheme} onChange={e => setOverrides(c => ({ ...c, colourTheme: e.target.value }))}>
      {ds.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>}
    <label>Base theme <select aria-label="Base theme" value={choices.base} onChange={e => setOverrides(c => ({ ...c, base: e.target.value as Choices['base'] }))}>
      <option value="neutral">Neutral</option><option value="vanilla-plus">Vanilla +</option></select></label>
    <h3>Colours</h3>
    <p>{ds ? ROLES.filter(role => choices.roles[role]).length + ' of 26 roles matched' : ROLES.filter(role => report.sources['colors.' + role] && 'player' in report.sources['colors.' + role]).length + ' of 26 roles supplied; the rest from ' + THEMES[choices.base].name}</p>
    <table><tbody>{ROLES.map(role => <tr key={role} data-role={role}><th scope="row">{role}</th><td>
      <span role="img" aria-label={`${role} swatch`} style={{ display: 'inline-block', width: '1em', height: '1em', background: t.colors[role] }} /> {String(displayValue(t.colors[role]))}
      {select('Colour token for ' + role, choices.roles[role], lists?.colours ?? fileColours, value => {
        change('roles', role, value)
        if (!ds) setFileChanges(f => ({ ...f, colors: { ...file!.theme.colors, [role]: value ? t.colors[value] : THEMES[choices.base].colors[role] } }))
      })}
      <p>{ds?.colours.find(c => c.name === choices.roles[role])?.usage} <span data-source={'colors.' + role}>{source('colors.' + role)}</span></p>
    </td></tr>)}</tbody></table>
    <h3>Type styles</h3>
    {STYLES.map(style => <div key={style} data-style={style}>
      <h4>{style}</h4>
      {ds && select('Design-system style for ' + style, choices.styles[style], lists!.styles, value => change('styles', style, value))}
      {ds && select('CSS type rule for ' + style, choices.styleRules[style], rules, value => change('styleRules', style, value))}
      <p>{fontAvailability(t.type[style].font, report, local)}</p>
      <dl>{Object.entries(t.type[style]).map(([key, value]) => <div key={key}><dt>{key} — {source('type.' + style + '.' + key)}</dt><dd>{String(displayValue(value))}</dd></div>)}</dl>
    </div>)}
    {ds?.fonts.some(f => f.path && ds.files.has(f.path)) && <button type="button" disabled={busy} onClick={() => void useFonts()}>Use the design system's font files in this browser</button>}
    <p>Font files stay in this browser. The project keeps only face names. Missing faces can be imported through the Fonts panel.</p>
    <h3>Parts</h3>
    {Object.entries(t.parts).map(([part, paint]) => <div key={part}>
      <h4>{part}</h4>{ds && select('CSS rule for ' + part, choices.parts[part as keyof Choices['parts']], rules, value => change('parts', part, value))}
      <p>{paintText(paint)}</p>
      <p>{Object.keys(paint).map(key => key + ': ' + source('parts.' + part + '.' + key)).join('; ')}</p>
    </div>)}
    <h3>Geometry</h3>
    {Object.entries(choices.geo).map(([key, value]) => <div key={key}>
      {ds && select('Length token for ' + key, value, lists!.lengths, value => change('geo', key, value))}
    </div>)}
    <dl>{Object.entries(t.geo).flatMap<[string, number]>(([key, value]) => typeof value === 'number' ? [[key, value]] : Object.entries<number>(value).map(([child, n]): [string, number] => [key + '.' + child, n]))
      .map(([key, value]) => <div key={key}><dt>{key} — {source('geo.' + key)}</dt><dd>{String(displayValue(value))}</dd></div>)}</dl>
    <h3>Derived metrics</h3><dl>{Object.entries(t.metrics).map(([key, value]) => <div key={key}><dt>{key} — {source('metrics.' + key)}</dt><dd>{String(displayValue(value))}</dd></div>)}</dl>
    <h3>Anatomy</h3>{Object.entries(t.anatomy?.looks ?? {}).map(([hook, look]) => <p key={hook}>{hook}: {displayJson(look)}; {source('anatomy.looks.' + hook)}</p>)}
    <h3>Widget defaults</h3>
    {widgets.map(m => <details key={m.type}><summary tabIndex={0}>{m.label} defaults</summary><WidgetDefaults module={m.type} theme={t} pages={pages} onChange={params => setDefaults(m.type, params)} /></details>)}
    {(['cannotDraw', 'dropped', 'notes'] as const).map(key => <div key={key}><h3>{key === 'cannotDraw' ? 'Cannot draw' : key === 'dropped' ? 'Dropped items' : 'Notes'}</h3>
      {report[key].length ? <ul>{report[key].map((note, i) => <li key={i}>{note}</li>)}</ul> : <p>None.</p>}</div>)}
    <div role="group" aria-label="Theme actions at bottom">{actions}</div>
  </section>
}

function WidgetDefaults({ module, theme, pages, onChange }: { module: string; theme: Theme; pages: Actions['pages']; onChange: (params: Params) => void }) {
  const m = WIDGETS[module], params = sanitize(m, { ...m.defaults(theme, NO_CTX), ...theme.widgetDefaults?.[module] }, theme)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const control = (p: typeof m.params[number], value: Json, name: string, put: (value: Json) => void) => <label key={name}>{name}
    <WidgetParam param={p} value={value} label={name} theme={theme} pages={pages} onChange={v => { setErrors(e => ({ ...e, [name]: '' })); put(v) }} onError={message => setErrors(e => ({ ...e, [name]: message }))} />
    {errors[name] && <span role="alert">{errors[name]}</span>}</label>
  return <>{m.params.some(projectParam) && <p>Page links belong to the project; set them in the Widget panel.</p>}{m.params.filter(p => !['x', 'y'].includes(p.key) && !projectParam(p)).map(p => p.type !== 'list'
    ? control(p, params[p.key], module + ' ' + p.key, value => onChange({ [p.key]: value }))
    : <fieldset key={p.key}><legend>{module} {p.key}</legend>
      {(params[p.key] as Params[]).map((item, i, items) => <div key={i}>
        {p.item.map(q => control(q, item[q.key], `${module} ${p.key} ${i + 1} ${q.key}`, value => onChange({ [p.key]: items.map((v, j) => j === i ? { ...v, [q.key]: value } : v) })))}
        <button type="button" disabled={items.length <= p.min} onClick={() => onChange({ [p.key]: items.filter((_, j) => i !== j) })}>Remove {module} {p.key} {i + 1}</button>
      </div>)}
      <button type="button" onClick={() => { const items = params[p.key] as Params[]; onChange({ [p.key]: [...items, { ...items.at(-1), ...Object.fromEntries(p.item.filter(q => q.type === 'num').map(q => [q.key, items.reduce((max, item) => Math.max(max, Number(item[q.key])), -1) + 1])) }] }) }}>Add {module} {p.key}</button>
    </fieldset>)}</>
}
