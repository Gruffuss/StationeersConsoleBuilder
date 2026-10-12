import { ROLES, STYLES, THEMES } from '../index'
import type { PartName, StyleName, Theme } from '../types'
import { record, type DesignSystem, type Selector } from './types'

export type Choices = { name: string; colourTheme: string; base: 'neutral' | 'vanilla-plus'
  roles: Record<string, string | null>; styles: Record<StyleName, string | null>; styleRules: Record<StyleName, string | null>
  parts: Record<PartName, string | null>; geo: Record<string, string | null>; widgetDefaults: Theme['widgetDefaults'] }

const normalized = (name: string) => name.toLowerCase().replace(/[-_.]/g,'')
const roleNames: Record<string, string[]> = {
  'surface-screen': ['background','bg','surface'], text: ['foreground','fg','text-primary'], brand: ['primary'],
  'status-ok': ['success'], 'status-warn': ['warning'], 'status-crit': ['error'], danger: ['destructive'],
  'text-muted': ['muted-foreground'], 'surface-panel': ['card'], accent: ['ring','focus'],
}
const styleNames: Partial<Record<StyleName, string[]>> = {
  hero: ['display','h1'], 'screen-title': ['title','h2'], 'panel-title': ['heading','h3'], 'button-label': ['button','btn'],
  'chip-label': ['chip','badge','tag'], message: ['body'], unit: ['caption','small','label'], reading: ['readout'],
  'value-lg': ['large-value'], value: ['number'], clock: ['time'],
}
const partNames: Partial<Record<PartName, string[]>> = {
  panel: ['card'], row: ['list-item'], track: ['bar','progress'], header: ['banner','appbar'], chip: ['badge','tag'],
  knob: ['thumb'], field: ['input'],
}
const matches = (value: string, word: string) => normalized(value) === normalized(word) || value.toLowerCase().replace(/[_.]/g,'-').endsWith('-' + word.toLowerCase().replace(/[_.]/g,'-'))
const classes = (s: Selector) => s.parts.filter(p => p.kind === 'class').map(p => p.value)
const simple = (s: Selector) => !s.parts.some(p => p.kind === 'combinator' || p.kind === 'pseudo-element' || p.kind === 'pseudo-class')
const namesOf = (name: string, aliases: readonly string[], names: readonly string[]): string | null => {
  for (const word of [name,...aliases]) { const found = names.find(n => normalized(n) === normalized(word)); if (found) return found }
  return null
}

export function autoChoices(ds: DesignSystem): Choices {
  const selectors = ds.rules.filter(r => !r.at).flatMap(r => r.selectors), find = (test: (s: Selector) => boolean) => selectors.find(test)?.text ?? null
  const roles = record<string | null>(), styles = record<string | null>() as Choices['styles'], styleRules = record<string | null>() as Choices['styleRules']
  for (const role of ROLES) roles[role] = namesOf(role,roleNames[role] ?? [],ds.colours.map(c => c.name))
  for (const style of STYLES) {
    styles[style] = namesOf(style,styleNames[style] ?? [],ds.styles.map(s => s.name))
    styleRules[style] = find(s => simple(s) && matches(classes(s).at(-1) ?? '',style))
  }
  const parts = record<string | null>() as Choices['parts']
  for (const part of Object.keys(THEMES.neutral.parts) as PartName[]) {
    parts[part] = null
    if (part === 'focus') { parts[part] = find(s => s.parts.some(p => p.kind === 'pseudo-class' && p.value === 'focus-visible') || classes(s).some(c => matches(c,'focus'))); continue }
    if (part.startsWith('button.') || part.startsWith('light.') || part.startsWith('switch.')) {
      const [family, variant] = part.split('.'), words = family === 'button' ? ['button','btn'] : family === 'light' ? ['light','dot','indicator'] : ['switch']
      const variants = variant === 'warn' ? ['warn','warning'] : variant === 'crit' ? ['crit','error','danger'] : variant === 'ok' ? ['ok','success'] : [variant]
      parts[part] = find(s => simple(s) && classes(s).some(c => words.some(w => matches(c,w))) && classes(s).some(c => variants.some(w => normalized(c) === w)))
      if (!parts[part] && (variant === 'secondary' || variant === 'idle' || variant === 'off')) parts[part] = find(s => simple(s) && classes(s).length === 1 && words.some(w => matches(classes(s)[0],w)))
      continue
    }
    for (const word of [part,...partNames[part] ?? []]) {
      const rule = find(s => simple(s) && classes(s).length === 1 && matches(classes(s)[0],word))
      if (rule) { parts[part] = rule; break }
    }
  }
  if (parts.track) parts.fill = find(s => s.text.startsWith(parts.track! + ' ')
    && s.parts.filter(p => p.kind === 'combinator').every(p => p.value === ' ' || p.value === '>')
    && !s.parts.some(p => p.kind === 'pseudo-element' || p.kind === 'pseudo-class')) ?? parts.fill
  const geo = record<string | null>()
  for (const [family, keys] of [['space',['1','2','3','4','5','6','7']], ['radius',['xs','sm','md','lg','xl']], ['size',['header','light','bar','row','control']]] as const) {
    const lengths = ds.lengths.filter(l => l.family === (family === 'space' ? 'spacing' : family) && l.px !== undefined).sort((a,b) => a.px!-b.px!)
    keys.forEach((key,i) => {
      const aliases = family === 'space' ? ['spacing-' + key] : family === 'size' ? [key + '-height'] : []
      geo[family + '.' + key] = namesOf(family + '-' + key,aliases,ds.lengths.map(l => l.name)) ?? (family === 'size' ? null : lengths[i]?.name ?? null)
    })
  }
  return { name: ds.name, colourTheme: ds.themes[0].id, base: 'neutral', roles, styles, styleRules, parts, geo, widgetDefaults: undefined }
}
