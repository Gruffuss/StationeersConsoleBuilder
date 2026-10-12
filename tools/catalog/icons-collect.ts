// Reads saved chip logs from icons-probe.lua; writes names only, never sprites.
// node tools/catalog/icons-collect.ts --out <icons.json> <log>...
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2), at = args.indexOf('--out'), out = at < 0 ? undefined : args[at + 1]
const files = args.filter((_, i) => i !== at && i !== at + 1)
if (!out || !files.length) { console.error('usage: node tools/catalog/icons-collect.ts --out <file> <log>...'); process.exit(2) }
const refuse = (why: string): never => { console.error(why); process.exit(1) }
const tables: Record<string, Record<string, string>> = Object.create(null)
const counts = new Map<string, number>(), kinds = new Set<string>()
for (const file of files) {
  let log: string
  try { log = readFileSync(file, 'utf8') }
  catch (e) { console.error(`cannot read ${file}: ${(e as Error).message}`); process.exit(2) }
  for (const line of log.split(/\r?\n/)) {
    const pos = line.indexOf('ICONS ')
    if (pos < 0) continue
    const text = line.slice(pos + 6).trim()
    if (text.startsWith('kinds ')) {
      for (const kind of text.slice(6).split(',')) kinds.add(kind)
      continue
    }
    const row = /^(\S+) (.+)$/.exec(text)
    if (!row) refuse(`unread ICONS line: ${text}`)
    const [, kind, body] = row, table = tables[kind] ??= Object.create(null)
    const count = /^count (\d+)$/.exec(body)
    if (count) {
      const n = Number(count[1])
      if (counts.has(kind) && counts.get(kind) !== n) refuse(`conflicting count for ${kind}`)
      counts.set(kind, n)
      continue
    }
    for (const entry of body.split(' | ')) {
      const pair = /^(\S+)=(\S+)$/.exec(entry)
      if (!pair) refuse(`malformed icon value: ${entry}`)
      const [, key, value] = pair
      if (!/^[^:\s]+:[^:\s]+$/.test(value)) refuse(`malformed icon value: ${entry}`)
      if (Object.hasOwn(table, key) && table[key] !== value) refuse(`conflicting icon value: ${kind} ${key}`)
      table[key] = value
    }
  }
}
if (!kinds.size) refuse('incomplete: missing ICONS kinds')
for (const kind of new Set([...kinds, ...Object.keys(tables)])) {
  const n = Object.keys(tables[kind] ?? {}).length
  if (!kinds.has(kind) || counts.get(kind) !== n) refuse(`incomplete: ${kind} has ${n} entries, count ${counts.get(kind) ?? '?'}`)
}
const sorted = Object.fromEntries(Object.keys(tables).sort().map(kind => [kind,
  Object.fromEntries(Object.entries(tables[kind]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))]))
try { writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n') }
catch (e) { console.error(`cannot write ${out}: ${(e as Error).message}`); process.exit(2) }
console.log(Object.entries(sorted).map(([kind, table]) => `${kind} ${Object.keys(table).length}`).join(', '))
