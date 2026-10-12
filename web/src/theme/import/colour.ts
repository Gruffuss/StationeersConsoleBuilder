import { finite, splitCss, type Rgba } from './types'

// Matrices and transfer curves: https://www.w3.org/TR/css-color-4/#color-conversion-code
const mul = (m: number[][], v: number[]) => m.map(row => row.reduce((s, x, i) => s + x * v[i], 0))
const gamma = (x: number) => Math.abs(x) <= .0031308 ? 12.92 * x : Math.sign(x) * (1.055 * Math.abs(x) ** (1 / 2.4) - .055)
const linear = (x: number) => Math.abs(x) <= .04045 ? x / 12.92 : Math.sign(x) * ((Math.abs(x) + .055) / 1.055) ** 2.4
const xyzRgb = [[12831/3959, -329/214, -1974/3959], [-851781/878810, 1648619/878810, 36519/878810], [705/12673, -2585/12673, 705/667]]
const d50d65 = [[.955473421488075, -.02309845494876471, .06325924320057072], [-.0283697093338637, 1.0099953980813041, .021041441191917323], [.012314014864481998, -.020507649298898964, 1.330365926242124]]
const rgbXyz: Record<string, number[][]> = {
  'display-p3': [[608311/1250200,189793/714400,198249/1000160], [35783/156275,247089/357200,198249/2500400], [0,32229/714400,5220557/5000800]],
  'a98-rgb': [[573536/994567,263643/1420810,187206/994567], [591459/1989134,6239551/9945670,374412/4972835], [53769/1989134,351524/4972835,4929758/4972835]],
  'prophoto-rgb': [[.7977666449006423,.13518129740053308,.0313477341283922], [.2880748288194013,.711835234241873,.00008993693872564], [0,0,.8251046025104602]],
  rec2020: [[63426534/99577255,20160776/139408157,47086771/278816314], [26158966/99577255,472592308/697040785,8267143/139408157], [0,19567812/697040785,295819943/278816314]],
}
const keywords = `aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32`
const named: Record<string, string> = Object.create(null)
for (const entry of keywords.split(' ')) { const [name, hex] = entry.split(':'); named[name] = '#' + hex + 'ff' }
named.transparent = '#00000000'

const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(%|deg|grad|rad|turn)?$/i
function num(text: string, scale = 1): number | undefined {
  const match = numeric.exec(text)
  if (!match || match[1] && match[1] !== '%') return undefined
  const n = match[1] === '%' ? Number.parseFloat(text) * scale / 100 : Number.parseFloat(text)
  return finite(n) ? n : undefined
}
export function angle(text: string): number | undefined {
  const m = numeric.exec(text)
  if (!m || m[1] === '%') return undefined
  const unit = m[1]?.toLowerCase()
  const n = Number.parseFloat(text) * (unit === 'turn' ? 360 : unit === 'rad' ? 180 / Math.PI : unit === 'grad' ? .9 : 1)
  return finite(n) ? n : undefined
}
const clamp = (n: number) => Math.max(0, Math.min(1, n))
function result(rgb: number[], alpha: number): { rgba?: Rgba; outOfGamut?: true } {
  if (![...rgb, alpha].every(finite)) return {}
  const outOfGamut = rgb.some(n => n < -1e-6 || n > 1 + 1e-6)
  const rgba = '#' + [...rgb, alpha].map(n => Math.floor(clamp(n) * 255 + .5).toString(16).padStart(2, '0')).join('').toUpperCase()
  return outOfGamut ? { rgba, outOfGamut: true } : { rgba }
}

