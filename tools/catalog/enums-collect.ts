// Reads saved get_chip_logs output of enums-probe.lua (one or more files, read together: the log may keep only its last
// lines, so W0b saves it every few seconds until this accepts them; the probe prints its rows over and over) and writes
// the EnumValues build.ts --values reads. A partial or mixed dump is never written: it refuses (exit 1) a log without
// "ENUM DONE <n>", "ENUM DONE 0", two different counts, a member seen with two values, other than n distinct rows, and an
// ENUM line it cannot read (named). A missing argument, a log file that is not there or an --out it cannot write exits 2.
//   node tools/catalog/enums-collect.ts --game <version> --out <enum-values.json> <log file>...
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { EnumValues } from '../../web/src/catalog/parse.ts'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1] }
const game = arg('--game'), out = arg('--out')
const files = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !['--game', '--out'].includes(all[i - 1] ?? ''))
if (!game || !out || !files.length) { console.error('usage: node tools/catalog/enums-collect.ts --game <version> --out <file> <log>...'); process.exit(2) }
const refuse = (why: string): never => { console.error(why); process.exit(1) }

// A row is "ENUM <table> <name> <number>": a name is any run of non-space characters (a mod's LogicType may hold - or .),
// the number as Lua's tostring writes it (1e+15 among them). Any other line holding "ENUM " is not read, and is named.
const ROW = /ENUM (\S+) (\S+) (-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*$/, DONE = /ENUM DONE (\d+)\s*$/
const rows = new Map<string, number>(), totals = new Set<number>(), unread: string[] = [], clashes: string[] = []
for (const f of files) {
  let lines: string[]
  try {
    if (!statSync(f, { throwIfNoEntry: false })?.isFile()) { console.error(`no such file: ${f}`); process.exit(2) }
    lines = readFileSync(f, 'utf8').split(/\r?\n/)
  } catch (e) { console.error(`cannot read ${f}: ${(e as Error).message}`); process.exit(2) }
  for (const line of lines) {
    const d = DONE.exec(line), m = d ? null : ROW.exec(line)
    if (d) totals.add(Number(d[1]))
    else if (m) {
      const key = `${m[1]} ${m[2]}`, v = Number(m[3]), seen = rows.get(key)
      if (seen !== undefined && seen !== v) clashes.push(`ENUM ${key} is ${seen} in one line and ${v} in another`)
      rows.set(key, v)
    } else if (line.includes('ENUM ')) unread.push(line.trim())
  }
}
if (unread.length) refuse(`${unread.length} ENUM lines were not read (a row is "ENUM <table> <name> <number>"): ${unread.slice(0, 5).map(l => JSON.stringify(l)).join(', ')}`)
const mixed = 'logs from two pushes; save this push\'s log only'
if (clashes.length) refuse(`${clashes.slice(0, 5).join('; ')}: ${mixed}`)
if (totals.size > 1) refuse(`${[...totals].map(t => `ENUM DONE ${t}`).join(' and ')}: ${mixed}`)
const [total] = totals
if (total === 0) refuse('ENUM DONE 0: the probe found no ic.enums table to dump')
if (total === undefined || rows.size < total) refuse(`incomplete: ${rows.size} rows of ${total ?? '?'}; save the log again and rerun`)
if (rows.size > total) refuse(`${rows.size} rows, more than ENUM DONE ${total} counts: ${mixed}`)
// Null-prototype records: a table or member named like an Object member (constructor, toString, __proto__) is kept, not
// lost to the prototype.
const tables: EnumValues['tables'] = Object.create(null)
for (const [k, v] of rows) { const [t, n] = k.split(' '); (tables[t] ??= Object.create(null))[n] = v }
try { writeFileSync(out, JSON.stringify({ game, date: new Date().toISOString().slice(0, 10), tables } satisfies EnumValues, null, 1)) }
catch (e) { console.error(`cannot write ${out}: ${(e as Error).message}`); process.exit(2) }
console.log(`${rows.size} members in ${Object.keys(tables).length} tables: ${Object.entries(tables).map(([t, m]) => `${t} ${Object.keys(m).length}`).join(', ')}`)
