import { readdirSync, readFileSync } from 'node:fs'
import { posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

function valueImports(source: string): string[] {
  const file = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  return file.statements.flatMap(n => {
    if (!ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)) return []
    if (!n.moduleSpecifier || !ts.isStringLiteral(n.moduleSpecifier)) return []
    if (ts.isImportDeclaration(n)) {
      const c = n.importClause
      if (c?.isTypeOnly) return []
      if (c && !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.every(e => e.isTypeOnly)) return []
    } else if (n.isTypeOnly || n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.every(e => e.isTypeOnly)) return []
    return [n.moduleSpecifier.text]
  })
}

it('ignores erased imports and exports, retaining value and side-effect edges', () => {
  expect(valueImports(`import type { A } from './a'; import { type B } from './b';
    export type { C } from './c'; export { type D } from './d';
    import E, { type F } from './e'; import { type G, h } from './h'; import './side';
    export { type I, j } from './j'; export * from './all';`)).toEqual(['./e', './h', './side', './j', './all'])
})

it('has no value-import cycle through widgets/core.ts, model/store.ts or theme/links.ts', () => {
  const src = fileURLToPath(new URL('.', import.meta.url))
  const files = (readdirSync(src, { recursive: true }) as string[]).map(f => f.replace(/\\/g, '/'))
    .filter(f => /\.tsx?$/.test(f) && !f.includes('.test.') && !f.endsWith('.d.ts'))
  const known = new Set(files), graph = new Map(files.map(file => [file, valueImports(readFileSync(src + file, 'utf8')).flatMap(name => {
    if (!name.startsWith('.')) return []
    const path = posix.normalize(posix.join(posix.dirname(file), name))
    const resolved = [path, path + '.ts', path + '.tsx', path + '/index.ts', path + '/index.tsx'].find(f => known.has(f))
    return resolved ? [resolved] : []
  })]))
  const cycles: string[] = []
  for (const root of ['widgets/core.ts', 'model/store.ts', 'theme/links.ts']) {
    const queue = [[root]], seen = new Set([root])
    search: for (let i = 0; i < queue.length; i++) {
      const path = queue[i]
      for (const next of graph.get(path.at(-1)!) ?? []) {
        if (next === root) { cycles.push([...path, root].join('\n  -> ')); break search }
        if (!seen.has(next)) { seen.add(next); queue.push([...path, next]) }
      }
    }
  }
  expect(cycles, cycles.join('\n\n')).toEqual([])
})
