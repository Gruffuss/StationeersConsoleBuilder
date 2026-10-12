import { cssColour } from './colour'
import { familiesOf, parseCss, readLength, readLineHeight, readShadow, readWeight, resolveVars } from './css'
import { systemRoot } from './files'
import { record, safePath, tokenName, type DesignSystem, type DsFiles, type DsStyle } from './types'

type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (v: Obj, key: string): unknown => Object.hasOwn(v,key) ? v[key] : undefined
function known(v: unknown, keys: string[], path: string, notes: string[]): Obj {
  if (!object(v)) { notes.push(path + ': expected an object'); return record() }
  for (const key of Object.keys(v)) if (!keys.includes(key)) notes.push(path + '.' + key + ': unknown key dropped')
  return v
}
function list(v: unknown, path: string, notes: string[]): unknown[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) { notes.push(path + ': expected a list'); return [] }
  return v
}
// One parse per file: reading a design system, its variables and every mapping (map.ts, on each change in the mapping
// panel) read the same bytes, which nothing writes to. The parses are read, never changed.
const jsonReads = new WeakMap<Uint8Array, { value: Obj } | { note: string }>(), cssReads = new WeakMap<Uint8Array, ReturnType<typeof parseCss>>()
function json(bytes: Uint8Array | undefined, path: string, notes: string[]): Obj | undefined {
  if (!bytes) return undefined
  let read = jsonReads.get(bytes)
  if (!read) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes))
      read = object(parsed) ? { value: parsed } : { note: 'expected an object' }
    } catch (e) { read = { note: 'could not read JSON here: ' + (e instanceof Error ? e.message : String(e)) } }
    jsonReads.set(bytes,read)
  }
  if ('note' in read) { notes.push(path + ': ' + read.note); return undefined }
  return read.value
}
/** A CSS file's rules and custom properties as written (variables unresolved), parsed once. */
export function cssOf(bytes: Uint8Array): ReturnType<typeof parseCss> {
  let read = cssReads.get(bytes)
  if (!read) { read = parseCss(new TextDecoder().decode(bytes)); cssReads.set(bytes,read) }
  return read
}
function usage(v: Obj, path: string, notes: string[]): { usage?: string } {
  const u = own(v,'usage')
  if (u === undefined) return {}
  if (typeof u === 'string') return { usage: u }
  notes.push(path + '.usage: expected text'); return {}
}
function themed(value: unknown, themes: DesignSystem['themes'], path: string, notes: string[]): Record<string,string> {
  const values = record<string>()
  if (typeof value !== 'string' && !object(value)) { notes.push(path + ': expected text or theme values'); return values }
  if (object(value)) for (const key of Object.keys(value)) if (!themes.some(t => t.id === key)) notes.push(path + '.' + key + ': unknown theme dropped')
  const first = typeof value === 'string' ? value : own(value,themes[0].id)
  for (const theme of themes) {
    const v = typeof value === 'string' ? value : Object.hasOwn(value,theme.id) ? own(value,theme.id) : first
    if (typeof v === 'string') values[theme.id] = v
    else notes.push(path + '.' + theme.id + ': missing or unreadable value')
  }
  return values
}

function readColours(raw: { name: string; value: Record<string,string>; usage?: string }[], ds: DesignSystem, legacy = false): void {
  const tokens = new Map(raw.map(t => [t.name,t]))
  for (const token of raw) {
    const value = record<string>(), alias = record<string>(), outOfGamut: string[] = []
    for (const theme of ds.themes) {
      let name = token.name, text: string | undefined, failed = '', depth = 0
      const visited = new Set<string>()
      while (true) {
        if (visited.has(name)) { failed = name === token.name && visited.size === 1 ? 'self-alias' : 'alias cycle'; break }
        visited.add(name)
        const target = tokens.get(name)
        if (!target || !Object.hasOwn(target.value,theme.id)) { failed = 'missing alias target ' + name; break }
        text = target.value[theme.id].trim()
        const ref = /^\{([^{}]+)\}$/.exec(text) ?? (legacy ? /^var\(--([^,)]+)\)$/.exec(text) : null)
        if (!ref) break
        if (depth++ >= 16) { failed = 'alias chain over the format limit of 16'; break }
        if (name === token.name) alias[theme.id] = ref[1]
        name = ref[1]
      }
      if (failed || text === undefined) { ds.notes.push('color.' + token.name + '.' + theme.id + ': ' + failed); continue }
      if (!legacy && !/^#|^(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/i.test(text)) { ds.notes.push('color.' + token.name + '.' + theme.id + ': unsupported token colour ' + text); continue }
      const parsed = cssColour(text)
      if (!parsed.rgba) { ds.notes.push('color.' + token.name + '.' + theme.id + ': unreadable colour ' + text); continue }
      value[theme.id] = parsed.rgba
      if (parsed.outOfGamut) { outOfGamut.push(text); ds.notes.push('color.' + token.name + '.' + theme.id + ': outside sRGB, clipped ' + text) }
    }
    if (Object.keys(value).length) ds.colours.push({ name: token.name, value, ...(Object.keys(alias).length ? { alias } : {}), ...(token.usage === undefined ? {} : { usage: token.usage }), ...(outOfGamut.length ? { outOfGamut } : {}) })
  }
}

