import { FMT } from '../widgets/core'
import { plainTextProblem } from '../widgets/paint'
import type { Json, Param } from '../widgets/types'
import type { Theme } from '../theme'
import { shortestFloat } from '../srctext/print'
import { TextField } from './PropertyPanel'

export function readParam(text: string, p: Param): { value: Json } | { error: string } {
  const s = text.trim(), n = Number(s)
  const outside = (n: number) => ('min' in p && p.min !== undefined && n < p.min) || ('max' in p && p.max !== undefined && n > p.max)
  const range = () => 'min' in p && p.min !== undefined ? ('max' in p && p.max !== undefined ? `between ${p.min} and ${p.max}` : `at least ${p.min}`) : `at most ${'max' in p ? p.max : ''}`
  switch (p.type) {
    case 'num':
      if (s === '' || !Number.isFinite(n)) return { error: 'a number is expected' }
      if (!Number.isFinite(Math.fround(n))) return { error: 'too large: a float32 holds at most 3.4e38 either way' }
      if (p.int && !Number.isInteger(n)) return { error: 'a whole number is expected' }
      return outside(n) ? { error: range() } : { value: n }
    case 'numbers': {
      const list = s.split(/[\s,]+/).filter(Boolean).map(Number)
      if (list.some(n => !Number.isFinite(Math.fround(n)))) return { error: 'numbers, separated by commas' }
      return list.some(outside) ? { error: 'each ' + range() } : { value: list }
    }
    case 'text': { const why = plainTextProblem(text); return why ? { error: why } : { value: text } }
    case 'fmt': return FMT.test(text) ? { value: text } : { error: 'a format cannot hold { or }: a placeholder ends at its first }' }
    default: return { value: text }
  }
}

export function WidgetParam({ param: p, value: v, label, id, theme, pages, onChange, onError, list, multiline }: {
  param: Param; value: Json; label: string; id?: string; theme: Theme; pages: readonly { id: string; name: string }[]
  onChange: (value: Json) => void; onError: (message: string) => void; list?: string; multiline?: boolean
}) {
  return p.type === 'flag' ? <input type="checkbox" id={id} aria-label={label} checked={v === true} onChange={e => onChange(e.target.checked)} />
    : p.type === 'enum' ? <select id={id} aria-label={label} value={String(v)} onChange={e => onChange(e.target.value)}>
      {(p.tokens ? Object.keys(theme.colors) : p.enum).map(word => <option key={word}>{word}</option>)}</select>
    : p.type === 'page' ? <select id={id} aria-label={label} value={String(v)} onChange={e => onChange(e.target.value)}>
      {pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}
      {!pages.some(page => page.id === v) && <option value={String(v)}>{String(v)} (no such page)</option>}</select>
    : <TextField id={id} label={label} placeholder="" list={list} multiline={multiline ?? (p.type === 'text' || p.type === 'template')}
      now={p.type === 'numbers' ? (v as number[]).map(shortestFloat).join(', ') : typeof v === 'number' ? shortestFloat(v) : String(v ?? '')}
      commit={text => { const read = readParam(text, p); if ('error' in read) onError(read.error); else onChange(read.value) }} />
}
