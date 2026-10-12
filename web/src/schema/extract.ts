// The base of the attribute catalogue, read from the pinned vector sources: which keys each op's parser reads, how
// (the reader decides the kind) and with which default, plus the mod's key, paint-default, function and variable lists.
// The mod has no machine-readable key table yet. Upstream plans one, emitted from its test suite; once it ships, a
// reader of that JSON returning this same Extracted replaces extract(), and nothing downstream changes.
// Pure: no node: imports, so the app could import it.

// E/P/L: numeric expressions; N/NL: literal numbers; S: strict string; SN: string or number; TEXT: PropText (invariant numeric text).
export type Kind = 'E' | 'P' | 'L' | 'N' | 'S' | 'NL' | 'SN' | 'TEXT'
/**
 * guarded: the scope tests the key with HasKey first, so an absent key is not the reader's fallback (an absent ry is
 * rx, an absent fo2 no ramp). Such a read keeps no default: the fallback is only what an unreadable value reads as.
 */
export type Read = { kind?: Kind; default?: number | number[]; guarded?: true }
export type Extracted = {
  /** Arity names Invoke has no case for: read only where a colour is (mix); a number reads them as 0. */
  colourFunctions: string[]
  defOps: string[]
  filterKeys: string[]
  functions: Record<string, number>
  groupPaintDefaults: string[]
  knownKeys: string[]
  literalKeys: string[]
  sceneLiteralKeys: string[]
  nodeOps: string[]
  pin: string
  /** The keys Validate passes on the SCENE header only (SceneKeys, 0.11.96): its own, and the ones the host reads. */
  sceneKeys: string[]
  /** scope -> key -> read. Scopes: SCENE, DATA, each op, NODE (what every node op reads), DEF (what every def op reads). */
  reads: Record<string, Record<string, Read>>
  variables: string[]
}
export type Sources = { sceneModel: string; expression: string; colourFilter: string; csproj: string }

// The kind each reader gives; HasKey and PropValue give none. A key read several ways takes the first in this order,
// except that PropString and PropNumber in one scope make SN: either is read.
const KINDS: Record<string, Kind | undefined> = { Attr: 'E', Pair: 'P', Live: 'L', PropNumber: 'N', Count: 'N', PropString: 'S', PropText: 'TEXT', Numbers: 'NL', HasKey: undefined, PropValue: undefined }
const PRIORITY: Kind[] = ['E', 'P', 'L', 'TEXT', 'SN', 'N', 'S', 'NL']

// Where a method's reads apply. ParseNode and ParseDefs are split by case label; ParseCorners is a helper (each op that
// calls it reads rx itself).
const SCOPES: Record<string, string[]> = {
  Parse: ['SCENE'], ReadData: ['DATA'], ReadEasing: ['DATA'], PatchNodesCore: ['DATA'], ParseStyle: ['SCENE', 'G'],
  ParseFill: ['NODE'], ParseStroke: ['NODE'], ReadStrokeStyle: ['NODE'], ParseShadows: ['NODE'],
  ReadStops: ['GL', 'GR', 'GC'], ClipOutline: ['CP'], ParseCorners: [], CheckGroupOpacity: [],
}
// Reads of something other than the node's map, each listed: f = { grad, at } and s = { grad, at } read a paint map
// (SceneModel.cs:2361-2366, 2894-2899 at v0.11.118), whose keys are not the node's; a CP reads the op of each child past its
// shape, to report a def op there (0.11.99, :2856).
const OTHER_MAP_READS: Record<string, string[]> = { ParseFill: ['grad', 'at'], ParseStroke: ['grad', 'at'], ClipOutline: ['op'] }
// Reads of the node's own map, as written before the defaults it inherits are merged in, each listed: they are the node's
// keys, read as the merged map's are. An SC's scroll offset (since 0.11.98, SceneModel.cs:1832-1836 at v0.11.118).
const OWN_MAP_READS: Record<string, string[]> = { ParseNode: ['so', 'sov', 'ry', 'unit'], CheckGroupOpacity: ['o'] }

