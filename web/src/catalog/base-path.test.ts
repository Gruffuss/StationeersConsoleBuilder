import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it } from 'vitest'

const tool = fileURLToPath(new URL('../../../tools/check-base-path.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'vb-base-path-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const run = (base: string | undefined) => spawnSync(process.execPath, [tool, dir],
  { encoding: 'utf8', env: { ...process.env, VB_BASE: base } })
function output(files: Record<string, string>) {
  rmSync(dir, { recursive: true, force: true })
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), text)
  }
}
const clean = {
  'index.html': '<script type="module" crossorigin src="/vb/assets/index-a1.js"></script><link rel="stylesheet" href="/vb/assets/index-b2.css">',
  'assets/index-a1.js': 'const w=new Worker(new URL("/vb/assets/core.worker-c3.js",import.meta.url));const s="a/b".split("/");fetch("https://example.org/x")',
  'assets/core.worker-c3.js': 'await import(new URL("/vb/_framework/dotnet.js",self.location.origin).href)',
  'assets/index-b2.css': '@font-face{src:url(/vb/assets/face.woff2)} a{background:url(data:image/png;base64,AA==)}',
  // Quoted strings that begin with a slash but name none of the site's files: a regex source, markup, archive members.
  'assets/strings-d4.js': 'x.replace(/"/g,"");const m="<path/>",f=["/README.md","/tokens.json","/test/fixtures/a.json"]',
  // The site's own folders: a root path into one of them is a load from the wrong place.
  '_framework/dotnet.js': 'export const dotnet={}; const home="/home/web_user"; const fs="/tmp"',
  'examples/01-hello.lua': '-- example',
  'fonts/Barlow.woff2': '',
}

it('passes an output whose root paths all lie under the base', () => {
  output(clean)
  const r = run('/vb/')
  expect(r.status, r.stderr).toBe(0)
  expect(r.stdout).toContain('base path /vb/')
}, 10_000)
it('fails a root path outside the base in HTML, JS, CSS or a worker', () => {
  for (const [file, stray] of [['assets/core.worker-c3.js', 'import(new URL("/_framework/dotnet.js",self.location.origin).href)'],
    ['assets/index-a1.js', "fetch('/examples/01-hello.lua')"], ['assets/index-b2.css', '@font-face{src:url(/fonts/Barlow.woff2)}'],
    ['index.html', '<link rel="icon" href="/favicon.svg">']] as const) {
    output({ ...clean, [file]: clean[file] + stray })
    const r = run('/vb/')
    expect(r.status, file + ' ' + r.stdout).toBe(1)
    expect(r.stderr).toContain('outside the base path /vb/')
    expect(r.stderr).toContain(file.split('/').pop())
  }
}, 30_000)
it('treats every root path as inside the base when the base is the root', () => {
  output({ ...clean, 'assets/index-a1.js': 'fetch("/examples/01-hello.lua")' })
  expect(run(undefined).status).toBe(0)
})
it('loads nothing from a fixed root path in the sources', () => {
  const src = fileURLToPath(new URL('../', import.meta.url))
  const found = readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter(f => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter(f => /new URL\(\s*(?:\/\*[^*]*\*\/\s*)?['"`]\//.test(readFileSync(join(src, f), 'utf8')))
  expect(found).toEqual([])
})
