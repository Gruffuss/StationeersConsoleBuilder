// Copies the published .NET core into public/_framework (Vite serves it at /_framework) and the vector examples into
// public/examples. Publish first, into a clean folder, from the repo root:
//   dotnet publish core/Wasm -c Release -p:VectorSrc=<absolute path of core/vendor/vector/> -o core/Wasm/bin/publish
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkPublicPaths } from '../tools/check-public-paths.mjs'

const at = p => fileURLToPath(new URL(p, import.meta.url))
const framework = at('../core/Wasm/bin/publish/wwwroot/_framework'), examples = at('../core/vendor/vector/examples/')
for (const [dir, fix] of [[framework, 'publish the core (command at the top of copy-core.mjs)'], [examples, 'check out core/vendor/vector']])
  if (!existsSync(dir)) { console.error(`copy-core: ${dir} is missing; ${fix}. Nothing was changed.`); process.exit(1) }

const out = at('public/_framework'), outExamples = at('public/examples/')
checkPublicPaths([framework])
rmSync(out, { recursive: true, force: true })  // fingerprinted names change on every publish
rmSync(outExamples, { recursive: true, force: true })
cpSync(framework, out, { recursive: true, filter: f => !/\.(br|gz)$/.test(f) })
mkdirSync(outExamples, { recursive: true })
for (const f of readdirSync(examples)) if (f.endsWith('.lua')) copyFileSync(examples + f, outExamples + f)
