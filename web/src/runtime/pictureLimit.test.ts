import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

// The published core reads each managed format (8-, 24- and 32-bit BMP, GIF) at the mod's size limit, 4096×4096, twice
// in one runtime, as the preview's worker calls it. test/pictureMemory.mjs holds the fixtures, checks the pixels and
// prints one line per read (its time and the wasm memory's size); it runs in its own process, so a runtime that runs
// out of memory fails these tests instead of taking the suite with it.
type Read = { format: string; path: string; round: number; note?: string }
function run(...args: string[]) {
  const out = spawnSync(process.execPath, ['test/pictureMemory.mjs', ...args], { encoding: 'utf8' })
  expect(out.stdout + out.stderr).toContain('pictures at the limit clean')
  expect(out.status).toBe(0)
  return out.stdout.split('\n').filter(line => line.startsWith('{"format"')).map(line => JSON.parse(line) as Read)
}

it('decodes fetched BMP and GIF files at the size limit, twice each, without running the core out of memory', () => {
  const reads = run('bytes')
  expect(reads.map(r => `${r.format} ${r.round}`)).toEqual(['bmp8 1', 'bmp8 2', 'bmp24 1', 'bmp24 2', 'bmp32 1', 'bmp32 2', 'gif 1', 'gif 2'])
  expect(reads.filter(r => r.note)).toEqual([])
}, 60000)

// A data: URL arrives as text: an 89-million-character URL for the 32-bit BMP, two bytes a character once it is a
// string, and the mod's DataUrl copies its body. Where that does not fit, the read says so and the core carries on.
it('decodes data: URLs at the size limit, or says they are too large to preview here, and the core carries on', () => {
  const reads = run('dataurl', 'notes')
  expect(reads).toHaveLength(8)
  expect(reads.filter(r => r.note && /^bmp8|^gif/.test(r.format))).toEqual([])
}, 60000)

it('beside a chip that holds most of the heap, says each picture is too large to preview here and the chip keeps running', () => {
  const reads = run('bytes', 'notes', 'chip=175')
  expect(reads).toHaveLength(8)
  for (const r of reads) expect(r.note).toMatch(/^too large to preview here: decoding this 4096×4096 picture needs about \d+ MB, and the preview's core has \d+ MB free$/)
}, 60000)
