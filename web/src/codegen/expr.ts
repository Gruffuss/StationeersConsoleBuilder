// The guard on every expression a project holds (spec §6.4): a Lua 5.2 expression, checked lexically so it cannot change
// the script's structure: no statement keyword, no `function`, no `;`, no assignment (an `=` directly inside `{ }` names a
// table constructor's field), no comment, no carriage return, balanced brackets, not empty. One that passes and is still
// not valid Lua surfaces as the load's Lua error, mapped to its owner (linemap.ts). Not a security boundary: the custom block
// is verbatim Lua anyway.
const STATEMENT = new Set(['end', 'local', 'return', 'do', 'then', 'else', 'elseif', 'while', 'repeat', 'until', 'for', 'in', 'if', 'break', 'goto', 'function'])
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

export function checkExpr(src: string): string | null {
  if (typeof src !== 'string' || !src.trim()) return 'an expression is empty'
  // Lua counts a lone CR as a line break and the export's line map counts LF alone, so past a lone CR every later line of the
  // script would be named one line off (measured through Lua-CSharp). Any CR is refused, the simplest rule to state: a text
  // box never holds one; a loaded project may.
  if (src.includes('\r')) return 'a carriage return is not allowed in an expression'
  const stack: string[] = []
  const word = /[A-Za-z_][A-Za-z0-9_]*/y, long = /\[(=*)\[/y, number = /0[xX][0-9a-fA-F.]+(?:[pP][+-]?\d+)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
  for (let i = 0; i < src.length;) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (src.startsWith('--', i)) return 'comments are not allowed in an expression'
    long.lastIndex = i
    const lb = long.exec(src)
    if (lb) {
      const end = src.indexOf(`]${lb[1]}]`, i + lb[0].length)
      if (end < 0) return 'a long string is not closed'
      i = end + lb[1].length + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') return 'a string is not closed on its line'
        j += src[j] === '\\' ? 2 : 1
      }
      if (j >= src.length) return 'a string is not closed'
      i = j + 1
      continue
    }
    word.lastIndex = i
    const w = word.exec(src)
    if (w) {
      if (STATEMENT.has(w[0])) return `"${w[0]}" is not allowed in an expression`
      i += w[0].length
      continue
    }
    number.lastIndex = i
    const n = number.exec(src)
    if (n?.[0]) { i += n[0].length; continue }
    const op = src.slice(i, i + 2)
    if (['//', '<<', '>>'].includes(op) || '&|'.includes(c) || (c === '~' && src[i + 1] !== '='))
      return `"${['//', '<<', '>>'].includes(op) ? op : c}" is not supported in Lua 5.2`
    if (c === ';') return '";" is not allowed in an expression'
    if ('=~<>'.includes(c) && src[i + 1] === '=') { i += 2; continue }
    // A field name's `=` (`{ a = 1 }`, `{ [k] = v }`): the bracket stack keeps it inside its constructor.
    if (c === '=' && stack[stack.length - 1] !== '{') return 'an expression cannot assign ("=")'
    if ('([{'.includes(c)) { stack.push(c); i++; continue }
    if (Object.hasOwn(OPENER, c)) {
      if (stack.pop() !== OPENER[c]) return `"${c}" closes nothing`
      i++
      continue
    }
    i++
  }
  return stack.length ? `"${stack[stack.length - 1]}" is not closed` : null
}
