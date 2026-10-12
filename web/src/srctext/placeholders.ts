// Ported from scripted-screens-vector v0.11.118, SceneModel.cs:3161-3206 (MIT).
/** The closer of a {$...} or {=...} placeholder; -1 when it stays literal because it is unclosed. */
export function placeholderClose(body: string, open: number): number {
  let depth = 1, spec = false, sawEscape = false
  for (let i = open + 2; i < body.length; i++) {
    const c = body[i]
    if (!spec) {
      if (c === ':' && depth === 1) spec = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) return i
    } else if (c === '{' && body[i + 1] === '{') { sawEscape = true; i++ }
    else if (c === '}' && sawEscape && body[i + 1] === '}') i++
    else if (c === '{') { i = body.indexOf('}', i); if (i < 0) return -1 }
    else if (c === '}') return i
  }
  return -1
}

/** First format colon outside a binding's index; expression placeholders have no index in their name. */
export function formatColon(inner: string, binding: boolean): number {
  const colon = inner.indexOf(':'), bracket = binding ? inner.indexOf('[') : -1
  return bracket >= 0 && (colon < 0 || bracket < colon) ? inner.indexOf(':', inner.indexOf(']', bracket) + 1) : colon
}
