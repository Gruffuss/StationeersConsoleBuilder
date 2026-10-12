import { HOOKS } from '../widgets/anatomy'
import { NO_CTX, sanitize } from '../widgets/core'
import { WIDGETS } from '../widgets/registry'
import type { Params } from '../widgets/types'
import { themeFileOf } from './file'
import { ROLES, STYLES, THEMES } from './index'

const uses: Record<string, string> = {
  'surface-screen-hi': 'Top of the page background.', 'surface-screen': 'Middle of the page background.',
  'surface-screen-lo': 'Bottom of the page background.', 'surface-panel': 'Panel and plain-shape backgrounds.',
  'surface-row-hi': 'Top of raised rows.', 'surface-row': 'Flat raised rows.', 'surface-row-lo': 'Bottom of raised rows.',
  'surface-well': 'Sunken tracks and fields.', border: 'Thin outlines.', 'border-strong': 'Strong outlines and marks.',
  text: 'Primary text.', 'text-secondary': 'Secondary readings.', 'text-muted': 'Titles, units and subdued text.',
  accent: 'Focus rings and needles.', 'brand-hi': 'Top of primary buttons.', brand: 'Primary buttons and header.',
  'brand-lo': 'Bottom of primary buttons.', 'on-brand': 'Text on the brand paint.',
  'status-ok': 'OK state.', 'status-warn': 'Warning state.', 'status-crit': 'Critical state.', 'status-idle': 'Idle state.',
  'on-status': 'Text on state chips.', danger: 'Danger buttons.', 'danger-lo': 'Bottom of danger buttons.', 'on-danger': 'Text on danger buttons.',
}