function readTokens(root: Obj, ds: DesignSystem): void {
  const notes = ds.notes, names = new Set<string>()
  const version = own(root,'version')
  if (version !== 3) { notes.push('tokens.json.version: expected version 3'); return }
  if (typeof own(root,'name') === 'string') ds.name = own(root,'name') as string
  if (Object.hasOwn(root,'color')) {
    const c = known(own(root,'color'),['themes','tokens','note'],'color',notes), themes = list(own(c,'themes'),'color.themes',notes)
    const seen = new Set<string>(), valid: DesignSystem['themes'] = []
    for (const [i,v] of themes.entries()) {
      const path = 'color.themes[' + i + ']', theme = known(v,['id','name'],path,notes), id = own(theme,'id'), name = own(theme,'name')
      if (!tokenName(id) || seen.has(id)) { notes.push(path + ': invalid or repeated theme id ' + String(id)); continue }
      seen.add(id); valid.push({ id, name: typeof name === 'string' ? name : id })
    }
    if (valid.length) ds.themes = valid
  }
  const colours: Parameters<typeof readColours>[0] = []
  for (const family of Object.keys(root)) {
    if (['name','version','type'].includes(family)) continue
    const data = own(root,family)
    if (!object(data) || !Object.hasOwn(data,'tokens') || !tokenName(family)) { notes.push('tokens.json.' + family + ': unknown key dropped'); continue }
    const group = known(data,family === 'color' ? ['themes','tokens','note'] : ['tokens','note'],family,notes)
    for (const [i,v] of list(own(group,'tokens'),family + '.tokens',notes).entries()) {
      const path = family + '.tokens[' + i + ']', token = known(v,['name','value','usage'],path,notes), name = own(token,'name')
      if (!tokenName(name)) { notes.push(path + ': invalid name ' + String(name)); continue }
      if (names.has(name)) { notes.push(path + ': repeated name ' + name + ' dropped'); continue }
      names.add(name)
      const u = usage(token,path,notes)
      if (family === 'color') { colours.push({ name, value: themed(own(token,'value'),ds.themes,path + '.value',notes), ...u }); continue }
      if (family === 'shadow') {
        const raw = themed(own(token,'value'),ds.themes,path + '.value',notes), layers = record<NonNullable<ReturnType<typeof readShadow>>>()
        for (const theme of ds.themes) if (Object.hasOwn(raw,theme.id)) {
          const parsed = readShadow(raw[theme.id])
          if (parsed) layers[theme.id] = parsed
          else notes.push(path + '.' + theme.id + ': unreadable shadow ' + raw[theme.id])
        }
        if (Object.keys(layers).length) ds.shadows.push({ name, layers, ...u })
        continue
      }
      const raw = own(token,'value'), localNotes: string[] = []
      const length = typeof raw === 'string' || typeof raw === 'number' ? readLength(raw,localNotes) : undefined
      notes.push(...localNotes.map(n => path + ': ' + n))
      if (!length) notes.push(path + ' ' + name + ': unreadable length ' + String(raw))
      else ds.lengths.push({ family, name, ...length, ...u })
    }
  }
  readColours(colours,ds)
  if (!Object.hasOwn(root,'type')) return
  const type = known(own(root,'type'),['fonts','families','groups'],'type',notes), stacks = record<string>()
  if (Object.hasOwn(type,'families')) {
    const families = own(type,'families')
    if (!object(families)) notes.push('type.families: expected an object')
    else for (const key of Object.keys(families)) {
      const stack = own(families,key)
      if (!tokenName(key) || typeof stack !== 'string' || !familiesOf(stack).length) notes.push('type.families.' + key + ': unreadable family stack')
      else stacks[key] = stack
    }
  }
  for (const [i,v] of list(own(type,'fonts'),'type.fonts',notes).entries()) {
    const path = 'type.fonts[' + i + ']', f = known(v,['family','file','weight','style'],path,notes)
    const family = own(f,'family'), weight = readWeight(own(f,'weight')), style = own(f,'style') ?? 'normal', file = own(f,'file')
    if (typeof family !== 'string' || !family.trim() || !weight || !['normal','italic','oblique'].includes(String(style))) { notes.push(path + ': unreadable font'); continue }
    let fontPath: string | undefined
    if (file !== undefined) {
      fontPath = typeof file === 'string' ? safePath(file) : undefined
      if (!fontPath) { notes.push(path + '.file: refused path'); continue }
      if (!fontPath.includes('/')) fontPath = 'fonts/' + fontPath
    }
    ds.fonts.push({ family, weight, style: style as 'normal'|'italic'|'oblique', ...(fontPath ? { path: fontPath } : {}) })
  }
  const styles = new Set<string>()
  for (const [i,v] of list(own(type,'groups'),'type.groups',notes).entries()) {
    const path = 'type.groups[' + i + ']', group = known(v,['name','family','styles','note'],path,notes), groupName = own(group,'name')
    if (!tokenName(groupName)) { notes.push(path + ': invalid group name'); continue }
    for (const [j,s] of list(own(group,'styles'),path + '.styles',notes).entries()) {
      const at = path + '.styles[' + j + ']', item = known(s,['name','family','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','sample','usage'],at,notes)
      const name = own(item,'name'), sizeNotes: string[] = [], rawSize = own(item,'fontSize')
      const size = typeof rawSize === 'string' || typeof rawSize === 'number' ? readLength(rawSize,sizeNotes)?.px : undefined
      const weight = readWeight(own(item,'fontWeight')), family = own(item,'family') ?? own(group,'family'), style = own(item,'fontStyle') ?? 'normal'
      const stack = typeof family === 'string' ? Object.hasOwn(stacks,family) ? stacks[family] : family : undefined
      notes.push(...sizeNotes.map(n => at + ': ' + n))
      if (!tokenName(name) || styles.has(name) || size === undefined || size <= 0 || !weight || !stack || !['normal','italic','oblique'].includes(String(style))) { notes.push(at + ': invalid or repeated style ' + String(name)); continue }
      styles.add(name)
      const parsed: DsStyle = { name, group: groupName, families: familiesOf(stack), size, weight: weight[0], italic: style !== 'normal', ...usage(item,at,notes) }
      if (weight[0] !== weight[1]) notes.push(at + '.fontWeight: range uses its first weight ' + weight[0])
      for (const key of ['letterSpacing','lineHeight'] as const) if (Object.hasOwn(item,key)) {
        const raw = own(item,key), local: string[] = []
        const value = key === 'lineHeight' ? readLineHeight(raw,local) : typeof raw === 'string' || typeof raw === 'number' ? readLength(raw,local)?.px : undefined
        notes.push(...local.map(n => at + '.' + key + ': ' + n))
        if (value === undefined) notes.push(at + '.' + key + ': unreadable value')
        else parsed[key] = value
      }
      ds.styles.push(parsed)
    }
  }
}

