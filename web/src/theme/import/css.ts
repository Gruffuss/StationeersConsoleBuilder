import { angle, cssColour } from './colour'
import { finite, splitCss, type CssRule, type Selector, type SelectorPart, type ShadowLayer } from './types'

type Token = { kind: 'space' | 'word' | 'string' | 'char'; raw: string; value: string }
export function unescapeCss(text: string): string {
  return text.replace(/\\([\da-f]{1,6})(?:\r\n|\s)?|\\([^\n\r\f])/gi, (_all, hex: string | undefined, char: string) => {
    if (!hex) return char
    const cp = Number.parseInt(hex,16)
    return String.fromCodePoint(cp === 0 || cp > 0x10ffff || cp >= 0xd800 && cp <= 0xdfff ? 0xfffd : cp)
  })
}

/** CSS Syntax 3 lexical boundaries; URL contents remain text. */
function lex(text: string, notes: string[]): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < text.length) {
    const start = i, c = text[i]
    let kind: Token['kind'] = 'char'
    if (c === '/' && text[i+1] === '*') {
      const end = text.indexOf('*/',i+2)
      if (end < 0) { notes.push('CSS: unterminated comment'); break }
      i = end + 2; tokens.push({ kind: 'space', raw: ' ', value: ' ' }); continue
    }
    if (/\s/.test(c)) { kind = 'space'; while (i < text.length && /\s/.test(text[i])) i++ }
    else if (c === '"' || c === "'") {
      kind = 'string'; i++
      let closed = false
      while (i < text.length) {
        if (text[i] === '\\') { i += text[i+1] === '\r' && text[i+2] === '\n' ? 3 : 2; continue }
        if (text[i] === c) { i++; closed = true; break }
        if (/[\n\r\f]/.test(text[i])) break
        i++
      }
      if (!closed) notes.push('CSS: unterminated string at ' + start)
    } else if (/[-\w\u0080-\uffff]/.test(c) || c === '\\') {
      kind = 'word'
      while (i < text.length) {
        if (text[i] === '\\') {
          i++
          const hex = /^[\da-f]{1,6}/i.exec(text.slice(i))
          if (hex) { i += hex[0].length; if (/\s/.test(text[i] ?? '')) i++ }
          else if (i < text.length) i++
        } else if (/[-\w\u0080-\uffff]/.test(text[i])) i++
        else break
      }
    } else i++
    const raw = text.slice(start,i)
    tokens.push({ kind, raw, value: kind === 'word' ? unescapeCss(raw) : raw })
  }
  return tokens
}
const textOf = (tokens: Token[]) => tokens.map(t => t.raw).join('')
function pairs(tokens: Token[], notes: string[]): Map<number,number> {
  const stack: number[] = [], close = new Map<number,number>()
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'char') continue
    const c = tokens[i].raw
    if ('([{'.includes(c)) stack.push(i)
    else if (')]}'.includes(c)) {
      const open = stack.at(-1)
      if (open === undefined || '([{'.indexOf(tokens[open].raw) !== ')]}'.indexOf(c)) { notes.push('CSS: unmatched ' + c); continue }
      stack.pop(); close.set(open,i)
    }
  }
  for (const i of stack) notes.push('CSS: unclosed ' + tokens[i].raw)
  return close
}
export function selectorOf(text: string): Selector {
  const tokens = lex(text,[]), close = pairs(tokens,[]), parts: SelectorPart[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], c = t.value
    if (t.kind === 'space') {
      const next = tokens.slice(i+1).find(n => n.kind !== 'space')
      if (parts.length && parts.at(-1)!.kind !== 'combinator' && next && !['>','+','~','|'].includes(next.value)) parts.push({ kind: 'combinator', value: ' ' })
    } else if (['>','+','~','|'].includes(c)) { if (parts.at(-1)?.value === ' ') parts.pop(); parts.push({ kind: 'combinator', value: c }) }
    else if (c === '[') { const end = close.get(i) ?? i; parts.push({ kind: 'attribute', value: unescapeCss(textOf(tokens.slice(i+1,end))) }); i = end }
    else if (c === '.' || c === '#') { parts.push({ kind: c === '.' ? 'class' : 'id', value: tokens[++i]?.value ?? '' }) }
    else if (c === ':') {
      const element = tokens[i+1]?.value === ':'; if (element) i++
      let name = tokens[++i]?.value ?? ''
      if (tokens[i+1]?.value === '(') { const end = close.get(i+1) ?? i+1; name += textOf(tokens.slice(i+1,end+1)); i = end }
      parts.push({ kind: element || ['before','after','first-line','first-letter'].includes(name) ? 'pseudo-element' : 'pseudo-class', value: name })
    } else parts.push({ kind: 'type', value: c })
  }
  if (parts.at(-1)?.value === ' ') parts.pop()
  return { text: text.trim(), parts }
}

