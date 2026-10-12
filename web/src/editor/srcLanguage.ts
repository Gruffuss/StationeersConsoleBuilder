// Highlighting for the src scene text, line by line: `op key=value … {`, `}` and # comments (srctext/parse.ts has the grammar).
import { StreamLanguage, type StringStream } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { numberOf } from '../srctext/parse'

// at: what the next word is. array: how deep inside [ ] (arrays close on their own line).
type State = { at: 'op' | 'key' | 'value'; array: number }

const BARE = /^[^\s={}[\],][^\s={}[\],#]*/   // a bare token: a # ends it unless it is the first char

// One value: a quoted string, an =expression to the next space, or a bare token typed by its first char.
function value(stream: StringStream): string | null {
  if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string'
  if (stream.match(/^=\S*/)) return 'expression'
  if (!stream.match(BARE)) { stream.next(); return null }
  const t = stream.current()
  return t[0] === '#' ? 'atom' : t[0] === '$' ? 'variableName' : t[0] === '@' ? 'labelName' : numberOf(t) !== undefined ? 'number' : 'string'
}

export const srcLanguage = StreamLanguage.define<State>({
  name: 'src',
  startState: () => ({ at: 'op', array: 0 }),
  token(stream, s) {
    if (stream.sol()) [s.at, s.array] = ['op', 0]
    if (stream.eatSpace()) return null
    const c = stream.peek()
    if (s.array) {
      stream.next()
      if (c === '[' || c === ']') {
        s.array += c === '[' ? 1 : -1
        return 'bracket'
      }
      if (c === ',') return null
      stream.backUp(1)
      return value(stream)
    }
    if (s.at === 'value') {
      s.at = 'key'
      if (c !== '[') return value(stream)
      stream.next()
      s.array = 1
      return 'bracket'
    }
    if (c === '#') { stream.skipToEnd(); return 'comment' }
    if (c === '{' || c === '}') { stream.next(); s.at = 'op'; return 'bracket' }
    if (c === '=') { stream.next(); s.at = 'value'; return null }
    if (!stream.match(BARE)) { stream.next(); return null }
    if (s.at === 'op') { s.at = 'key'; return 'typeName' }
    return 'propertyName'
  },
  tokenTable: { expression: tags.special(tags.string) },
})
