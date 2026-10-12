// A theme (spec §5.2): colours by role, and the gradients, type styles, geometry and shadows the widgets draw with.
import type { Json } from '../widgets/types'

/** [dx, dy, blur, spread, colour] or with 'inset' last; the colour is a role or a #hex literal. */
export type ShadowSpec = [number, number, number, number, string] | [number, number, number, number, string, 'inset']
/** A text style: the face (a Fonts-mod name, D13), size in design units, cspace in 0.01 em, uppercase literals, ink role, shadow name. */
export type TypeStyle = { font: string; size: number; cspace: number; upper: boolean; ink: string; shadow?: string; weight?: 'bold' }
export type StyleName = 'hero' | 'screen-title' | 'clock' | 'panel-title' | 'button-label' | 'chip-label' | 'value-lg' | 'value'
  | 'reading' | 'message' | 'unit'
/** Design units, never scaled by the console (spec 5.2). */
export interface Geo {
  space: Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>
  radius: { xs: number; sm: number; md: number; lg: number; xl: number }
  edge: { hair: number; strong: number; header: number; primary: number; focus: number }
  size: { header: number; light: number; bar: number; row: number; control: number }
  floor: number
  chip: { w: number; h: number }
  heroUnit: number
}
export interface Theme {
  id: string; name: string; colors: Record<string, string>
  gradients: Record<string, [string, string]>   // name -> [top role, bottom role]; widgets fill with @theme_<name>
  type: Record<StyleName, TypeStyle>
  geo: Geo
  shadows: Record<string, ShadowSpec[]>
  parts: Record<PartName, PaintPart>
  stateWords: readonly [string, string, string]
  pressed: number
  drawText: StyleName
  metrics: Record<MetricName, number>
  anatomy?: Anatomy
  widgetDefaults?: Readonly<Record<string, Readonly<Record<string, Json>>>>
}
export type Edge = readonly [at: number, by: number]
export type Point = readonly [x: Edge, y: Edge]
export type Frame = { l: Edge; t: Edge; r: Edge; b: Edge }
export type Corners = readonly [tl: number, tr: number, br: number, bl: number]
export type BoxShape = { op: 'rect'; frame?: Frame; radius?: number | Corners }
  | { op: 'ellipse'; frame?: Frame } | { op: 'cut'; frame?: Frame; cut: Corners }
export type Shape = BoxShape | { op: 'poly'; p: readonly Point[] } | { op: 'line'; p: readonly Point[] }
export type Ornament = Shape & { name: string; fill?: Paint; stroke?: Paint; width?: number
  outline?: 'inside' | 'centre' | 'outside'; shadow?: string; dash?: readonly number[]
  cap?: 'butt' | 'round' | 'square'; under?: true }
export type Look = { shape?: BoxShape | 'none'; add?: readonly Ornament[] }
export type Anatomy = { v: 1; looks: Readonly<Record<string, Look>> }
export type MetricName = 'panel.titleY' | 'panel.unitW' | 'header.clockW' | 'header.countW' | 'header.countH' | 'header.inset'
  | 'icon.size'
  | 'hero.figureH' | 'hero.barY' | 'hero.fillH' | 'hero.statusY' | 'hero.unitY' | 'hero.unitGap'
  | 'kpi.unitW' | 'kpi.unitY' | 'kpi.meterGap' | 'kpi.meterH' | 'compact.statusW'
  | 'row.valueW1' | 'row.valueW2' | 'table.valueW' | 'list.pitch' | 'eventlog.timeW' | 'repeater.valueW'
  | 'bar.inset' | 'bar.markInset' | 'stepper.valueW' | 'switch.w' | 'switch.h' | 'switch.inset' | 'toggle.stateW'
  | 'alert.messageH' | 'devices.pad' | 'devices.gap' | 'devices.pitch' | 'devices.labelW'
/** A colour role, theme gradient, widget state colour, or no paint. */
export type Paint = string | { gradient: string } | 'state' | 'none'
export type PartName = 'panel' | 'row' | 'track' | 'fill' | 'meter' | 'mark' | 'target'
  | 'button.primary' | 'button.secondary' | 'button.danger' | 'focus' | 'header' | 'chip'
  | 'light.idle' | 'light.ok' | 'light.warn' | 'light.crit' | 'switch.off' | 'switch.on' | 'knob'
  | 'field' | 'field.text' | 'field.placeholder' | 'shape' | 'line' | 'duct.track' | 'duct.flow'
  | 'gauge.track' | 'gauge.tick' | 'gauge.needle' | 'gauge.hub'
/** Paint only: outline places the stroke against the box; ink paints its label. */
export interface PaintPart {
  fill?: Paint; stroke?: Paint; width?: number; radius?: number
  outline?: 'inside' | 'centre' | 'outside'; shadow?: string; ink?: string
}
