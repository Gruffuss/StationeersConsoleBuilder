export type DsFiles = ReadonlyMap<string, Uint8Array>
export type Rgba = string
export type DsColour = { name: string; value: Record<string, Rgba>; alias?: Record<string, string>; usage?: string; outOfGamut?: string[] }
export type DsLength = { family: string; name: string; px?: number; percent?: number; usage?: string }
export type ShadowLayer = { dx: number; dy: number; blur: number; spread: number; colour: Rgba; colourToken?: string; inset: boolean }
export type DsShadow = { name: string; layers: Record<string, ShadowLayer[]>; usage?: string }
export type DsStyle = { name: string; group: string; families: string[]; size: number; weight: number; italic: boolean; letterSpacing?: number; lineHeight?: number; usage?: string }
export type SelectorPart = { kind: 'type' | 'class' | 'id' | 'attribute' | 'pseudo-class' | 'pseudo-element' | 'combinator'; value: string }
export type Selector = { text: string; parts: SelectorPart[] }
export type CssRule = { selectors: Selector[]; decls: { prop: string; value: string; important: boolean }[]; at?: string }
export type DesignSystem = {
  name: string; themes: { id: string; name: string }[]; colours: DsColour[]; styles: DsStyle[]
  fonts: { family: string; path?: string; weight: [number, number]; style: 'normal' | 'italic' | 'oblique' }[]
  lengths: DsLength[]; shadows: DsShadow[]; rules: CssRule[]; components: { name: string; readme?: string }[]
  readme?: string; files: DsFiles; notes: string[]
}
export const record = <T>(): Record<string, T> => Object.create(null)
export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(Math.fround(v))
export const tokenName = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v)
export function safePath(path: string): string | undefined {
  path = path.replace(/\\/g, '/')
  if (/^[\/]|^[a-z]:|[\x00-\x1f\x7f]/i.test(path) || path.split('/').includes('..')) return undefined
  return path.split('/').filter(p => p && p !== '.').join('/')
}

/** Split only outside strings, escapes and balanced CSS blocks. */
export function splitCss(text: string, delimiter = ','): string[] {
  const parts: string[] = []; let start = 0, depth = 0, quote = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { i++; continue }
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth === 0 && (delimiter === ' ' ? /\s/.test(c) : c === delimiter)) { if (i > start || delimiter !== ' ') parts.push(text.slice(start, i).trim()); start = i + 1 }
  }
  if (start < text.length || delimiter !== ' ') parts.push(text.slice(start).trim())
  return parts
}
