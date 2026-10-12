/** Whether two JSON-like values are equal (arrays and records key by key, in order). Identical objects are skipped, so
 *  comparing a scene with one a command or a drag rebuilt costs only the paths it rebuilt. An explicit stack: any depth. */
export function sameData(a: unknown, b: unknown): boolean {
  const stack: [unknown, unknown][] = [[a, b]]
  while (stack.length) {
    const [x, y] = stack.pop()!
    if (x === y) continue
    if (typeof x !== 'object' || typeof y !== 'object' || !x || !y || Array.isArray(x) !== Array.isArray(y)) return false
    const kx = Object.keys(x), ky = Object.keys(y)
    if (kx.length !== ky.length) return false
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] !== ky[i]) return false
      stack.push([(x as Record<string, unknown>)[kx[i]], (y as Record<string, unknown>)[kx[i]]])
    }
  }
  return true
}
