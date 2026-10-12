import fontCatalogue from '../../catalog/fonts.json'
import { gasColours, ROLES, STYLES, THEMES } from '../index'
import { sanitizeTheme, themeFileOf, type ThemeFile } from '../file'
import { faceName, linesOf } from '../faces'
import { metricsFor } from '../metrics'
import type { Look, Paint, PaintPart, PartName, ShadowSpec, Theme } from '../types'
import type { Choices } from './match'
import { decorate } from './decor'
import { cssColour } from './colour'
import { familiesOf, readBackground, readBorder, readFont, readLength, readRadii, readShadow, readWeight, resolveVars, selectorOf } from './css'
import { cssOf, dsVariables } from './tokens'
import { record, splitCss, type CssRule, type DesignSystem, type Selector } from './types'

export type Source = { token: string } | { rule: string } | { base: string } | { player: true } | { derived: string }
export type FontNeed = { face: string; supplied: 'mod' | 'local' | 'file' | 'none'; file?: string }
export type MappingReport = { sources: Record<string,Source>; dropped: string[]; cannotDraw: string[]; fonts: FontNeed[]; notes: string[] }
type Declaration = { value: string; raw: string; rule: string }
const inherited = new Set(['color','text-shadow','text-transform','letter-spacing','font','font-family','font-weight','font-style','font-size','line-height'])
function groups(s: Selector): string[][] {
  const out: string[][] = [[]]
  for (const p of s.parts) {
    if (p.kind === 'combinator') out.push([p.kind + ':' + p.value])
    else out.at(-1)!.push(p.kind + ':' + p.value)
  }
  return out
}
function applies(rule: Selector, selected: Selector): boolean {
  const a = groups(rule), b = groups(selected)
  const pseudo = selected.parts.find(p => p.kind === 'pseudo-element')
  if (pseudo && !rule.parts.some(p => p.kind === 'pseudo-element' && p.value === pseudo.value)) return false
  return a.length === b.length && a.every((g,i) => g.every(p => b[i].includes(p)))
}
const unique = (name: string, used: object): string => {
  const stem = name.slice(0,64); let key = stem, n = 2
  while (Object.hasOwn(used,key)) { const suffix = '-' + n++; key = stem.slice(0,64-suffix.length) + suffix }
  return key
}