function legacyTokens(ds: DesignSystem): void {
  const themes = new Map<string,string>(), values = new Map<string,Record<string,string>>(), root = 'default'
  themes.set(root,'Default')
  for (const [path,bytes] of ds.files) {
    if (!/^tokens\/.*\.css$/.test(path)) continue
    const css = cssOf(bytes); for (const n of css.notes) ds.notes.push(path + ': ' + n)
    for (const custom of css.custom) {
      const match = /^\[data-theme\s*=\s*(?:"([^"]+)"|'([^']+)'|([\w.-]+))\s*\]$/.exec(custom.selector)
      const theme = custom.selector === ':root' ? root : match?.[1] ?? match?.[2] ?? match?.[3]
      if (!theme || !tokenName(theme)) { ds.notes.push(path + ': unsupported token selector ' + custom.selector); continue }
      const name = custom.name.slice(2)
      if (!tokenName(name)) { ds.notes.push(path + ': invalid token name ' + name); continue }
      themes.set(theme,theme === root ? 'Default' : theme)
      if (!values.has(name)) values.set(name,record())
      const perTheme = values.get(name)!
      if (Object.hasOwn(perTheme,theme)) { ds.notes.push(path + ': repeated token ' + name + ' in ' + theme); continue }
      perTheme[theme] = custom.value
    }
  }
  ds.themes = [...themes].map(([id,name]) => ({ id,name }))
  for (const perTheme of values.values()) for (const theme of ds.themes) if (!Object.hasOwn(perTheme,theme.id) && Object.hasOwn(perTheme,root)) perTheme[theme.id] = perTheme[root]
  const colourTokens: Parameters<typeof readColours>[0] = []
  for (const [name,value] of values) {
    const resolved = record<string>()
    for (const theme of ds.themes) if (Object.hasOwn(value,theme.id)) {
      const parsed = resolveVars(value[theme.id],key => values.get(key.slice(2))?.[theme.id])
      ds.notes.push(...parsed.notes.map(n => name + '.' + theme.id + ': ' + n))
      if (parsed.value !== undefined) resolved[theme.id] = parsed.value
    }
    const first = resolved[root] ?? Object.values(resolved)[0]
    if (first === undefined) continue
    if (name.startsWith('font-') && familiesOf(first).length) continue
    if (cssColour(first).rgba) { colourTokens.push({ name,value: resolved }); continue }
    const lengthNotes: string[] = [], length = readLength(first,lengthNotes)
    if (length) {
      ds.lengths.push({ family: name.startsWith('radius') ? 'radius' : name.startsWith('size') ? 'size' : 'spacing', name,...length })
      ds.notes.push(...lengthNotes.map(n => name + ': ' + n))
      for (const theme of ds.themes) if (resolved[theme.id] !== undefined && resolved[theme.id] !== first) ds.notes.push(name + '.' + theme.id + ': themed length kept in CSS; token list uses the first theme')
      continue
    }
    const layers = record<NonNullable<ReturnType<typeof readShadow>>>()
    for (const theme of ds.themes) if (Object.hasOwn(resolved,theme.id)) {
      const parsed = readShadow(value[theme.id],key => resolvedVariable(key,theme.id)) ?? readShadow(resolved[theme.id])
      if (parsed) layers[theme.id] = parsed
      else ds.notes.push(name + '.' + theme.id + ': unreadable token value ' + value[theme.id])
    }
    if (Object.keys(layers).length) ds.shadows.push({ name,layers })
  }
  readColours(colourTokens,ds,true)
  for (const colour of ds.colours) {
    const aliases = record<string>()
    for (const theme of ds.themes) { const ref = /^var\(--([^,)]+)\)$/.exec(values.get(colour.name)?.[theme.id] ?? ''); if (ref) aliases[theme.id] = ref[1] }
    if (Object.keys(aliases).length) colour.alias = aliases
  }
  function resolvedVariable(key: string, theme: string): string | undefined {
    const raw = values.get(key.slice(2))?.[theme]
    return raw === undefined ? undefined : resolveVars(raw,name => values.get(name.slice(2))?.[theme]).value
  }
}

