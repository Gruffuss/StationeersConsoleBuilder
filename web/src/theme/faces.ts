import faceLines from '../catalog/faceLines.json'
import type { FaceLines } from './baseline'

const styles = ['Thin', 'ExtraLight', 'Light', '', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black']

/** The face names registered by the Fonts mod, including the regular italic. */
export function faceName(family: string, weight: number, italic: boolean): string {
  const style = styles[Math.max(1, Math.min(9, Math.round(weight / 100))) - 1]
  return family + (style ? ' ' + style : '') + (italic ? ' Italic' : '')
}

export function linesOf(face: string): FaceLines | undefined {
  const name = face || 'Liberation Sans'
  return Object.hasOwn(faceLines, name) ? faceLines[name as keyof typeof faceLines] : undefined
}