export function proposeTheme(ds: DesignSystem, c: Choices, taken: ReadonlySet<string>, localFonts: ReadonlySet<string> = new Set()): { theme: Theme; file: ThemeFile; report: MappingReport } {
  const base = THEMES[c.base], t = { ...themeFileOf(base).theme, id: '' } as Theme
  const report: MappingReport = { sources: record(), dropped: [], cannotDraw: [], fonts: [], notes: [...ds.notes] }
  const stamp = (path: string, value: unknown, source: Source) => {
    const stack = [{ path,value }]
    while (stack.length) {
      const item = stack.pop()!; report.sources[item.path] = source
      if (item.value && typeof item.value === 'object') for (const [key,v] of Object.entries(item.value)) stack.push({ path: item.path ? item.path + '.' + key : key, value: v })
    }
  }
  stamp('',t,{ base: base.name }); t.name = c.name; stamp('name',t.name,{ player: true })
  let themeId = c.colourTheme
  if (!ds.themes.some(theme => theme.id === themeId)) { report.notes.push('color.themes: unknown selection ' + themeId + '; using the first'); themeId = ds.themes[0].id }
  const names = new Map<string,string>(), occupied = { ...base.colors, ...Object.fromEntries(ds.colours.map(colour => [colour.name,true])) }
  for (const colour of ds.colours) {
    const value = colour.value[themeId]
    if (value === undefined) continue
    let name = colour.name
    if (Object.hasOwn(gasColours,name)) { name = unique('ds.' + name,occupied); occupied[name] = true; report.notes.push(colour.name + ': renamed to ' + name + '; shared gas colour retained') }
    else if (ROLES.includes(name) && c.roles[name] !== name) { name = unique('ds.' + name,occupied); occupied[name] = true; report.notes.push(colour.name + ': renamed to ' + name + '; original token retained beside the mapped role') }
    names.set(colour.name,name); t.colors[name] = value; stamp('colors.' + name,value,{ token: colour.name })
  }
  for (const role of ROLES) {
    const chosen = c.roles[role]
    if (!chosen) continue
    const name = names.get(chosen)
    if (!name) { report.dropped.push('colors.' + role + ': missing chosen token ' + chosen); continue }
    t.colors[role] = t.colors[name]; stamp('colors.' + role,t.colors[role],{ token: chosen })
  }
  const vars = dsVariables(ds,themeId), rawRules: CssRule[] = []
  for (const [path,bytes] of ds.files) if (path.endsWith('.css') && !path.startsWith('tokens/')) for (const rule of cssOf(bytes).rules) rawRules.push(rule)
  const selectedRules = rawRules.flatMap(rule => rule.selectors.map(selector => ({ rule,selector })))
  const usedRules = new Set<string>()
  const cascade = (selector: string, inherit = false): Map<string,Declaration> => {
    const selected = selectorOf(selector), candidates = selectedRules.filter(r => !r.rule.at && (applies(r.selector,selected) || inherit && ['body',':root'].includes(r.selector.text)))
    const declarations = candidates.flatMap(({ rule,selector },order) => rule.decls.map(decl => ({ decl,selector,order })))
    const rank = (s: Selector) => [s.parts.filter(p => p.kind === 'id').length,
      s.parts.filter(p => ['class','attribute','pseudo-class'].includes(p.kind)).length, s.parts.filter(p => ['type','pseudo-element'].includes(p.kind)).length]
    declarations.sort((a,b) => Number(applies(a.selector,selected))-Number(applies(b.selector,selected)) || Number(a.decl.important)-Number(b.decl.important) || rank(a.selector).map((n,i) => n-rank(b.selector)[i]).find(n => n !== 0) || a.order-b.order)
    const locals = new Map<string,string>()
    for (const { decl } of declarations) if (decl.prop.startsWith('--')) locals.set(decl.prop,decl.value)
    const out = new Map<string,Declaration>()
    for (const { decl,selector: origin } of declarations) {
      if (!applies(origin,selected) && !inherited.has(decl.prop)) continue
      const parsed = resolveVars(decl.value,name => locals.get(name) ?? vars(name))
      report.notes.push(...parsed.notes.map(note => origin.text + ' ' + decl.prop + ': ' + note))
      if (parsed.value === undefined) continue
      const item = { value: parsed.value, raw: decl.value, rule: origin.text }; out.delete(decl.prop); out.set(decl.prop,item); usedRules.add(origin.text)
      if (decl.prop === 'font') {
        const font = readFont(parsed.value)
        if (font) for (const [prop,value] of [['font-family',font.families.join(', ')], ['font-size',font.size + 'px'], ['font-weight',String(font.weight)], ['font-style',font.italic ? 'italic' : 'normal']]) out.set(prop,{ ...item,value })
      }
    }
    return out
  }
  const colourOf = (value: string, raw?: string, rule = ''): string => {
    const parsed = cssColour(value), rgba = parsed.rgba!
    if (parsed.outOfGamut) report.notes.push(rule + ': outside sRGB, clipped ' + value)
    const ref = /^var\(--([^,)]+)\)$/.exec(raw?.trim() ?? ''), preferred = ref && names.get(ref[1])
    if (preferred && t.colors[preferred] === rgba) return preferred
    const found = ds.colours.map(c => names.get(c.name)).find(name => name && t.colors[name] === rgba)
    if (found) return found
    const existing = Object.keys(t.colors).find(name => name.startsWith('lit-') && t.colors[name] === rgba)
    if (existing) return existing
    const name = unique('lit-' + rgba.slice(1).toLowerCase(),t.colors)
    t.colors[name] = rgba; stamp('colors.' + name,rgba,{ rule }); return name
  }
  for (const shadow of ds.shadows) if (Object.hasOwn(shadow.layers,themeId)) {
    t.shadows[shadow.name] = shadow.layers[themeId].map(s => [s.dx,s.dy,s.blur,s.spread,s.colourToken && names.get(s.colourToken) || s.colour,...s.inset ? ['inset' as const] : []] as ShadowSpec)
    stamp('shadows.' + shadow.name,t.shadows[shadow.name],{ token: shadow.name })
  }
  const shadowOf = (decl: Declaration, key: string, text = false): string | undefined => {
    if (decl.value === 'none') return
    const layers = readShadow(decl.raw,name => vars(name)) ?? readShadow(decl.value)
    if (!layers || text && layers.some(s => s.inset || s.spread !== 0)) { report.cannotDraw.push(decl.rule + ' ' + key + ': unreadable or unsupported shadow'); return }
    const ref = /^var\(--([^,)]+)\)$/.exec(decl.raw)
    if (ref && Object.hasOwn(t.shadows,ref[1])) return ref[1]
    const spec = layers.map(s => [s.dx,s.dy,s.blur,s.spread,s.colourToken && names.get(s.colourToken) || s.colour,...s.inset ? ['inset' as const] : []] as ShadowSpec)
    const same = Object.keys(t.shadows).find(name => JSON.stringify(t.shadows[name]) === JSON.stringify(spec))
    if (same) return same
    const name = unique('css-' + key.replace(/[^\w-]/g,'-'),t.shadows)
    t.shadows[name] = spec; stamp('shadows.' + name,spec,{ rule: decl.rule }); return name
  }
  const sizedStyles = new Set<keyof Theme['type']>()
  for (const style of STYLES) {
    const chosen = c.styles[style], authored = ds.styles.find(s => s.name === chosen), target = t.type[style]
    const set = (key: keyof typeof target, value: string | number | boolean, source: Source) => { Object.assign(target,{ [key]: value }); stamp('type.' + style + '.' + key,value,source) }
    if (authored) {
      set('font',faceName(authored.families[0],authored.weight,authored.italic),{ token: authored.name })
      set('size',Math.fround(authored.size),{ token: authored.name }); set('cspace',Math.fround((authored.letterSpacing ?? 0)/authored.size*100),{ token: authored.name }); delete target.weight
      sizedStyles.add(style)
    } else if (chosen) report.dropped.push('type.' + style + ': missing chosen style ' + chosen)
    const selector = c.styleRules[style]
    if (!selector) continue
    const css = cascade(selector,true)
    const font = css.get('font-family'), weight = css.get('font-weight'), italic = css.get('font-style'), size = css.get('font-size')
    if (font) {
      const families = familiesOf(font.value), w = readWeight(weight?.value)?.[0] ?? authored?.weight ?? 400
      if (families.length) set('font',faceName(families[0],w,italic ? italic.value !== 'normal' : authored?.italic ?? false),{ rule: font.rule })
    }
    if (size && readLength(size.value)?.px !== undefined) { set('size',Math.fround(readLength(size.value)!.px!),{ rule: size.rule }); sizedStyles.add(style) }
    const spacing = css.get('letter-spacing'), ink = css.get('color'), upper = css.get('text-transform'), shadow = css.get('text-shadow')
    if (spacing) {
      const px = spacing.value === 'normal' ? 0 : readLength(spacing.value)?.px
      if (px !== undefined) set('cspace',Math.fround(px/target.size*100),{ rule: spacing.rule })
    }
    if (ink && cssColour(ink.value).rgba) set('ink',colourOf(ink.value,ink.raw,ink.rule),{ rule: ink.rule })
    if (upper) set('upper',upper.value === 'uppercase',{ rule: upper.rule })
    if (shadow) {
      const name = shadowOf(shadow,'text-' + style,true)
      if (name) set('shadow',name,{ rule: shadow.rule }); else if (shadow.value === 'none') delete target.shadow
    }
  }
  for (const style of ds.styles) if (!Object.values(c.styles).includes(style.name)) report.dropped.push('type.' + style.name + ': unmatched style')
  if (ds.styles.some(s => s.lineHeight !== undefined) || rawRules.some(r => r.decls.some(d => d.prop === 'line-height' || d.prop === 'font' && d.value.includes('/')))) report.cannotDraw.push('line-height: builder labels use 1.4 times their type size')
  for (const [path,chosen] of Object.entries(c.geo)) {
    if (!chosen) continue
    const [family,key] = path.split('.'), token = ds.lengths.find(l => l.name === chosen)
    const section = t.geo[family as keyof Theme['geo']]
    if (!section || typeof section !== 'object' || !Object.hasOwn(section,key) || token?.px === undefined) { report.dropped.push('geo.' + path + ': missing or non-pixel token ' + chosen); continue }
    Object.assign(section,{ [key]: Math.fround(token.px) }); stamp('geo.' + path,token.px,{ token: chosen })
  }
  if (sizedStyles.size) { t.geo.floor = Math.min(...[...sizedStyles].map(style => t.type[style].size)); stamp('geo.floor',t.geo.floor,{ derived: 'smallest mapped type size' }) }
  const looks = record<Look>(), partRules = new Map<PartName,Map<string,Declaration>>()
  const paintPart = (css: Map<string,Declaration>, key: string, defaults: PaintPart = {}): PaintPart => {
    const out = { ...defaults }, put = (field: keyof PaintPart, value: Paint | number | string, decl: Declaration) => {
      Object.assign(out,{ [field]: value })
      if (Object.hasOwn(t.parts,key)) stamp('parts.' + key + '.' + field,value,{ rule: decl.rule })
    }
    let bg = css.get('background')
    const bgColour = css.get('background-color'), order = [...css.keys()]
    if (bgColour && (!bg || !readBackground(bg.value)?.gradient && order.indexOf('background-color') > order.indexOf('background'))) bg = bgColour
    if (bg) {
      const parsed = readBackground(bg.value)
      if (bg.value === 'none' || parsed?.colour === '#00000000') put('fill','none',bg)
      else if (parsed?.colour) put('fill',colourOf(parsed.colour,bg.raw,bg.rule),bg)
      else if (parsed?.gradient) {
        const gradient = parsed.gradient, raw = /^linear-gradient\((.*)\)$/i.exec(bg.raw), args = raw ? splitCss(raw[1]) : []
        if (args.length > gradient.stops.length) args.shift()
        const colors = gradient.stops.map((s,i) => colourOf(s.colour,args[i],bg.rule))
        if (gradient.stops.length === 2 && ['to bottom','180deg'].includes(gradient.direction) && (gradient.stops[0].position === undefined || gradient.stops[0].position === 0) && (gradient.stops[1].position === undefined || gradient.stops[1].position === 100)) {
          const name = unique('css-' + key.replace(/[^\w-]/g,'-'),t.gradients); t.gradients[name] = [colors[0],colors[1]]
          stamp('gradients.' + name,t.gradients[name],{ rule: bg.rule }); put('fill',{ gradient: name },bg)
        } else { report.cannotDraw.push(bg.rule + ' background: gradient direction, stops or positions are not represented; using its first stop'); put('fill',colors[0],bg) }
      } else report.cannotDraw.push(bg.rule + ' background: images or unreadable paint are not represented')
    }
    for (const prop of ['border','outline']) {
      const decl = css.get(prop); if (!decl) continue
      const border = readBorder(decl.value)
      if (!border || !['solid','none','hidden'].includes(border.style)) { report.cannotDraw.push(decl.rule + ' ' + prop + ': only solid borders are represented'); continue }
      if (border.width && !border.colour) { report.cannotDraw.push(decl.rule + ' ' + prop + ': implicit currentcolor is not represented; keeping the base paint'); continue }
      put('stroke',border.colour && border.width ? colourOf(border.colour,splitCss(decl.raw,' ').at(-1),decl.rule) : 'none',decl)
      put('width',Math.fround(border.width),decl); put('outline',prop === 'border' ? 'inside' : 'outside',decl)
    }
    const radius = css.get('border-radius'), radii = radius && readRadii(radius.value).radii
    if (radius && radii && radii.every(n => typeof n === 'number' && n === radii[0])) put('radius',Math.fround(radii[0] as number),radius)
    const shadow = css.get('box-shadow')
    if (shadow) {
      const layers = readShadow(shadow.value), ring = layers?.length === 1 ? layers[0] : undefined
      if (ring && !ring.inset && ring.dx === 0 && ring.dy === 0 && ring.blur === 0 && ring.spread > 0) {
        put('stroke',colourOf(ring.colour,undefined,shadow.rule),shadow); put('width',Math.fround(ring.spread),shadow); put('outline','outside',shadow)
      } else {
        const name = shadowOf(shadow,key)
        if (name) put('shadow',name,shadow); else if (shadow.value === 'none') delete out.shadow
      }
    }
    const ink = css.get('color')
    if (ink && cssColour(ink.value).rgba) put('ink',colourOf(ink.value,ink.raw,ink.rule),ink)
    return out
  }
  for (const part of Object.keys(t.parts) as PartName[]) {
    const selector = c.parts[part]; if (!selector) continue
    const css = cascade(selector), values = new Map([...css].map(([k,v]) => [k,v.value])); partRules.set(part,css)
    t.parts[part] = paintPart(css,part,t.parts[part])
    if (part === 'focus') { t.parts[part].fill = 'none'; stamp('parts.focus.fill','none',{ base: base.name }) }
    if (base.parts[part].fill === 'state') {
      const variant = (status: string) => selector.includes(' > ') ? selector.replace(' > ','.' + status + ' > ') : selector + '.' + status
      const background = readBackground(css.get('background')?.value ?? '')?.colour
      if (['idle','ok'].some(status => background === cssColour(t.colors['status-' + status]).rgba)
        && ['warn','crit'].every(status => selectedRules.some(r => !r.rule.at && r.selector.text === variant(status)) && readBackground(cascade(variant(status)).get('background')?.value ?? '')?.colour === cssColour(t.colors['status-' + status]).rgba)) {
        t.parts[part].fill = 'state'; stamp('parts.' + part + '.fill','state',{ derived: selector + ' status variants' })
      }
    }
    const hook = part.startsWith('switch.') ? 'switch' : part
    const decor = decorate(hook,selector,values,value => colourOf(value,undefined,selector),t.parts[part])
    report.cannotDraw.push(...decor.cannotDraw)
    if (Object.keys(decor.look).length) { looks[hook] = decor.look; stamp('anatomy.looks.' + hook,decor.look,{ rule: selector }) }
    for (const candidate of selectedRules) {
      if (candidate.rule.at) continue
      const child = candidate.selector.text, pseudo = candidate.selector.parts.some(p => p.kind === 'pseudo-element')
      if (!(pseudo && applies(selectorOf(child.replace(/::(?:before|after)$/,'')),selectorOf(selector)) || child.startsWith(selector + ' '))) continue
      const decls = cascade(child), childValues = new Map([...decls].map(([k,v]) => [k,v.value]))
      if (!pseudo && childValues.get('position') !== 'absolute') continue
      const decoration = decorate(hook,child,childValues,value => colourOf(value,undefined,child),paintPart(decls,part + '-decoration'),true)
      report.cannotDraw.push(...decoration.cannotDraw)
      if (decoration.look.add?.length) {
        const look = looks[hook] ??= {}, existing = new Set(look.add?.map(o => o.name))
        const additions = decoration.look.add.filter(o => !existing.has(o.name)), offset = look.add?.length ?? 0
        look.add = [...look.add ?? [],...additions]
        additions.forEach((ornament,i) => stamp('anatomy.looks.' + hook + '.add.' + (offset+i),ornament,{ rule: child }))
      }
    }
  }
  for (const [key,part] of [['hair','panel'],['strong','button.primary'],['header','header'],['primary','button.primary'],['focus','focus']] as const) {
    if (partRules.has(part) && t.parts[part].width !== undefined) { t.geo.edge[key] = t.parts[part].width!; stamp('geo.edge.' + key,t.geo.edge[key],{ rule: c.parts[part]! }) }
  }
  const chip = partRules.get('chip')?.get('width')
  if (chip && readLength(chip.value)?.px !== undefined) { t.geo.chip.w = Math.fround(readLength(chip.value)!.px!); stamp('geo.chip.w',t.geo.chip.w,{ rule: chip.rule }) }
  const chipH = partRules.get('chip')?.get('height')
  if (chipH && readLength(chipH.value)?.px !== undefined) { t.geo.chip.h = Math.fround(readLength(chipH.value)!.px!); stamp('geo.chip.h',t.geo.chip.h,{ rule: chipH.rule }) }
  const unitSelector = c.styleRules.hero && selectedRules.find(r => !r.rule.at && r.selector.text.startsWith(c.styleRules.hero! + ' ') && r.selector.parts.at(-1)?.kind === 'type' && ['small','unit'].includes(r.selector.parts.at(-1)!.value) && r.rule.decls.some(d => ['font','font-size'].includes(d.prop)))?.selector.text
  const unit = unitSelector && cascade(unitSelector,true).get('font-size')
  if (unit && readLength(unit.value)?.px !== undefined) { t.geo.heroUnit = Math.fround(readLength(unit.value)!.px!); stamp('geo.heroUnit',t.geo.heroUnit,{ rule: unit.rule }) }
  if (Object.keys(looks).length) t.anatomy = { v: 1, looks }
  if (c.widgetDefaults !== undefined) { t.widgetDefaults = c.widgetDefaults; stamp('widgetDefaults',c.widgetDefaults,{ player: true }) }
  t.metrics = metricsFor(t.type,t.geo,linesOf); stamp('metrics',t.metrics,{ derived: 'type and geometry rules' })
  for (const { rule,selector } of selectedRules) {
    if (rule.at) report.cannotDraw.push(rule.at + ': conditional styles are kept as information, not applied')
    for (const decl of rule.decls) {
      if (decl.prop === 'font-variant-numeric') report.cannotDraw.push('font-variant-numeric: tabular figures are not represented')
      else if (/^(animation|transition)(-|$)/.test(decl.prop)) report.cannotDraw.push(decl.prop.split('-')[0] + ': animation is not represented')
      else if (['background-image','border-image','filter','backdrop-filter'].includes(decl.prop)) report.cannotDraw.push(selector.text + ' ' + decl.prop + ': not represented')
      else if (/^(?:border(?:-(?:top|right|bottom|left))?|outline)-(?:color|width|style)$/.test(decl.prop)) report.cannotDraw.push(selector.text + ' ' + decl.prop + ': not represented; keeping the shorthand or base paint')
    }
    if (selector.parts.some(p => p.kind === 'pseudo-element') && !usedRules.has(selector.text)) report.cannotDraw.push(selector.text + ': unmatched component decoration')
  }
  for (const note of ds.notes) if (/@keyframes|video|animation/.test(note)) report.cannotDraw.push(note)
  for (const component of ds.components) if (!Object.entries(c.parts).some(([part,selector]) => selector && part.split('.')[0].toLowerCase() === component.name.toLowerCase())) report.dropped.push(component.name + ': unmatched component; prose and code were not interpreted')
  const clean = sanitizeTheme(themeFileOf(t),base,{ taken }), theme = clean.theme!
  report.notes.push(...clean.notes); report.dropped.push(...clean.notes.filter(n => /dropped|invalid|not allowed|unknown hook/.test(n)))
  const basePaths = clean.notes.filter(n => n.includes('filled from ' + base.name)).map(n => n.slice(0,n.indexOf(':')).replace(/^theme\./,''))
  const mod = new Set(fontCatalogue.faces.filter(f => f.fontsMod).map(f => f.name))
  for (const face of new Set(Object.values(theme.type).map(s => s.font).filter(Boolean))) {
    const supplied = ds.fonts.find(f => {
      if (!f.path || !ds.files.has(f.path)) return false
      const weights = [f.weight[0],f.weight[1],...Array.from({ length: 9 },(_,i) => (i+1)*100).filter(w => w >= f.weight[0] && w <= f.weight[1])]
      return weights.some(w => face === faceName(f.family,w,f.style !== 'normal'))
    })
    report.fonts.push(mod.has(face) ? { face,supplied: 'mod' } : localFonts.has(face) ? { face,supplied: 'local' } : supplied ? { face,supplied: 'file',file: supplied.path } : { face,supplied: 'none' })
  }
  stamp('id',theme.id,{ derived: 'theme name and existing ids' })
  const stack = [{ value: theme as unknown, path: '' }]
  while (stack.length) {
    const { value,path } = stack.pop()!
    if (value && typeof value === 'object') for (const [key,v] of Object.entries(value)) stack.push({ value: v,path: path ? path + '.' + key : key })
    else if (basePaths.some(prefix => path === prefix || path.startsWith(prefix + '.'))) report.sources[path] = { base: base.name }
    else if (!Object.hasOwn(report.sources,path)) report.sources[path] = Object.hasOwn(gasColours,path.slice('colors.'.length)) ? { derived: 'shared game gas colours' } : { base: base.name }
  }
  report.dropped = [...new Set(report.dropped)]; report.cannotDraw = [...new Set(report.cannotDraw)]; report.notes = [...new Set(report.notes)]
  return { theme, file: themeFileOf(theme), report }
}
