// Page shapes (spec 5.4): each console face's preview size in px and its scene's design units, 480 per cell of the
// console's height (a vertical page's width), the other side keeping the px aspect.
// The MoreConsoles px are each prefab's canvas size (ModConsole.ScreenSize) rounded to whole px; ui:size() in game reports
// the fraction (the 2×1's 1035.69983). LargeConsoleMod's 2×2 and 3×3 read 460×460 in game. Spec 5.4 says which sizes
// were read in game and which from a prefab. Plain and Dual consoles share a surface; a vertical page is its console
// placed a quarter turn round, whose rect the mod swaps, monitors too.
type Shape = { label: string; px: { w: number; h: number }; units: { w: number; h: number }; beta?: true }
const TABLE = {
  square: { label: 'Square (1×1)', px: { w: 460, h: 460 }, units: { w: 480, h: 480 } },
  '2x1': { label: '2×1', px: { w: 1036, h: 460 }, units: { w: 1080, h: 480 } },
  monitor: { label: 'Monitor', px: { w: 943, h: 460 }, units: { w: 984, h: 480 } },
  v2x1: { label: 'Vertical 2×1', px: { w: 460, h: 1036 }, units: { w: 480, h: 1080 } },
  vmonitor: { label: 'Vertical Monitor', px: { w: 460, h: 943 }, units: { w: 480, h: 984 } },
  ac: { label: 'Air Conditioner face (beta)', px: { w: 319, h: 273 }, units: { w: 561, h: 480 }, beta: true },
  '2x2-lcm': { label: '2×2 (LargeConsoleMod)', px: { w: 460, h: 460 }, units: { w: 960, h: 960 } },
  '2x2': { label: '2×2 (MoreConsoles)', px: { w: 456, h: 460 }, units: { w: 952, h: 960 } },
  v2x2: { label: 'Vertical 2×2 (MoreConsoles)', px: { w: 460, h: 456 }, units: { w: 960, h: 952 } },
  '3x2': { label: '3×2 (MoreConsoles)', px: { w: 714, h: 460 }, units: { w: 1490, h: 960 } },
  v3x2: { label: 'Vertical 3×2 (MoreConsoles)', px: { w: 460, h: 714 }, units: { w: 960, h: 1490 } },
  '3x2-panel': { label: '3×2 Panel (MoreConsoles)', px: { w: 713, h: 460 }, units: { w: 1488, h: 960 } },
  'v3x2-panel': { label: 'Vertical 3×2 Panel (MoreConsoles)', px: { w: 460, h: 713 }, units: { w: 960, h: 1488 } },
  '3x2-rugged': { label: '3×2 Rugged (MoreConsoles)', px: { w: 720, h: 460 }, units: { w: 1503, h: 960 } },
  'v3x2-rugged': { label: 'Vertical 3×2 Rugged (MoreConsoles)', px: { w: 460, h: 720 }, units: { w: 960, h: 1503 } },
  '3x2-bulkhead': { label: '3×2 Bulkhead (MoreConsoles)', px: { w: 723, h: 460 }, units: { w: 1509, h: 960 } },
  'v3x2-bulkhead': { label: 'Vertical 3×2 Bulkhead (MoreConsoles)', px: { w: 460, h: 723 }, units: { w: 960, h: 1509 } },
  '3x3-lcm': { label: '3×3 (LargeConsoleMod)', px: { w: 460, h: 460 }, units: { w: 1440, h: 1440 } },
  '3x3': { label: '3×3 (MoreConsoles)', px: { w: 458, h: 460 }, units: { w: 1434, h: 1440 } },
  v3x3: { label: 'Vertical 3×3 (MoreConsoles)', px: { w: 460, h: 458 }, units: { w: 1440, h: 1434 } },
  'monitor-2x2-rugged': { label: 'Monitor 2×2 Rugged (MoreConsoles)', px: { w: 435, h: 460 }, units: { w: 908, h: 960 } },
  'vmonitor-2x2-rugged': { label: 'Vertical Monitor 2×2 Rugged (MoreConsoles)', px: { w: 460, h: 435 }, units: { w: 960, h: 908 } },
  'monitor-2x2-bulkhead': { label: 'Monitor 2×2 Bulkhead (MoreConsoles)', px: { w: 433, h: 460 }, units: { w: 904, h: 960 } },
  'vmonitor-2x2-bulkhead': { label: 'Vertical Monitor 2×2 Bulkhead (MoreConsoles)', px: { w: 460, h: 433 }, units: { w: 960, h: 904 } },
  'monitor-3x2': { label: 'Monitor 3×2 (MoreConsoles)', px: { w: 684, h: 460 }, units: { w: 1427, h: 960 } },
  'vmonitor-3x2': { label: 'Vertical Monitor 3×2 (MoreConsoles)', px: { w: 460, h: 684 }, units: { w: 960, h: 1427 } },
  'monitor-3x2-rugged': { label: 'Monitor 3×2 Rugged or Bulkhead (MoreConsoles)', px: { w: 686, h: 460 }, units: { w: 1432, h: 960 } },
  'vmonitor-3x2-rugged': { label: 'Vertical Monitor 3×2 Rugged or Bulkhead (MoreConsoles)', px: { w: 460, h: 686 }, units: { w: 960, h: 1432 } },
  'monitor-3x3-rugged': { label: 'Monitor 3×3 Rugged (MoreConsoles)', px: { w: 444, h: 460 }, units: { w: 1390, h: 1440 } },
  'vmonitor-3x3-rugged': { label: 'Vertical Monitor 3×3 Rugged (MoreConsoles)', px: { w: 460, h: 444 }, units: { w: 1440, h: 1390 } },
  'monitor-3x3-bulkhead': { label: 'Monitor 3×3 Bulkhead (MoreConsoles)', px: { w: 443, h: 460 }, units: { w: 1387, h: 1440 } },
  'vmonitor-3x3-bulkhead': { label: 'Vertical Monitor 3×3 Bulkhead (MoreConsoles)', px: { w: 460, h: 443 }, units: { w: 1440, h: 1387 } },
} satisfies Record<string, Shape>
// A saved page names its shape by key, so a key never changes once shipped.
export type ShapeKind = keyof typeof TABLE | 'custom'
export const SHAPES: Record<Exclude<ShapeKind, 'custom'>, Shape> = TABLE
// Frozen to the leaves: a page's size and unitsOf's result are these objects themselves.
for (const s of Object.values(SHAPES)) [s.px, s.units, s].forEach(o => Object.freeze(o))
Object.freeze(SHAPES)