export function parseCss(text: string): { rules: CssRule[]; custom: { selector: string; name: string; value: string }[]; notes: string[] } {
  const notes: string[] = [], tokens = lex(text,notes), close = pairs(tokens,notes), rules: CssRule[] = [], custom: { selector: string; name: string; value: string }[] = []
  const stack = [{ next: 0, end: tokens.length, at: '' }]
  while (stack.length) {
    const frame = stack.at(-1)!
    while (frame.next < frame.end && (tokens[frame.next].kind === 'space' || tokens[frame.next].value === ';')) frame.next++
    if (frame.next >= frame.end) { stack.pop(); continue }
    const start = frame.next
    let stop = start
    while (stop < frame.end) {
      const c = tokens[stop].value
      if (tokens[stop].kind === 'char' && (c === ';' || c === '{')) break
      if (tokens[stop].kind === 'char' && (c === '(' || c === '[') && close.has(stop)) stop = close.get(stop)!
      stop++
    }
    const prelude = textOf(tokens.slice(start,stop)).trim(), block = tokens[stop]?.value === '{', end = block ? close.get(stop) : stop
    if (end === undefined || end > frame.end) { notes.push(prelude + ': unclosed rule'); frame.next = frame.end; continue }
    frame.next = end + 1
    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase()
      if (block && (name === 'media' || name === 'supports')) stack.push({ next: stop+1, end, at: frame.at ? frame.at + ' / ' + prelude : prelude })
      else notes.push(prelude + ': ' + (name === 'import' || name === 'font-face' ? 'not followed' : 'unsupported at-rule'))
      continue
    }
    if (!block || !prelude) { notes.push(prelude + ': expected a CSS rule'); continue }
    const selectors = splitCss(prelude).map(selectorOf), decls: CssRule['decls'] = []
    for (const declaration of splitCss(textOf(tokens.slice(stop+1,end)), ';')) {
      if (!declaration) continue
      const fields = splitCss(declaration,':'), prop = unescapeCss(fields.shift()!.trim()), rest = fields.join(':').trim()
      if (!/^--[^\s:]+$|^-?[a-z][\w-]*$/i.test(prop) || !rest) { notes.push(prelude + ': unreadable declaration ' + declaration); continue }
      const important = /!\s*important\s*$/i.test(rest), value = rest.replace(/!\s*important\s*$/i,'').trim()
      const normalized = prop.startsWith('--') ? prop : prop.toLowerCase()
      decls.push({ prop: normalized, value, important })
      if (normalized.startsWith('--')) for (const selector of selectors) custom.push({ selector: selector.text, name: normalized, value })
    }
    rules.push({ selectors, decls, ...(frame.at ? { at: frame.at } : {}) })
  }
  return { rules, custom, notes }
}

