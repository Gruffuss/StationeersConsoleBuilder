import type { Scene, Value } from '../model/scene'
import { first, textOf } from '../srctext/props'
import { fontNames } from './text'
import { getPageFontRecord, PAGE_FONT_NOTICE, pageFontLinks } from './pageFonts'

// Token grammar ported from vector v0.11.118 TextNode.cs:685-724, 757-759 (MIT).
function firstLineFont(style: string) {
  const token = /\s*([^\s=]+)(?:=(?:"([^"]*)(?:"|$)|'([^']*)(?:'|$)|([^\s]*)))?/y
  let font: string | undefined, match: RegExpExecArray | null
  while ((match = token.exec(style))) if (match[1] === 'font') font = match[2] ?? match[3] ?? match[4] ?? ''
  return font
}

/** Model names in header/node order, before source quoting. */
export function sceneFontNames(scene: Scene) {
  const attributes = new Set<string>(), tags = new Set<string>()
  const read = (attrs: Record<string, Value>) => {
    const node = { op: 'T', attrs }, font = textOf(first(node, 'FONT')), text = textOf(first(node, 'TEXT'))
    if (font) attributes.add(font)
    const fl = textOf(first(node, 'FL')), lineFont = fl && firstLineFont(fl)
    if (lineFont) attributes.add(lineFont)
    if (text) for (const name of fontNames(text)) tags.add(name)
  }
  read(scene.header)
  const todo = [...scene.defs, ...scene.root].reverse()
  while (todo.length) {
    const node = todo.pop()!
    read(node.attrs)
    if (node.c) for (let i = node.c.length - 1; i >= 0; i--) todo.push(node.c[i])
  }
  return { attributes: [...attributes], tags: [...tags] }
}

export const fontFallbackWarning = (name: string) => `font "${name}": unless the player has this face, the game uses its fallback and reports it.`
export const fontTagWarning = (name: string) => `font tag "${name}": unless the player has this face, the tag shows as text in game.`

/** Preview state only: exports never call this or inspect request/registry state. */
export function previewFontWarning(scene: Scene | undefined, missing: readonly string[], tags: readonly string[]): string {
  const links = scene ? pageFontLinks(scene) : [], records = links.map(getPageFontRecord)
  const notes: string[] = []
  if (missing.length) notes.push(`Not available here, so drawn in Liberation Sans: ${missing.join(', ')}.`)
  if (tags.length) notes.push(`Unknown font tags shown as text: ${tags.join(', ')}.`)
  if ((missing.length || tags.length) && links.length) {
    if (records.some(r => r?.state === 'pending')) notes.push('Page fonts loading; text uses fallback until its face arrives.')
    else if (records.some(r => !r)) notes.push("This page declares font links; Load this page's fonts to preview them. Text uses fallback here.")
    else notes.push(`Delivered face names: ${[...new Set(records.flatMap(r => r!.names))].join(', ') || 'none'}.`)
  } else if (missing.length || tags.length) {
    notes.push(...missing.map(fontFallbackWarning), ...tags.map(fontTagWarning), 'Import them under Fonts. The export keeps the names.')
  }
  for (const r of records) {
    if (r?.cause) notes.push(`${r.link}: ${r.cause}`)
    if (r?.notice && r.notice !== PAGE_FONT_NOTICE) notes.push(r.notice)
    for (const failure of r?.subsetFailures ?? []) notes.push(`${failure.url}: ${failure.cause}; affected glyphs use fallback here.`)
  }
  return notes.join(' ')
}
