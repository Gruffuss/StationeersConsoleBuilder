// Generates web/src/catalog/devices.json and enums.json from the game's Stationpedia export and the owner's ic10-devices.md
// (rulings P2, P26, P27: the inputs stay outside the repo; their paths are arguments). Node 24 runs this file directly.
//   node tools/catalog/build.ts --export <the extractor's output folder> --md <ic10-devices.md> [--values <enum-values.json>] [--check]
// The folder holds the extractor's Stationpedia.json and Enums.json. --check writes nothing and exits 1 when the committed
// files differ from what the inputs give. A missing argument or input file exits 2, naming it.
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCatalog, devicesText, enumsText, sameText } from '../../web/src/catalog/parse.ts'

const arg = (k: string) => { const i = process.argv.indexOf(k); return i < 0 ? undefined : process.argv[i + 1] }
const dir = arg('--export'), md = arg('--md'), values = arg('--values')
if (!dir || !md) {
  console.error('usage: node tools/catalog/build.ts --export <folder of Stationpedia.json and Enums.json> --md <ic10-devices.md> [--values <f>] [--check]')
  process.exit(2)
}
try {
  const inputs = [join(dir, 'Stationpedia.json'), join(dir, 'Enums.json'), md, ...values ? [values] : []]
  const missing = inputs.filter(f => !statSync(f, { throwIfNoEntry: false })?.isFile())
  for (const f of missing) console.error(`no such file: ${f}`)
  if (missing.length) process.exit(2)
  const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
  const vanilla = readFileSync(new URL('./vanilla.txt', import.meta.url), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  const out = buildCatalog(json(join(dir, 'Stationpedia.json')), json(join(dir, 'Enums.json')), readFileSync(md, 'utf8'),
    { values: values ? json(values) : undefined, vanilla })
  const files: [URL, string][] = [[new URL('../../web/src/catalog/devices.json', import.meta.url), devicesText(out.devices)],
    [new URL('../../web/src/catalog/enums.json', import.meta.url), enumsText(out.enums)]]
  for (const line of out.summary) console.log(line)
  if (process.argv.includes('--check')) {
    const stale = files.filter(([f, text]) => { try { return !sameText(readFileSync(f, 'utf8'), text) } catch { return true } })
    for (const [f] of stale) console.error(`stale: ${f.pathname}`)
    process.exit(stale.length ? 1 : 0)
  }
  for (const [f, text] of files) writeFileSync(f, text)
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(2)
}