export function resolveVars(text: string, vars: (name: string) => string | undefined): { value?: string; notes: string[] } {
  const notes: string[] = [], active = new Set<string>(), invalid = new Set<string>()
  type Frame = { tokens: Token[]; close: Map<number,number>; next: number; out: string[]; variable?: string; fallback?: string }
  const frameOf = (source: string, variable?: string, fallback?: string): Frame => { const tokens = lex(source,notes); return { tokens, close: pairs(tokens,notes), next: 0, out: [], variable, fallback } }
  // Bound substitution work, including intermediate strings, without limiting reference depth.
  let remaining = 1024 * 1024
  const append = (frame: Frame, value: string): boolean => {
    remaining -= Math.max(1,value.length)
    if (remaining < 0) { notes.push('var(): too large to resolve here'); return false }
    frame.out.push(value); return true
  }
  const stack = [frameOf(text)]
  const fail = (note: string): boolean => {
    notes.push(note)
    while (stack.length) {
      const failed = stack.pop()!
      if (failed.variable) active.delete(failed.variable)
      if (failed.fallback !== undefined && (!stack.at(-1)?.variable || !invalid.has(stack.at(-1)!.variable!))) { stack.push(frameOf(failed.fallback)); return true }
    }
    return false
  }
  while (stack.length) {
    const frame = stack.at(-1)!
    if (frame.next >= frame.tokens.length) {
      const value = frame.out.join(''); stack.pop()
      if (frame.variable) active.delete(frame.variable)
      if (!stack.length) return { value, notes }
      if (!append(stack.at(-1)!,value)) return { notes }
      continue
    }
    const i = frame.next++, token = frame.tokens[i]
    if (token.kind === 'word' && frame.tokens[i+1]?.value === '(') {
      const end = frame.close.get(i+1)
      if (end === undefined) return { notes: [...notes,'var(): unclosed function'] }
      if (token.value.toLowerCase() === 'url') { if (!append(frame,textOf(frame.tokens.slice(i,end+1)))) return { notes }; frame.next = end+1; continue }
      if (token.value.toLowerCase() === 'var') {
        frame.next = end+1
        const [rawName,...fallback] = splitCss(textOf(frame.tokens.slice(i+2,end))), name = unescapeCss(rawName)
        if (!/^--[^\s,]+$/.test(name)) return { notes: [...notes,'var(' + name + '): invalid name'] }
        if (active.has(name)) {
          const first = stack.findIndex(f => f.variable === name)
          for (const f of stack.slice(first)) if (f.variable) invalid.add(f.variable)
          if (!fail(name + ': variable cycle')) return { notes }
          continue
        }
        const value = vars(name)
        if (value === undefined && !fallback.length) { if (!fail(name + ': missing variable')) return { notes }; continue }
        if (invalid.has(name)) {
          if (fallback.length) { stack.push(frameOf(fallback.join(','))); continue }
          if (!fail(name + ': invalid variable')) return { notes }
          continue
        }
        active.add(name); stack.push(frameOf(value ?? fallback.join(','),name,value === undefined || !fallback.length ? undefined : fallback.join(','))); continue
      }
    }
    if (!append(frame,token.raw)) return { notes }
  }
  return { notes }
}

