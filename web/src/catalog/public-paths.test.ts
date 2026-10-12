import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { afterAll, expect, it } from 'vitest'

const tool = fileURLToPath(new URL('../../../tools/check-public-paths.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'vb-public-paths-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
it('rejects private paths in text and binary metadata, including either UTF-16 alignment', () => {
  for (const bytes of [Buffer.from('C:\\Users\\test-account\\build.pdb'), Buffer.from('/home/test-account/build.pdb'),
    Buffer.from('OneDrive'), Buffer.from('C:/Users/test-account/build.pdb', 'utf16le'),
    Buffer.concat([Buffer.from([0]), Buffer.from('C:/Users/test-account/build.pdb', 'utf16le')])]) {
    writeFileSync(join(dir, 'assembly.wasm'), bytes)
    const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
    expect(r.status, JSON.stringify({ stderr: r.stderr, signal: r.signal })).toBe(1)
    expect(r.stderr).toContain('local path in')
  }
  writeFileSync(join(dir, 'assembly.wasm'), 'https://example.org/source /_/core/ChipRunner.cs /home/web_user')
  const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout).toContain('zero local paths')
}, 10_000) // measured: 1.333 s focused, 3.181 s full suite; at least 3x headroom
it('rejects any absolute local path: a drive letter, a UNC share or a home folder, wherever the checkout is', () => {
  for (const text of ['built in C:/builds/vb/web/src/main.ts', 'pdb D:\\work\\vb\\core\\Core.pdb', 'at e:/src/vb/a.ts',
    '"C:\\\\builds\\\\vb\\\\web"', 'share \\\\buildbox\\drop\\vb\\core.pdb', 'file:///C:/builds/vb/web/index.html',
    'from /home/someone/vb/web', '/Users/someone/vb', '/root/vb/web']) {
    for (const bytes of [Buffer.from(text), Buffer.from(text, 'utf16le')]) {
      writeFileSync(join(dir, 'assembly.wasm'), bytes)
      const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
      expect(r.status, text + ' ' + JSON.stringify({ stderr: r.stderr, signal: r.signal })).toBe(1)
      expect(r.stderr).toContain('local path in')
    }
  }
  // URLs, scheme-relative links, server routes and code that only looks like a drive (an object key before a regex,
  // a Windows API prefix written as an escaped string) are not local paths.
  for (const text of ['https://example.org/C:/x', 'see https://github.com/a/b and //cdn.example.org/x.js', '/_framework/dotnet.js',
    'const o={a:/^x$/,b:/y/}', 'x?a:/[\\\\/]/.test(p)', 'new URL("/home/web_user/x")', '/home/web_user', 'http://localhost:5173/',
    'no absolute paths (drive letters, `/Users/`, `AppData`)', '/\\\\d+\\\\.\\\\d+/', 'C:\\\\Program Files\\\\dotnet\\\\packs\\\\x']) {
    writeFileSync(join(dir, 'assembly.wasm'), text)
    const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
    expect(r.status, text + ' ' + r.stderr).toBe(0)
  }
}, 30_000)   // measured 1.5 s for the whole file focused; headroom for a shared machine
it('rejects a worktrees folder in any path, relative or escaped; the word alone is prose', () => {
  for (const text of ['built in ../worktrees/m6/web/src/main.ts', 'repo\\worktrees\\x\\core.pdb', 'repo\\\\worktrees\\\\x', 'checkouts/worktrees/a']) {
    writeFileSync(join(dir, 'assembly.wasm'), text)
    const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
    expect(r.status, text + ' ' + r.stderr).toBe(1)
    expect(r.stderr).toContain('local path in')
  }
  for (const text of ['git worktrees keep branches apart', 'worktrees/', 'the worktrees folder']) {
    writeFileSync(join(dir, 'assembly.wasm'), text)
    const r = spawnSync(process.execPath, [tool, dir], { encoding: 'utf8' })
    expect(r.status, text + ' ' + r.stderr).toBe(0)
  }
})
it('rejects a local path escaped once, twice or three times (a JSON string inside a JSON string), keeping its allowances', () => {
  // Each escape doubles every backslash: 1, 2, 4 and 8 of them.
  const escaped = (text: string, times: number) => text.replaceAll('\\', '\\'.repeat(2 ** times))
  for (const times of [0, 1, 2, 3]) {
    for (const text of ['"C:\\builds\\vb\\web\\main.ts"', '"D:\\Users\\someone\\x"', 'share \\\\buildbox\\drop\\vb\\core.pdb', 'repo\\worktrees\\x']) {
      writeFileSync(join(dir, 'escaped.json'), escaped(text, times))
      const r = spawnSync(process.execPath, [tool, join(dir, 'escaped.json')], { encoding: 'utf8' })
      expect(r.status, `${times}: ${escaped(text, times)} ${r.stderr}`).toBe(1)
      expect(r.stderr).toContain('local path in')
    }
    for (const text of ['C:\\Program Files\\dotnet\\packs\\x', '/\\d+\\.\\d+/', 'x?a:/[\\/]/.test(p)']) {
      writeFileSync(join(dir, 'escaped.json'), escaped(text, times))
      const r = spawnSync(process.execPath, [tool, join(dir, 'escaped.json')], { encoding: 'utf8' })
      expect(r.status, `${times}: ${escaped(text, times)} ${r.stderr}`).toBe(0)
    }
  }
}, 30_000)   // the same work as the test above: headroom for a shared machine
it('finds no local path in the published documents', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const r = spawnSync(process.execPath, [tool, join(root, 'docs'), join(root, 'README.md')], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout).toContain('zero local paths')
})
it('checks the contents of compressed published assemblies', () => {
  for (const [ext, compress] of [['gz', gzipSync], ['br', brotliCompressSync]] as const) {
    const file = join(dir, `compressed.wasm.${ext}`)
    writeFileSync(file, compress(Buffer.from('OneDrive')))
    const r = spawnSync(process.execPath, [tool, file], { encoding: 'utf8' })
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain('local path in')
    writeFileSync(file, compress(Buffer.from('public assembly')))
    expect(spawnSync(process.execPath, [tool, file]).status).toBe(0)
  }
})
it('scans the published Lua examples without a native decoding crash', () => {
  const examples = fileURLToPath(new URL('../../../core/vendor/vector/examples/', import.meta.url))
  const files = readdirSync(examples).filter(f => /^\d\d-.*\.lua$/.test(f)).sort()
  expect(files).toHaveLength(19)
  expect(files).toContain('19-webfonts.lua')
  for (const file of files) writeFileSync(join(dir, file), readFileSync(join(examples, file)))
  const r = spawnSync(process.execPath, [tool, ...files.map(file => join(dir, file))], { encoding: 'utf8' })
  expect(r.status, JSON.stringify({ stderr: r.stderr, signal: r.signal })).toBe(0)
})