// A method header: a return type that is a tuple, or a name with dots, generic arguments and ?/[]; never a field.
const METHOD = /^\s*(?:private|internal|public)\s+static\s+(?!readonly\b)(?:\([^)]*\)|[\w.]+(?:<[^>]*>)?[\w.?\[\]>]*)\s+(\w+)\s*\(/gm
// Any member header with a parameter list, METHOD's or not (a generic Foo<T>(, an instance method): one inside a
// method's text means METHOD missed it, and its reads would land in the method before.
const MEMBER = /^[ \t]*(?:private|internal|public|protected)\b[^=;{\n]*?\b\w+\s*(?:<[^>]*>)?\s*\(/gm
// Every reader call, whatever its first argument, so none is missed.
const READ = /\b(Attr|Pair|Live|Count|Numbers|HasKey|Prop\w*)\(\s*([^,";]*?)\s*,\s*"([^"]*)"/g
const NUMBER = /\s*,\s*(-?\d+(?:\.\d+)?)f?\b/y          // Attr and PropNumber: the default, third
const PAIR = /\s*,\s*(\d+)\s*,\s*(-?\d+(?:\.\d+)?)f?\b/y  // Pair: the index, then the default
const CASE = /\n\s*case "([A-Z]+)":/
const OTHER_CASE = /\n[ \t]*(case\b(?![ \t]*"[A-Z]+"[ \t]*:).*)/   // case "R" or "RR":, case "r":, a pattern: not read here

/** A file's static methods, each running to the next one's header. */
export function methods(src: string): { name: string; body: string }[] {
  const heads = [...src.matchAll(METHOD)]
  return heads.map((m, k) => ({ name: m[1], body: src.slice(m.index, heads[k + 1]?.index ?? src.length) }))
}

const need = (re: RegExp, text: string, what: string) => {
  const m = re.exec(text)
  if (!m) throw new Error(`cannot find ${what}`)
  return m[1]
}
const strings = (block: string) => [...block.matchAll(/"([^"]*)"/g)].map(m => m[1])

/** text split on its case labels: [labels, text] in order. An empty body passes its keys on (`case "L": case "Y":`). */
const cases = (text: string): [string[], string][] => {
  const other = OTHER_CASE.exec(text)
  if (other) throw new Error(`unsupported case label: ${other[1].trim()}`)
  const parts = text.split(CASE), out: [string[], string][] = []
  let labels: string[] = []
  for (let k = 1; k < parts.length; k += 2) {
    labels.push(parts[k])
    if (parts[k + 1].trim()) { out.push([labels, parts[k + 1]]); labels = [] }
  }
  return out
}

/** The { … } block from the first brace at or after `from`: [start, end]. */
const block = (text: string, from: number): [number, number] => {
  const open = text.indexOf('{', from)
  for (let i = open, depth = 0; open >= 0 && i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return [open, i + 1]
  }
  throw new Error('unbalanced braces')
}

// GL and GR share one case, but only the radial branch reads cx cy r fx fy and only the other x1 y1 x2 y2
// (SceneModel.cs:2548, 2558-2584 at v0.11.118: Radial = op == "GR", then if (gradient.Radial) { … } else { … }).
const radialSplit = (labels: string[], text: string): [string[], string][] => {
  const radial = /\bRadial\s*=\s*op\s*==\s*"([A-Z]+)"/.exec(text)?.[1]
  if (!radial) return [[labels, text]]
  const at = text.search(/\bif\s*\(\s*gradient\.Radial\s*\)/)
  if (at < 0 || !labels.includes(radial)) throw new Error(`cannot split ${labels.join('/')} at its radial branch`)
  const [thenFrom, thenTo] = block(text, at), otherwise = /^\s*else\s*/.exec(text.slice(thenTo))
  if (!otherwise) throw new Error(`cannot find the linear branch of ${labels.join('/')}`)
  const [elseFrom, elseTo] = block(text, thenTo + otherwise[0].length)
  return [[labels, text.slice(0, at) + text.slice(elseTo)], [[radial], text.slice(thenFrom, thenTo)],
    [labels.filter(l => l !== radial), text.slice(elseFrom, elseTo)]]
}

export function extract(src: Sources): Extracted {
  const reads: Record<string, Record<string, Read>> = {}
  const take = (text: string, scopes: string[]) => {
    for (const m of text.matchAll(READ)) {
      const [, reader, arg, key] = m, at = m.index + m[0].length
      if (arg !== 'map' && arg !== 'props' && arg !== 'own') continue   // another map's read: checked against OTHER_MAP_READS
      for (const scope of scopes) {
        const r = (reads[scope] ??= {})[key] ??= {}
        const read = KINDS[reader], kind = (read === 'S' && r.kind === 'N') || (read === 'N' && r.kind === 'S') ? 'SN' : read
        if (kind && (!r.kind || PRIORITY.indexOf(kind) < PRIORITY.indexOf(r.kind))) r.kind = kind
        if (reader === 'HasKey') r.guarded = true
        if (reader === 'Pair') {
          const p = (PAIR.lastIndex = at, PAIR.exec(text))
          if (p && r.default === undefined) r.default = []
          if (p && Array.isArray(r.default)) r.default[+p[1]] = +p[2]   // by index: t's two reads make [0, 0]
        } else if (reader === 'Attr' || reader === 'PropNumber' || reader === 'Count') {
          const n = (NUMBER.lastIndex = at, NUMBER.exec(text))
          if (n) r.default ??= +n[1]
          else if (reader === 'Count') r.default ??= 0
        }
      }
    }
  }

  const all = methods(src.sceneModel)
  if ((all.length ? src.sceneModel.slice(0, src.sceneModel.indexOf(all[0].body)) : src.sceneModel).search(READ) >= 0)
    throw new Error('a read outside any method')
  let nodeOps: string[] = [], defOps: string[] = []
  for (const { name, body } of all) {
    const calls = [...body.matchAll(READ)]
    if (!calls.length) continue
    if ((body.match(MEMBER)?.length ?? 0) > 1) throw new Error(`a member header the method split missed, inside ${name}`)
    if (name !== 'ParseNode' && name !== 'ParseDefs' && !Object.hasOwn(SCOPES, name)) throw new Error(`unclassified reader method ${name}`)
    for (const [, reader, arg, key] of calls) {
      if (!Object.hasOwn(KINDS, reader)) throw new Error(`unknown reader ${reader}(${arg}, "${key}") in ${name}`)
      if (arg === 'map' || arg === 'props' ? !/^[a-z0-9_]+$/.test(key) : !(arg === 'own' ? OWN_MAP_READS : OTHER_MAP_READS)[name]?.includes(key))
        throw new Error(`unclassified read ${reader}(${arg}, "${key}") in ${name}`)
    }
    if (name === 'ParseNode') {
      // The text from Validate(map, scene, op on, and the op read before the first case, are every node op's.
      const at = body.indexOf('Validate(map, scene, op')
      if (at < 0) throw new Error('cannot find ParseNode\'s common tail')
      const head = body.slice(0, at), split = cases(head)
      take(head.split(CASE)[0] + body.slice(at), ['NODE'])
      for (const [labels, text] of split) take(text, labels)
      nodeOps = split.flatMap(([labels]) => labels)
    } else if (name === 'ParseDefs') {
      let prelude = body.split(CASE)[0]
      const split = cases(body), font = prelude.indexOf('if (op == "FONT")')
      if (font < 0) throw new Error('cannot find FONT definition')
      const [start, end] = block(prelude, font)
      take(prelude.slice(start, end), ['FONT'])
      prelude = prelude.slice(0, font) + prelude.slice(end)
      take(prelude, ['DEF'])   // op, id, and a SYM's c and params, read before the switch
      for (const [labels, text] of split) for (const [ops, part] of radialSplit(labels, text)) take(part, ops)
      defOps = ['FONT', ...split.flatMap(([labels]) => labels), ...[...prelude.matchAll(/\bop == "([A-Z]+)"/g)].map(m => m[1])]
    } else take(body, SCOPES[name])
  }
  for (const keys of Object.values(reads)) for (const r of Object.values(keys)) if (r.guarded) delete r.default

  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]))
  const variable = methods(src.expression).find(m => m.name === 'Variable')?.body
  if (variable === undefined) throw new Error('cannot find Expression.Variable')
  // since is parsed apart from Arity (it takes a data name, not a value); its one argument is hand-set here.
  const since: Record<string, number> = /\bname == "since"/.test(src.expression) ? { since: 1 } : {}
  const invokeAt = src.expression.indexOf('private float Invoke(')
  if (invokeAt < 0) throw new Error('cannot find Expression.Invoke')
  const [invokeFrom, invokeTo] = block(src.expression, invokeAt), invoke = src.expression.slice(invokeFrom, invokeTo)
  const arity: Record<string, number> = Object.fromEntries([...need(/\bArity\s*=\s*new\([^)]*\)\s*\{([^}]*)\}/, src.expression,
    'Expression.Arity').matchAll(/\["(\w+)"\]\s*=\s*(\d+)/g)].map(m => [m[1], +m[2]]))
  return {
    colourFunctions: Object.keys(arity).filter(n => !invoke.includes(`case "${n}":`)).sort(),
    defOps,
    filterKeys: strings(need(/\bKeys\s*=\s*\{([^}]*)\}/, src.colourFilter, 'ColourFilter.Keys')),
    functions: sorted({ ...arity, ...since }),
    groupPaintDefaults: strings(need(/\bGroupPaintDefaults\s*=\s*\{([^}]*)\}/, src.sceneModel, 'GroupPaintDefaults')),
    knownKeys: [...new Set(strings(need(/\bKnownKeys\s*=\s*new\([^)]*\)\s*\{([^}]*)\}/, src.sceneModel, 'KnownKeys')))].sort(),
    literalKeys: strings(need(/\bLiteralKeys\s*=\s*new\([^)]*\)\s*\{([^}]*)\}/, src.sceneModel, 'LiteralKeys')),
    sceneLiteralKeys: strings(need(/\bSceneLiteralKeys\s*=\s*new\([^)]*\)\s*\{([^}]*)\}/, src.sceneModel, 'SceneLiteralKeys')),
    nodeOps,
    pin: need(/<Version>(\d+\.\d+\.\d+)/, src.csproj, 'the csproj Version'),
    sceneKeys: [...new Set(strings(need(/\bSceneKeys\s*=\s*new\([^)]*\)\s*\{([^}]*)\}/, src.sceneModel, 'SceneKeys')))].sort(),
    reads: sorted(Object.fromEntries(Object.entries(reads).map(([scope, keys]) =>
      [scope, sorted(Object.fromEntries(Object.entries(keys).map(([k, r]) => [k, sorted(r) as Read])))]))),
    variables: [...new Set([...variable.matchAll(/name == "(\w+)"/g)].map(m => m[1])), 'i1'],
  }
}