/** Generated tokens.css uses these exact names; no URL in a file is followed. */
export function dsVariables(ds: DesignSystem, theme = ds.themes[0].id): (name: string) => string | undefined {
  const vars = record<string>()
  for (const c of ds.colours) if (Object.hasOwn(c.value,theme)) vars['--' + c.name] = c.value[theme]
  for (const l of ds.lengths) vars['--' + l.name] = l.percent === undefined ? l.px + 'px' : l.percent + '%'
  for (const s of ds.shadows) if (Object.hasOwn(s.layers,theme)) vars['--' + s.name] = s.layers[theme].map(l => (l.inset ? 'inset ' : '') + [l.dx+'px',l.dy+'px',l.blur+'px',l.spread+'px',l.colour].join(' ')).join(', ')
  const root = json(ds.files.get('tokens.json'),'tokens.json',[]), type = root && own(root,'type'), families = object(type) ? own(type,'families') : undefined
  if (object(families)) for (const key of Object.keys(families)) {
    const value = own(families,key)
    if (tokenName(key) && typeof value === 'string') vars['--font-' + key] = value
  }
  if (!root) {
    const byTheme = new Map<string,Map<string,string>>()
    for (const [path,bytes] of ds.files) if (/^tokens\/.*\.css$/.test(path)) {
      for (const custom of cssOf(bytes).custom) {
        const m = /^\[data-theme\s*=\s*(?:"([^"]+)"|'([^']+)'|([\w.-]+))\s*\]$/.exec(custom.selector)
        const id = custom.selector === ':root' ? 'default' : m?.[1] ?? m?.[2] ?? m?.[3]
        if (!id || !tokenName(custom.name.slice(2))) continue
        if (!byTheme.has(id)) byTheme.set(id,new Map())
        if (!byTheme.get(id)!.has(custom.name)) byTheme.get(id)!.set(custom.name,custom.value)
      }
    }
    for (const [name,value] of byTheme.get('default') ?? []) vars[name] = value
    for (const [name,value] of byTheme.get(theme) ?? []) vars[name] = value
  }
  return name => Object.hasOwn(vars,name) ? vars[name] : undefined
}