export function readLength(text: string | number, notes?: string[]): { px?: number; percent?: number } | undefined {
  if (typeof text === 'number') return finite(text) ? { px: text } : undefined
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|rem|em|%)?$/i.exec(text.trim())
  if (!m) return undefined
  const n = Number(m[1]), unit = m[2]?.toLowerCase()
  if (!finite(n) || !unit && n !== 0) return undefined
  if (unit === '%') return { percent: n }
  const px = n * (unit === 'rem' || unit === 'em' ? 16 : 1)
  if (!finite(px)) return undefined
  if (unit === 'rem' || unit === 'em') notes?.push(unit + ': read at 16 px')
  return { px }
}
export function familiesOf(text: string): string[] {
  const generic = new Set(['serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif','ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong'])
  const names = splitCss(text).map(s => unescapeCss(s.replace(/^(['"])(.*)\1$/s,'$2'))).filter(Boolean)
  return [...names.filter(n => !generic.has(n.toLowerCase())),...names.filter(n => generic.has(n.toLowerCase()))]
}
export function readWeight(value: unknown): [number,number] | undefined {
  if (value === undefined || value === 'normal') return [400,400]
  if (value === 'bold') return [700,700]
  const parts = typeof value === 'number' ? [value] : typeof value === 'string' ? value.trim().split(/\s+/).map(Number) : []
  if (parts.length < 1 || parts.length > 2 || !parts.every(n => finite(n) && n >= 1 && n <= 1000) || parts.length === 2 && parts[0] > parts[1]) return undefined
  return [parts[0],parts.at(-1)!]
}
export function readLineHeight(text: unknown, notes?: string[]): number | undefined {
  const n = typeof text === 'number' ? text : typeof text === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : undefined
  if (n !== undefined) return finite(n) && n > 0 && n < 10 ? n : undefined
  const length = typeof text === 'string' ? readLength(text,notes)?.px : undefined
  return length !== undefined && length > 0 ? length : undefined
}
export function readFont(text: string): { italic: boolean; weight: number; size: number; lineHeight?: number; families: string[] } | undefined {
  const tokens = splitCss(text,' ')
  let italic = false, weight = 400
  for (let i = 0; i < tokens.length; i++) {
    const sizes = tokens[i].split('/'), size = readLength(sizes[0])?.px
    if (size !== undefined && size > 0) {
      let lineHeight: number | undefined
      if (sizes.length === 2) { lineHeight = readLineHeight(sizes[1]); if (lineHeight === undefined) return undefined }
      else if (tokens[i+1]?.startsWith('/')) {
        i++; const lh = tokens[i] === '/' ? tokens[++i] : tokens[i].slice(1); lineHeight = readLineHeight(lh); if (lineHeight === undefined) return undefined
      }
      const families = familiesOf(tokens.slice(i+1).join(' ')); if (!families.length) return undefined
      return { italic, weight, size, ...(lineHeight === undefined ? {} : { lineHeight }), families }
    }
    if (['italic','oblique'].includes(tokens[i])) italic = true
    else if (tokens[i] === 'normal') continue
    else { const w = readWeight(tokens[i]); if (!w || w[0] !== w[1]) return undefined; weight = w[0] }
  }
  return undefined
}
export function readBorder(text: string): { width: number; style: string; colour?: string } | undefined {
  const styles = ['none','hidden','solid','dashed','dotted','double','groove','ridge','inset','outset']
  let width: number | undefined, style: string | undefined, colour: string | undefined
  for (const part of splitCss(text,' ')) {
    if (styles.includes(part) && !style) style = part
    else if (readLength(part)?.px !== undefined && width === undefined) width = readLength(part)!.px
    else if (['thin','medium','thick'].includes(part) && width === undefined) width = { thin: 1, medium: 3, thick: 5 }[part]
    else if (cssColour(part).rgba && colour === undefined) colour = cssColour(part).rgba
    else return undefined
  }
  if (width !== undefined && width < 0) return undefined
  return { width: style === 'none' || style === 'hidden' ? 0 : width ?? 3, style: style ?? 'none', ...(colour ? { colour } : {}) }
}
type Dimension = number | string
const dimension = (text: string): Dimension | undefined => { const n = readLength(text); return n?.px ?? (n?.percent !== undefined ? n.percent + '%' : undefined) }
const four = <T>(values: T[]): [T,T,T,T] => [values[0],values[1] ?? values[0],values[2] ?? values[0],values[3] ?? values[1] ?? values[0]]
export function readRadii(text: string): { radii?: [Dimension,Dimension,Dimension,Dimension]; notes: string[] } {
  const notes: string[] = []
  if (splitCss(text,'/').length > 1) return { notes: ['border-radius: elliptical radii (/) are not represented'] }
  const values = splitCss(text,' ').map(dimension)
  if (!values.length || values.length > 4 || values.some(v => v === undefined || Number.parseFloat(String(v)) < 0)) return { notes: ['border-radius: unreadable radii'] }
  return { radii: four(values as Dimension[]), notes }
}
export function readShadow(text: string, vars?: (name: string) => string | undefined): ShadowLayer[] | undefined {
  if (text.trim() === 'none') return []
  const layers: ShadowLayer[] = []
  for (const layer of splitCss(text)) {
    const nums: number[] = []; let inset = false, colour: string | undefined, colourToken: string | undefined
    for (const part of splitCss(layer,' ')) {
      if (part === 'inset' && !inset) { inset = true; continue }
      const parsed = cssColour(part,vars)
      if (parsed.rgba && !colour) { colour = parsed.rgba; const m = /^var\(--([^,)]+)\)$/.exec(part); if (m) colourToken = m[1]; continue }
      const n = readLength(part)?.px
      if (n === undefined) return undefined
      nums.push(n)
    }
    if (!colour || nums.length < 2 || nums.length > 4 || (nums[2] ?? 0) < 0) return undefined
    layers.push({ dx: nums[0], dy: nums[1], blur: nums[2] ?? 0, spread: nums[3] ?? 0, colour, ...(colourToken ? { colourToken } : {}), inset })
  }
  return layers
}
export function readBackground(text: string): { colour?: string; gradient?: { direction: string; stops: { colour: string; position?: Dimension }[] } } | undefined {
  const colour = cssColour(text).rgba
  if (colour) return { colour }
  const m = /^linear-gradient\((.*)\)$/is.exec(text.trim()); if (!m) return undefined
  const parts = splitCss(m[1]); let direction = 'to bottom'
  if (/^to (?:left|right|top|bottom)(?: (?:left|right|top|bottom))?$/.test(parts[0]) || angle(parts[0]) !== undefined) direction = parts.shift()!
  const stops: { colour: string; position?: Dimension }[] = []
  for (const part of parts) {
    const values = splitCss(part,' ')
    if (!values.length) return undefined
    const c = cssColour(values[0]).rgba
    if (!c || values.length > 3) return undefined
    if (values.length === 1) stops.push({ colour: c })
    else for (const pos of values.slice(1)) { const n = readLength(pos); if (!n) return undefined; stops.push({ colour: c, position: n.percent ?? (n.px + 'px') }) }
  }
  return stops.length >= 2 ? { gradient: { direction, stops } } : undefined
}
export function readDeclaration(prop: string, text: string): { value?: unknown; notes: string[] } {
  let value: unknown; const notes: string[] = []
  if (/^(border(?:-(top|right|bottom|left))?|outline)$/.test(prop)) value = readBorder(text)
  else if (prop === 'border-radius') { const result = readRadii(text); return { value: result.radii, notes: result.notes } }
  else if (/^border-(top-left|top-right|bottom-left|bottom-right)-radius$/.test(prop)) value = dimension(text)
  else if (prop === 'box-shadow' || prop === 'text-shadow') { const layers = readShadow(text); if (prop !== 'text-shadow' || layers?.every(s => !s.inset && s.spread === 0)) value = layers }
  else if (prop === 'background' || prop === 'background-color') value = readBackground(text)
  else if (prop === 'font') value = readFont(text)
  else if (prop === 'font-family') value = familiesOf(text)
  else if (prop === 'font-weight') value = readWeight(text)?.[0]
  else if (prop === 'font-size' || prop === 'letter-spacing') value = text === 'normal' && prop === 'letter-spacing' ? 0 : readLength(text)?.px
  else if (prop === 'line-height') value = readLineHeight(text)
  else if (prop === 'color') value = cssColour(text).rgba
  else if (prop === 'text-transform' && ['none','uppercase','lowercase','capitalize'].includes(text)) value = text
  else if (prop === 'transform') { const m = /^rotate\(([^()]+)\)$/.exec(text); if (m) value = angle(m[1]); else if (text === 'none') value = 0 }
  else if (prop === 'clip-path') {
    const m = /^polygon\((.*)\)$/.exec(text)
    if (m) {
      const points = splitCss(m[1]).map(p => splitCss(p,' ').map(dimension))
      if (points.length >= 3 && points.every(p => p.length === 2 && p.every(n => n !== undefined))) value = { polygon: points }
    } else if (text === 'none') value = { polygon: [] }
  } else if (['left','top','right','bottom','width','height'].includes(prop)) value = text === 'auto' ? text : dimension(text)
  else if (prop === 'inset') { const values = splitCss(text,' ').map(v => v === 'auto' ? v : dimension(v)); if (values.length >= 1 && values.length <= 4 && values.every(v => v !== undefined)) value = four(values) }
  else if (prop === 'position' && ['static','relative','absolute','fixed','sticky'].includes(text)) value = text
  else if (prop === 'display' && ['none','block','inline','inline-block','flex','inline-flex','grid','inline-grid','contents'].includes(text)) value = text
  else if (prop === 'content' && (/^(['"]).*\1$/s.test(text) || ['none','normal'].includes(text))) value = text.startsWith('"') || text.startsWith("'") ? unescapeCss(text.slice(1,-1)) : text
  if (value === undefined) notes.push(prop + ': cannot read ' + text)
  return { ...(value === undefined ? {} : { value }), notes }
}
