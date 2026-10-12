import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'

// Any absolute local path, wherever the checkout or the account lives:
// - a drive letter, then a slash or backslashes (doubled by each escape: 2 in a string, 4 in a string inside a string),
//   then two path segments. A drive letter
//   preceded by a letter or digit is part of a word (a URL scheme such as https:// never matches), and two segments
//   keep an object key before a regex literal (a:/x/) and random bytes in fonts or assemblies from matching;
// - a UNC share, \\host\share\, escaped any number of times (\\\\host\\share\\ once): each separator the same run of
//   backslashes and the lead twice that run; an escaped regex such as \\d+\\. is no share;
// - a home folder: /home/<name>, /Users/<name> or /root/, not inside a URL path or a longer name.
// Kept from before: the account folder names; and a worktrees folder anywhere in a path, relative or absolute (where git
// worktrees are commonly kept).
const drive = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\+|\/)[\w.$~ ()-]+(?:\\+|\/)[\w.$~()-]/
const unc = /(?<![\\\w])(\\+)\1[A-Za-z0-9][\w.-]*\1[\w$.-]+\1/
// Emscripten's virtual /home/web_user is public runtime code, not a build account.
const home = /(?<![\w.~-])\/(?:home\/(?!web_user(?:[\/'"]|$))[\w.-]+|Users\/[\w.-]+|root\/)/
// A bare "/Users/" or "/home/" with no name after it is prose about these patterns, not a path.
const named = /[a-z]:(?:\\+|\/)Users(?:\\+|\/)|OneDrive|(?:\\+|\/)worktrees(?:\\+|\/)/i
// Allowed, each with its reason. The .NET WebAssembly SDK's own install folder: emscripten writes its include paths into
// dotnet.native.js and the wasm's name section when the core is published. It names no account, checkout or machine.
const allowed = [/[A-Za-z]:(?:\\+|\/)Program Files(?:\\+|\/)dotnet(?:\\+|\/)/g]

/** The first local path in `text`, or undefined. */
export function localPath(text) {
  for (const a of allowed) text = text.replace(a, '')
  for (const re of [named, drive, unc, home]) { const m = re.exec(text); if (m) return m[0] }
}

export function checkPublicPaths(roots) {
  const pending = roots.filter(existsSync)
  let files = 0
  while (pending.length) {
    const path = pending.pop()
    if (statSync(path).isDirectory()) { pending.push(...readdirSync(path).map(name => resolve(path, name))); continue }
    const raw = readFileSync(path)
    const bytes = path.endsWith('.gz') ? gunzipSync(raw) : path.endsWith('.br') ? brotliDecompressSync(raw) : raw
    // Removing NULs exposes UTF-16 ASCII path markers at either byte alignment too.
    const found = localPath(bytes.toString('utf8').replace(/\0/g, ''))
    if (found !== undefined) throw new Error(`local path in ${relative(process.cwd(), path)}: ${JSON.stringify(found)}`)
    files++
  }
  return files
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`public paths: ${checkPublicPaths(process.argv.slice(2))} files checked, zero local paths`) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
}
