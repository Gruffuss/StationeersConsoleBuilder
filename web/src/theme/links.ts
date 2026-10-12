import type { SrcNode, Value } from '../model/scene'
import type { PartName, StyleName, Theme } from './types'
import { isStyle } from '../editing/styleKeys'
import { withAttr, passedDown } from '../editor/fields'
import { fieldOf } from '../schema'
import { foldKey } from '../srctext/props'
import { sameData } from '../model/same'
import { paintOf, shadow } from '../widgets/paint'
import { vanillaPlus } from './vanillaPlus'
import { gasOf } from '../catalog'
import { gasColours } from './index'
export type StyleLink = { role: string } | { gas: string } | { gradient: string } | { shadow: string }
  | { part: PartName; field: 'fill' | 'stroke' | 'width' | 'radius' | 'shadow' }
  | { type: StyleName; field: 'size' | 'font' | 'cspace' | 'ink' | 'shadow' | 'weight' }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const name = (v: unknown): v is string => typeof v === 'string' && !!v && !/[\r\n]/.test(v)
export function isStyleLink(v: unknown): v is StyleLink {
  if (!object(v)) return false
  const keys = Object.keys(v)
  if (keys.length === 1) return ['role', 'gas', 'gradient', 'shadow'].some(k => Object.hasOwn(v, k) && name(v[k]))
  if (keys.length !== 2 || !Object.hasOwn(v, 'field') || typeof v.field !== 'string') return false
  return Object.hasOwn(v, 'part') && name(v.part) && Object.hasOwn(vanillaPlus.parts, v.part)
    && ['fill', 'stroke', 'width', 'radius', 'shadow'].includes(v.field)
    || Object.hasOwn(v, 'type') && name(v.type) && Object.hasOwn(vanillaPlus.type, v.type)
    && ['size', 'font', 'cspace', 'ink', 'shadow', 'weight'].includes(v.field)
}
const styleComment = (c: string) => c.trim().startsWith('style {')
export function linksOf(n: SrcNode): Record<string, StyleLink> {
  const comments = n.comments?.filter(styleComment) ?? []
  if (comments.length !== 1) return {}
  try {
    const v: unknown = JSON.parse(comments[0].trim().slice(5))
    if (!object(v) || Object.entries(v).some(([k, l]) => !isStyle(n.op, k) || !isStyleLink(l))) return {}
    return Object.fromEntries(Object.entries(v)) as Record<string, StyleLink>
  } catch { return {} }
}
function recorded(n: SrcNode, links: Record<string, StyleLink>): SrcNode {
  const comments = (n.comments ?? []).filter(c => !styleComment(c))
  if (Object.keys(links).length) comments.push('style ' + JSON.stringify(links))
  const { comments: _, ...rest } = n
  return comments.length ? { ...rest, comments } : rest
}
/** Missing tokens are distinct from optional fields that intentionally omit an attribute. */
export function linkValue(link: StyleLink, t: Theme): { value?: Value; missing?: string } {
  if ('gas' in link) {
    const gas = gasOf(link.gas)
    return gas ? { value: Array.isArray(gas.fill) ? gas.fill[0] : gas.fill } : { missing: link.gas }
  }
  if ('role' in link) {
    const colors = Object.hasOwn(gasColours, link.role) ? gasColours : t.colors
    return Object.hasOwn(colors, link.role) ? { value: colors[link.role] } : { missing: link.role }
  }
  if ('gradient' in link) return Object.hasOwn(t.gradients, link.gradient) ? { value: '@theme_' + link.gradient } : { missing: link.gradient }
  if ('shadow' in link) {
    if (!Object.hasOwn(t.shadows, link.shadow)) return { missing: link.shadow }
    const missing = t.shadows[link.shadow].find(s => !s[4].startsWith('#') && !Object.hasOwn(t.colors, s[4]))
    if (missing) return { missing: missing[4] }
    const value = shadow(t, link.shadow) as Value[][]
    return { value: value.map(s => s.map(v => typeof v === 'number' ? Math.fround(v) : v)) }
  }
  if ('part' in link) {
    if (!Object.hasOwn(t.parts, link.part)) return { missing: link.part }
    const p = t.parts[link.part], v = p[link.field]
    if (link.field === 'fill' || link.field === 'stroke') {
      const paint = p[link.field]
      if (paint === 'state') return { missing: 'state' }
      if (typeof paint === 'object') return linkValue({ gradient: paint.gradient }, t)
      if (paint && paint !== 'none') return linkValue({ role: paint }, t)
      return { value: paintOf(t, paint) }
    }
    if (link.field === 'shadow') return p.shadow ? linkValue({ shadow: p.shadow }, t) : {}
    return { value: typeof v === 'number' ? Math.fround(v) : undefined }
  }
  if (!Object.hasOwn(t.type, link.type)) return { missing: link.type }
  const s = t.type[link.type]
  if (link.field === 'ink') return linkValue({ role: s.ink }, t)
  if (link.field === 'shadow') return s.shadow ? linkValue({ shadow: s.shadow }, t) : {}
  const v = s[link.field]
  return { value: typeof v === 'number' ? (link.field === 'cspace' && v === 0 ? undefined : Math.fround(v)) : v || undefined }
}
export function linked(n: SrcNode, key: string, link: StyleLink, t: Theme): SrcNode {
  const f = fieldOf(n.op, key)
  if (!f || !isStyle(n.op, key) || !isStyleLink(link)) throw new Error('invalid style link')
  const r = linkValue(link, t)
  const exact = passedDown(f), k = exact ? f.key : Object.keys(n.attrs).find(k => foldKey(k) === foldKey(key)) ?? f.key
  const links = linksOf(unlinked(n, [key]))
  return recorded(r.missing ? n : withAttr(n, k, r.value, exact), { ...links, [k]: link })
}
export function unlinked(n: SrcNode, keys?: readonly string[]): SrcNode {
  if (!n.comments?.some(styleComment)) return n
  const links = linksOf(n)
  for (const k of Object.keys(links)) if (!keys || keys.some(key => foldKey(key) === foldKey(k))) delete links[k]
  return recorded(n, links)
}
export function resolveLinks(n: SrcNode, from: Theme, to: Theme): { node: SrcNode; missing: string[]; stale: number } {
  let out = n, stale = 0
  const missing = new Set<string>()
  for (const [key, link] of Object.entries(linksOf(n))) {
    const was = linkValue(link, from), next = linkValue(link, to)
    const values: (Value | undefined)[] = [n.attrs[key]]
    let bound = false
    while (values.length) {
      const v = values.pop()
      if (Array.isArray(v)) { for (const x of v) values.push(x) }
      else if (typeof v === 'string' && /^[=$]/.test(v)) bound = true
    }
    if (bound || !was.missing && !sameData(n.attrs[key], was.value)) { out = unlinked(out, [key]); stale++; continue }
    if (next.missing) { missing.add(next.missing); continue }
    out = linked(out, key, link, to)
  }
  return { node: out, missing: [...missing], stale }
}
