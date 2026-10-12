import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// tools/catalog/enums-collect.ts (Task 9), run as W0b runs it: Node on saved get_chip_logs files of enums-probe.lua.
const tool = fileURLToPath(new URL('../../../tools/catalog/enums-collect.ts', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'vb-enums-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let n = 0
function run(args: string[], preload?: string) {
  const r = spawnSync(process.execPath, [...(preload ? ['--import', pathToFileURL(preload).href] : []), tool, ...args], { encoding: 'utf8' })
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, signal: r.signal, error: r.error?.message }
}
function collect(...logs: string[]) {
  const files = logs.map(text => { const f = join(dir, `log-${++n}.txt`); writeFileSync(f, text); return f })
  const out = join(dir, `out-${n}.json`)
  const r = run(['--game', '0.2.1', '--out', out, ...files])
  let written: { game: string; tables: Record<string, Record<string, number>> } | undefined
  try { written = JSON.parse(readFileSync(out, 'utf8')) } catch { written = undefined }
  return { ...r, written }
}
const T = 60_000   // each case is a Node start: about 0.6 s alone, longer beside the other files running in parallel
const noStack = /^\s+at /m

describe('tools/catalog/enums-collect.ts', () => {
  it('writes the rows of several saved logs together, keeping a member named like an Object member', () => {
    const r = collect('[12:00:01] ENUM LogicBatchMethod Sum 1\r\nENUM LogicType constructor 7\r\n', 'ENUM LogicType On 28\nENUM DONE 3\n')
    expect(r.status).toBe(0)
    expect(r.written?.game).toBe('0.2.1')
    expect(r.written?.tables).toEqual({ LogicBatchMethod: { Sum: 1 }, LogicType: { constructor: 7, On: 28 } })
    expect(r.stdout).toContain('3 members in 2 tables')
  }, T)

  it('reads a mod\'s member name with any non-space characters and a number as Lua prints it (exponent form)', () => {
    const r = collect('ENUM LogicType My-Mod.Type 400\nENUM LogicType Big 1e+15\nENUM LogicType Small -2.5E-3\nENUM DONE 3\n')
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
    expect(r.written?.tables).toEqual({ LogicType: { 'My-Mod.Type': 400, Big: 1e15, Small: -0.0025 } })
  }, T)

  it('refuses a log without ENUM DONE, and one with fewer rows than it counts; nothing is written', () => {
    const none = collect('ENUM LogicType On 28\n')
    expect([none.status, none.written]).toEqual([1, undefined])
    expect(none.stderr).toContain('incomplete: 1 rows of ?')
    const short = collect('ENUM LogicType On 28\nENUM DONE 2\n')
    expect([short.status, short.written]).toEqual([1, undefined])
    expect(short.stderr).toContain('incomplete: 1 rows of 2')
  }, T)

  it('names the ENUM lines it cannot read, instead of asking for the log again', () => {
    const r = collect('ENUM LogicType On 28\nENUM LogicType Odd table: 0x1f\nENUM LogicType Far inf\nENUM DONE 3\n')
    expect([r.status, r.written]).toEqual([1, undefined])
    expect(r.stderr).toContain('2 ENUM lines were not read')
    expect(r.stderr).toContain('"ENUM LogicType Odd table: 0x1f"')
    expect(r.stderr).toContain('"ENUM LogicType Far inf"')
    expect(r.stderr).not.toContain('save the log again')
  }, T)

  it('refuses rows from two pushes: more rows than ENUM DONE counts, two counts, a member with two values', () => {
    const more = collect('ENUM LogicType On 28\nENUM LogicType Off 29\nENUM DONE 1\n')
    expect([more.status, more.written]).toEqual([1, undefined])
    expect(more.stderr).toContain('2 rows, more than ENUM DONE 1')
    const counts = collect('ENUM LogicType On 28\nENUM DONE 1\n', 'ENUM LogicType On 28\nENUM LogicType Off 29\nENUM DONE 2\n')
    expect([counts.status, counts.written]).toEqual([1, undefined])
    expect(counts.stderr).toContain('ENUM DONE 1 and ENUM DONE 2')
    const values = collect('ENUM LogicType On 28\n', 'ENUM LogicType On 29\nENUM DONE 1\n')
    expect([values.status, values.written]).toEqual([1, undefined])
    expect(values.stderr).toContain('ENUM LogicType On is 28 in one line and 29 in another')
  }, T)

  it('refuses ENUM DONE 0: no table to write', () => {
    const r = collect('ENUM DONE 0\n')
    expect([r.status, r.written]).toEqual([1, undefined])
    expect(r.stderr).toContain('ENUM DONE 0')
  }, T)

  it('keeps table and member names that collide with Object prototypes', () => {
    const r = collect('ENUM __proto__ constructor 1\nENUM constructor __proto__ 2\nENUM toString toString 3\nENUM LogicType __proto__ 4\nENUM DONE 4\n')
    expect(r.status, JSON.stringify(r)).toBe(0)
    expect(r.written?.tables).toEqual(JSON.parse('{"__proto__":{"constructor":1},"constructor":{"__proto__":2},"toString":{"toString":3},"LogicType":{"__proto__":4}}'))
  }, T)

  it('exits 2 with its message and no stack on an unreadable log', () => {
    const log = join(dir, 'unreadable.log'), preload = join(dir, 'unreadable.mjs')
    writeFileSync(log, 'ENUM LogicType On 28\nENUM DONE 1\n')
    // Inject a read failure: filesystem permission tests vary with Windows ACLs and elevated test runners.
    writeFileSync(preload, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFileSync; fs.readFileSync = function(path, ...args) { if (path === ${JSON.stringify(log)}) throw new Error('access denied'); return read.call(this, path, ...args) }; syncBuiltinESMExports();`)
    const r = run(['--game', 'x', '--out', join(dir, 'unreadable.json'), log], preload)
    expect(r.status, JSON.stringify(r)).toBe(2)
    expect(r.stderr).toContain('cannot read')
    expect(r.stderr).toContain('access denied')
    expect(r.stderr).not.toMatch(noStack)
  }, T)

  it('exits 2 with no stack trace on a missing argument, a log file that is not there, or an --out it cannot write', () => {
    const args = run(['--game', 'x'])
    expect(args.status, JSON.stringify(args)).toBe(2)
    expect(args.stderr).not.toMatch(noStack)
    const missing = join(dir, 'no-such.log')
    const r = run(['--game', 'x', '--out', join(dir, 'never.json'), missing])
    expect(r.status, JSON.stringify(r)).toBe(2)
    expect(r.stderr).toContain(`no such file: ${missing}`)
    expect(r.stderr).not.toMatch(noStack)
    const log = join(dir, 'whole.log')
    writeFileSync(log, 'ENUM LogicType On 28\nENUM DONE 1\n')
    const w = run(['--game', 'x', '--out', join(dir, 'no-dir', 'out.json'), log])
    expect(w.status, JSON.stringify(w)).toBe(2)
    expect(w.stderr).toContain('cannot write')
    expect(w.stderr).not.toMatch(noStack)
  }, T)
})
