import { fieldOf } from '../schema'
import { foldKey } from '../srctext/props'

const GROUPS = new Set(['fill', 'stroke', 'text', 'effects'])
const NOT_STYLE = new Set(['TEXT', 'FMT', 'UNIT', 'MISSING', 'V', 'CLIP', 'MASK', 'ID'])
const CORNERS = new Set(['R', 'SC', 'IMG'])   // rx ry are corner radii here; on C they are its size

export function isStyle(op: string, key: string): boolean {
  const O = foldKey(op), K = foldKey(key)
  if ((K === 'RX' || K === 'RY') && CORNERS.has(O)) return true
  const f = fieldOf(O, K)
  return !!f && GROUPS.has(f.group) && !NOT_STYLE.has(K)
}
