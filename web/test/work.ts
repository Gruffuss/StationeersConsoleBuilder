/** Count indexed reads, aborting repeated whole-list work before a regression can hang the suite. */
export function indexedReads<T>(values: T[], limit: number) {
  let count = 0
  const tracked = new Proxy(values, { get(target, key, receiver) {
    if (typeof key === 'string' && /^\d+$/.test(key) && ++count > limit) throw new Error('indexed reads exceed the linear work bound')
    return Reflect.get(target, key, receiver)
  } })
  return { values: tracked, count: () => count, reset: () => { count = 0 } }
}

/** Bound characters copied or submitted to regexes, independently of CPU scheduling. */
export function stringWork<T>(f: () => T, limit: number): T {
  let count = 0
  const charge = (n: number) => { if ((count += n) > limit) throw new Error('string work exceeds its character bound') }
  const slice = String.prototype.slice, exec = RegExp.prototype.exec
  String.prototype.slice = function (this: string, from?: number, to?: number) { const out = slice.call(this, from, to); charge(out.length); return out }
  RegExp.prototype.exec = function (text: string) { charge(String(text).length); return exec.call(this, text) }
  try { return f() } finally { String.prototype.slice = slice; RegExp.prototype.exec = exec }
}
