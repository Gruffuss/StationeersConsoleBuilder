import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A site built for a sub-path (VB_BASE, as vite.config.ts reads it) must load nothing from the origin's root: under a
// project site every other path of the origin belongs to someone else, so such a load fails or fetches a stranger's file.
// Scans the built HTML, JS (workers included) and CSS for root paths outside the base:
// - in CSS, every url(/x);
// - in HTML, every src= or href= that is a root path;
// - in HTML and JS, a quoted root path ("/x, '/x, `/x) whose first segment is one of the site's own top-level files or
//   folders (assets, _framework, fonts, examples, ...). Minified code holds many other quoted strings that begin with a
//   slash (regex sources, markup, file names inside imported archives); naming the site's own files is what makes a
//   string a load from the wrong place.
// A doubled slash is a scheme-relative URL, not a root path. The .NET runtime's own files (_framework) are not scanned:
// they are copied in as published, load their assets relative to themselves, and name Emscripten's virtual file system
// paths such as /tmp and /dev.
const cssUrl = /url\(\s*["']?(\/(?!\/)[^"')\s]+)/g
const htmlAttr = /\s(?:src|href)\s*=\s*["']?(\/(?!\/)[^"'\s>]+)/g
const quoted = /["'`](\/(?!\/)[^"'`\s]+)/g

/** Every root path in `text` (a file of `kind` html, js or css) outside `base`; `own` holds the output's top-level names. */
export function strayRootPaths(text, kind, base, own) {
  const found = []
  if (kind === 'css') for (const m of text.matchAll(cssUrl)) found.push(m[1])
  if (kind === 'html') for (const m of text.matchAll(htmlAttr)) found.push(m[1])
  if (kind !== 'css') for (const m of text.matchAll(quoted)) if (own.has(m[1].slice(1).split(/[/?#]/)[0])) found.push(m[1])
  return found.filter(path => !path.startsWith(base) && path + '/' !== base)
}

export function checkBasePath(dir, base) {
  const own = new Set(readdirSync(dir))
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map(f => f.replaceAll('\\', '/'))
    .filter(f => /\.(html|m?js|css)$/.test(f) && !f.startsWith('_framework/'))
  for (const file of files) {
    const kind = file.endsWith('.html') ? 'html' : file.endsWith('.css') ? 'css' : 'js'
    const stray = strayRootPaths(readFileSync(join(dir, file), 'utf8'), kind, base, own)
    if (stray.length) throw new Error(`${relative(process.cwd(), join(dir, file))}: ${JSON.stringify(stray[0])} is outside the base path ${base}`)
  }
  return files.length
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.env.VB_BASE || '/'
  try { console.log(`base path ${base}: ${checkBasePath(process.argv[2] ?? 'dist', base)} files checked, no root path outside it`) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
}