export function readDesignSystem(input: DsFiles, theme?: string): DesignSystem {
  const { files,notes } = systemRoot(input)
  const ds: DesignSystem = { name: 'Imported design system', themes: [{ id: 'default', name: 'Default' }], colours: [], styles: [], fonts: [], lengths: [], shadows: [], rules: [], components: [], files, notes }
  const root = json(files.get('tokens.json'),'tokens.json',notes)
  if (root) readTokens(root,ds)
  else if (!files.has('tokens.json')) legacyTokens(ds)
  const readme = files.get('README.md')
  if (readme) ds.readme = new TextDecoder().decode(readme)
  const manifest = json(files.get('design-system.json'),'design-system.json',notes)
  if (manifest) {
    known(manifest,['v','version','name','layout'],'design-system.json',notes)
    if (typeof own(manifest,'name') === 'string' && ds.name === 'Imported design system') ds.name = own(manifest,'name') as string
  }
  const bundle = files.get('components/bundle.js')
  const componentNames = new Set<string>()
  if (bundle) {
    const newline = bundle.indexOf(10), first = new TextDecoder().decode(bundle.subarray(0,newline < 0 ? bundle.length : newline)).trimEnd()
    const match = /^\s*\/\*\s*@ds-bundle:\s*(\{.*\})\s*\*\/\s*$/.exec(first)
    if (!match) notes.push('components/bundle.js: no bundle header on line 1')
    else {
      const header = json(new TextEncoder().encode(match[1]),'components/bundle.js header',notes)
      if (header) {
        known(header,['format','namespace','components'],'components/bundle.js header',notes)
        if (own(header,'format') !== 4) notes.push('components/bundle.js header.format: unsupported bundle format')
        else {
          if (typeof own(header,'namespace') === 'string' && ds.name === 'Imported design system') ds.name = own(header,'namespace') as string
          for (const [i,v] of list(own(header,'components'),'components/bundle.js header.components',notes).entries()) {
            const path = 'components/bundle.js header.components[' + i + ']', component = known(v,['name'],path,notes), name = own(component,'name')
            if (!tokenName(name) || componentNames.has(name)) { notes.push(path + ': invalid or repeated component name'); continue }
            componentNames.add(name)
          }
        }
      }
    }
  }
  for (const path of files.keys()) {
    const match = /^(?:components\/)?([^/]+)\/README\.md$/.exec(path)
    if (!match) continue
    if (tokenName(match[1])) componentNames.add(match[1])
    else notes.push(path + ': invalid component name ' + match[1])
  }
  ds.components = [...componentNames].map(name => {
    const bytes = files.get('components/' + name + '/README.md') ?? files.get(name + '/README.md')
    return { name,...(bytes ? { readme: new TextDecoder().decode(bytes) } : {}) }
  })
  if (theme !== undefined && !ds.themes.some(t => t.id === theme)) { notes.push('color.themes: unknown selected theme ' + theme + '; using the first'); theme = undefined }
  const vars = dsVariables(ds,theme)
  for (const [path,bytes] of files) {
    if (!path.endsWith('.css') || path.startsWith('tokens/')) continue
    const css = cssOf(bytes); for (const n of css.notes) notes.push(path + ': ' + n)
    for (const rule of css.rules) {
      const local = new Map<string,string>()
      for (const decl of rule.decls) if (decl.prop.startsWith('--')) local.set(decl.prop,decl.value)
      const decls: typeof rule.decls = []
      for (const decl of rule.decls) {
        const resolved = resolveVars(decl.value,name => local.get(name) ?? vars(name))
        notes.push(...resolved.notes.map(n => path + ' ' + rule.selectors.map(s => s.text).join(', ') + ' ' + decl.prop + ': ' + n))
        if (resolved.value !== undefined) decls.push({ ...decl,value: resolved.value })
      }
      ds.rules.push({ ...rule,decls })
    }
  }
  return ds
}