export function cssColour(text: string, vars?: (name: string) => string | undefined): { rgba?: Rgba; outOfGamut?: true } {
  text = text.trim()
  const seen = new Set<string>()
  while (/^var\(/i.test(text)) {
    if (!text.endsWith(')')) return {}
    const [name, ...fallback] = splitCss(text.slice(4, -1))
    if (!/^--[\w-]+$/.test(name) || seen.has(name)) return {}
    seen.add(name); const value = vars?.(name) ?? (fallback.length ? fallback.join(',') : undefined)
    if (value === undefined) return {}
    text = value.trim()
  }
  const lower = text.toLowerCase()
  if (Object.hasOwn(named, lower)) return { rgba: named[lower].toUpperCase() }
  if (/^#[\da-f]+$/i.test(text)) {
    let hex = text.slice(1)
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('')
    if (hex.length === 6) hex += 'ff'
    return hex.length === 8 ? { rgba: '#' + hex.toUpperCase() } : {}
  }
  const match = /^([a-z]+)\(([^()]*)\)$/i.exec(text)
  if (!match) return {}
  const fn = match[1].toLowerCase(), body = match[2].trim(), comma = body.includes(',')
  const slash = body.split('/')
  if (slash.length > 2 || comma && slash.length > 1) return {}
  let args = comma ? body.split(',').map(s => s.trim()) : slash[0].trim().split(/\s+/)
  let alpha = 1
  if (comma && args.length === 4) { const a = num(args.pop()!, 1); if (a === undefined) return {}; alpha = a }
  else if (slash.length === 2) { const a = num(slash[1].trim(), 1); if (a === undefined) return {}; alpha = a }
  let space = ''
  if (fn === 'color') { if (comma) return {}; space = args.shift()!.toLowerCase() }
  if (args.length !== 3 || comma && !['rgb', 'rgba', 'hsl', 'hsla'].includes(fn)) return {}
  let rgb: number[]
  if (fn === 'rgb' || fn === 'rgba') {
    if (comma && args.some(a => a.endsWith('%')) && !args.every(a => a.endsWith('%'))) return {}
    const values = args.map(a => num(a, 255)); if (values.some(v => v === undefined)) return {}
    rgb = values.map(n => clamp(n! / 255))
  } else if (fn === 'hsl' || fn === 'hsla') {
    const h = angle(args[0]), s = num(args[1], 100), l = num(args[2], 100)
    if (h === undefined || s === undefined || l === undefined || comma && (!args[1].endsWith('%') || !args[2].endsWith('%'))) return {}
    const hue = ((h % 360) + 360) % 360 / 30, sat = Math.max(0,s/100), light = clamp(l/100), a = sat * Math.min(light, 1-light)
    rgb = [0,8,4].map(n => { const k = (n+hue)%12; return light - a * Math.max(-1, Math.min(k-3,9-k,1)) })
  } else if (['oklab', 'oklch', 'lab', 'lch'].includes(fn)) {
    const ok = fn.startsWith('ok'), polar = fn.endsWith('lch')
    const l = num(args[0], ok ? 1 : 100), a = num(args[1], polar ? ok ? .4 : 150 : ok ? .4 : 125), b = polar ? angle(args[2]) : num(args[2], ok ? .4 : 125)
    if (l === undefined || a === undefined || b === undefined) return {}
    const v = [Math.max(0, Math.min(ok ? 1 : 100,l)), polar ? Math.max(0,a) * Math.cos(b*Math.PI/180) : a, polar ? Math.max(0,a) * Math.sin(b*Math.PI/180) : b]
    if (ok) {
      const lms = mul([[1,.3963377773761749,.2158037573099136], [1,-.1055613458156586,-.0638541728258133], [1,-.0894841775298119,-1.2914855480194092]], v).map(n => n ** 3)
      rgb = mul([[4.076741661347994,-3.3077115913,.230969929981], [-1.2684380046,2.6097574011,-.3413193965], [-.0041960863,-.7034186147,1.707614701]],lms).map(gamma)
    } else {
      const f1 = (v[0]+16)/116, f = [f1 + v[1]/500, f1, f1 - v[2]/200]
      const xyz = f.map((n,i) => (n ** 3 > 216/24389 ? n ** 3 : (116*n-16)/(24389/27)) * [.9642956764295677,1,.8251046025104602][i])
      rgb = mul(xyzRgb,mul(d50d65,xyz)).map(gamma)
    }
  } else if (fn === 'color') {
    const v = args.map(a => num(a,1)); if (v.some(n => n === undefined)) return {}
    const values = v as number[]
    if (space === 'srgb') rgb = values
    else if (space === 'srgb-linear') rgb = values.map(gamma)
    else if (['xyz','xyz-d65','xyz-d50'].includes(space)) rgb = mul(xyzRgb, space === 'xyz-d50' ? mul(d50d65,values) : values).map(gamma)
    else if (Object.hasOwn(rgbXyz,space)) {
      const linearValues = values.map(n => space === 'a98-rgb' ? Math.sign(n)*Math.abs(n)**(563/256) : space === 'prophoto-rgb' ? Math.abs(n)<=16/512 ? n/16 : Math.sign(n)*Math.abs(n)**1.8 : space === 'rec2020' ? Math.abs(n)<.08124285829863151 ? n/4.5 : Math.sign(n)*((Math.abs(n)+.09929682680944)/1.09929682680944)**(1/.45) : linear(n))
      let xyz = mul(rgbXyz[space],linearValues)
      if (space === 'prophoto-rgb') xyz = mul(d50d65,xyz)
      rgb = mul(xyzRgb,xyz).map(gamma)
    } else return {}
  } else return {}
  return result(rgb, alpha)
}
