// A scene on its way to the check worker, as two flat lists. Structured clone recurses once per level and refuses a
// scene past about 800 levels of nodes (measured in Node 24, whose V8 browsers share), which would make depth a limit
// again; this walks with explicit stacks. Plain data only: objects, arrays, strings, numbers (-0 kept), undefined.
export type Wire = { shape: number[]; atoms: unknown[] }
const ATOM = 0, ARRAY = 1, OBJECT = 2

export function pack(x: unknown): Wire {
  const shape: number[] = [], atoms: unknown[] = []
  for (const todo = [x]; todo.length;) {
    const v = todo.pop()
    if (Array.isArray(v)) {
      shape.push(ARRAY, v.length)
      for (let k = v.length - 1; k >= 0; k--) todo.push(v[k])
    } else if (v !== null && typeof v === 'object') {
      const keys = Object.keys(v)
      shape.push(OBJECT, keys.length)
      for (const k of keys) atoms.push(k)
      for (let k = keys.length - 1; k >= 0; k--) todo.push((v as Record<string, unknown>)[keys[k]])
    } else {
      shape.push(ATOM)
      atoms.push(v)
    }
  }
  return { shape, atoms }
}

/** pack's inverse. Objects come back without a prototype, as parseSrc makes attrs, so a key such as __proto__ stays a key. */
export function unpack(w: Wire): unknown {
  let s = 0, a = 0, result: unknown
  // The containers being filled, innermost last: an array, or an object with its keys, and how many values are in.
  const open: { into: unknown[] | Record<string, unknown>; keys: string[] | null; n: number; k: number }[] = []
  while (s < w.shape.length) {
    const code = w.shape[s++]
    let v: unknown, box: (typeof open)[number] | null = null
    if (code === ATOM) v = w.atoms[a++]
    else {
      const n = w.shape[s++]
      const keys = code === OBJECT ? w.atoms.slice(a, a += n) as string[] : null
      v = keys ? Object.create(null) : []
      box = { into: v as unknown[] | Record<string, unknown>, keys, n, k: 0 }
    }
    const top = open[open.length - 1]
    if (!top) result = v
    else if (top.keys) (top.into as Record<string, unknown>)[top.keys[top.k++]] = v
    else (top.into as unknown[])[top.k++] = v
    if (box) open.push(box)
    while (open.length && open[open.length - 1].k === open[open.length - 1].n) open.pop()
  }
  return result
}