export function themePrompt(): string {
  const t = THEMES.neutral, parts = new Map(Object.keys(t.parts).map(k => [k, new Set<string>()]))
  // Observe the modules' part reads, including their enum/flag variants, so the prompt follows their own drawing rules.
  for (const m of Object.values(WIDGETS)) {
    const theme = { ...t, parts: new Proxy(t.parts, { get(target, key, receiver) {
      if (typeof key === 'string') parts.get(key)?.add(m.type)
      return Reflect.get(target, key, receiver)
    } }) }
    const d = m.defaults(theme, NO_CTX), candidates: Params[] = [d]
    for (const p of m.params) {
      if (p.type === 'enum') for (const value of p.enum) candidates.push({ ...d, [p.key]: value })
      if (p.type === 'flag') candidates.push({ ...d, [p.key]: true })
      if (p.type === 'numbers') candidates.push({ ...d, [p.key]: [0.5] })
      if (p.type === 'list' && Array.isArray(d[p.key]) && d[p.key].length) {
        for (const item of p.item) if (item.type === 'enum') for (const value of item.enum) {
          candidates.push({ ...d, [p.key]: [{ ...(d[p.key][0] as Params), [item.key]: value }] })
        }
      }
    }
    for (const p of candidates) m.expand(sanitize(m, p, theme), theme, m.prefix + '1')
  }
  const geo = Object.entries(t.geo).flatMap(([key, value]) => typeof value === 'number' ? ['geo.' + key]
    : Object.keys(value).map(child => `geo.${key}.${child}`))
  const defaults = Object.values(WIDGETS).map(m => `${m.type}: ${Object.keys(m.defaults(t, NO_CTX)).filter(k => k !== 'x' && k !== 'y').join(', ')}`)
  const example = themeFileOf(t); example.theme.name = 'Example (chosen colour theme)'
  return [
    'Read the design system at the link or in the files I supply and return a complete theme file. Answer with the theme file JSON alone.',
    'Say in theme.name which colour theme you used. Map only values the design system supplies; use the example for missing values.',
    'Shape: { "format": "vectorbuilder-theme", "v": 1, "theme": { "name": string, "colors": record, "gradients": record, "shadows": record, "type": record, "geo": record, "parts": record, "metrics": record, "stateWords": [string,string,string], "pressed": number, "drawText": style, "anatomy"?: object, "widgetDefaults"?: record } }.',
    'Colours: token names use letters, digits, _, . and - (1–64 characters, first a letter or digit). Values are #rrggbb or #rrggbbaa. Shared gas.* colours cannot be replaced.',
    'Required colour roles:', ...ROLES.map(k => `${k}: ${uses[k]}`),
    'Type styles: ' + STYLES.join(', ') + '.',
    'Each style: font (any face name, empty for the game default), size > 0 (design units), cspace (hundredths of the type size: letter-spacing / size * 100; 1.5px at 36px gives 4.17), upper (boolean), ink (colour key), optional shadow (shadow key), optional weight="bold".',
    'Face names: regular upright is the bare family; weights 100–900 append Thin, ExtraLight, Light, Medium, SemiBold, Bold, ExtraBold or Black (400 appends nothing). Italic appends " Italic".',
    'Parts and the widgets that draw them:', ...[...parts].map(([k, widgets]) => `${k}: ${[...widgets].join(', ') || 'raw drawing tools'}`),
    'Each part: optional fill/stroke (colour key, {"gradient": key}, "state" or "none"), width/radius >= 0, outline (inside/centre/outside), shadow (shadow key), ink (colour key).',
    'Gradients: [topColourKey, bottomColourKey]. Shadows: lists of [dx,dy,blur,spread,colour] with optional sixth "inset"; blur >= 0, colour is a colour key or #hex.',
    'Geometry keys (numbers >= 0): ' + geo.join(', ') + '.',
    'Metric keys (numbers): ' + Object.keys(t.metrics).join(', ') + '. Missing metrics derive from type and geo, including the hero-unit font baseline.',
    'All lengths are in design units (use CSS px values directly): type size, part width/radius, shadow dx/dy/blur/spread, geometry, metrics, anatomy by/radius/cut/width/dash, and widget dimensions/gaps.',
    "Widget numeric units: gauge.start and gauge.end are angles in degrees; duct.period and duct.dash are lengths in design units; duct.speed is design units per second. Ratios, counts and indices are unitless; widget data values use the widget's displayed unit. bar.floor/critBelow/warnBelow/marks and duct.idle are unitless fractions in 0..1.",
    'All numbers must be finite and fit float32. stateWords has three strings without line breaks or control characters (a tab is allowed), pressed is a unitless factor in 0..1, drawText names a type style.',
    'Anatomy: {"v":1,"looks":{hook:{"shape"?:boxShape|"none","add"?:[ornament]}}}. Hooks: ' + [...HOOKS].map(([k, kind]) => `${k} (${kind})`).join(', ') + '.',
    'A <widget type>/<hook> key scopes a look to that widget. Native widgets take no anatomy.',
    'Every edge is [at, by]: origin + at * box size + by design units; at is a unitless fraction in 0..1. Frames have l,t,r,b edges. Points are [xEdge,yEdge].',
    'Box shapes: {op:"rect",frame?,radius?:number|[tl,tr,br,bl]}, {op:"ellipse",frame?}, {op:"cut",frame?,cut:[tl,tr,br,bl]}.',
    'Ornaments add name (lowercase letter, then lowercase letters/digits/hyphens), fill/stroke, width, outline, shadow, dash, cap (butt/round/square), under:true. Also {op:"poly"|"line",p:[point,...]}. Lines are stroke only. Filled polygons have at least three points and stay convex at every box size; fills cannot cross themselves. Point lists stay literal.',
    'No paths, text, pictures, clips, masks or rotation. A fill or meter shape is rect/ellipse only (its size follows the value); line, poly and cut ornaments draw only where the box has a fixed size. Labels keep their text, with ornaments under it; glyphs keep their glyph. A value-bearing fill, meter, target, knob, needle or value label is never removed.',
    'widgetDefaults is parameters only, never anatomy; omit x and y (placement belongs to the editor). Allowed widget parameters:', ...defaults,
    'Example theme file:', '```json', JSON.stringify(example, null, 2), '```',
  ].join('\n')
}