type Model = Exclude<ShapeKind, 'custom'>
/** The sizes the menus offer (owner, 2026-10-13: "here you should only have the sizes not all the consoles"): models whose
 *  design units are within 2% on each side share a size. Its first key is its representative, set when the size is chosen;
 *  a page on any member keeps its own key, and adopt and the game link still match a console's exact model. */
export const SIZES: readonly { readonly label: string; readonly keys: readonly [Model, ...Model[]] }[] = [
  { label: 'Square (1×1)', keys: ['square'] },
  { label: '2×1', keys: ['2x1'] },
  { label: 'Vertical 2×1', keys: ['v2x1'] },
  { label: 'Monitor', keys: ['monitor'] },
  { label: 'Vertical Monitor', keys: ['vmonitor'] },
  { label: 'Air Conditioner face (beta)', keys: ['ac'] },
  { label: '2×2', keys: ['2x2', '2x2-lcm', 'v2x2'] },
  { label: '3×2', keys: ['3x2', '3x2-panel', '3x2-rugged', '3x2-bulkhead'] },
  { label: 'Vertical 3×2', keys: ['v3x2', 'v3x2-panel', 'v3x2-rugged', 'v3x2-bulkhead'] },
  { label: '3×3', keys: ['3x3', '3x3-lcm', 'v3x3'] },
  { label: 'Monitor 2×2', keys: ['monitor-2x2-rugged', 'monitor-2x2-bulkhead'] },
  { label: 'Vertical Monitor 2×2', keys: ['vmonitor-2x2-rugged', 'vmonitor-2x2-bulkhead'] },
  { label: 'Monitor 3×2', keys: ['monitor-3x2', 'monitor-3x2-rugged'] },
  { label: 'Vertical Monitor 3×2', keys: ['vmonitor-3x2', 'vmonitor-3x2-rugged'] },
  { label: 'Monitor 3×3', keys: ['monitor-3x3-rugged', 'monitor-3x3-bulkhead'] },
  { label: 'Vertical Monitor 3×3', keys: ['vmonitor-3x3-rugged', 'vmonitor-3x3-bulkhead'] },
]
/** The size a page's shape belongs to; none for a custom size. */
export const sizeOf = (shape: ShapeKind) => shape === 'custom' ? undefined : SIZES.find(s => s.keys.includes(shape))

/** A shape's design units; a custom size's are 480 on its shorter side (it has no cells), its aspect kept. */
export const unitsOf = (shape: ShapeKind, px: { w: number; h: number }) =>
  shape !== 'custom' ? SHAPES[shape].units
  : px.w >= px.h ? { w: Math.round(480 * px.w / px.h), h: 480 } : { w: 480, h: Math.round(480 * px.h / px.w) }

// A size as a whole number of px in 1..8192, 460 for anything not a finite number. A project can come from outside (M4
// share links), so nothing but digits may reach the Lua; loadProject clamps the sizes the core and the canvas get with it.
// Only a number or a non-blank string is read: Number(null), Number('') and Number([]) are 0.
export const px = (v: unknown) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(8192, Math.max(1, Math.round(n))) : 460
}
