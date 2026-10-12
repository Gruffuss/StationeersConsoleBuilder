/** Vertical lines from a face's hhea table and its head table's unitsPerEm. */
export type FaceLines = { ascender: number; descender: number; upem: number }
export const LIBERATION_SANS: FaceLines = { ascender: 1854, descender: -434, upem: 2048 }

/** Align two middle-aligned labels' baselines from their boxes and hhea lines. */
export function heroUnitY(figureH: number, heroSize: number, hero: FaceLines, unitH: number, unitSize: number, unit: FaceLines): number {
  return (figureH - unitH) / 2 + (heroSize * (hero.ascender + hero.descender) / hero.upem
    - unitSize * (unit.ascender + unit.descender) / unit.upem) / 2
}
