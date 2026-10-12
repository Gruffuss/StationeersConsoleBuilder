import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import ts from 'typescript'

it('keeps widget tree access independent of the state store', () => {
  for (const file of ['../widgets/core.ts', '../editing/tree.ts']) {
    const imports = ts.preProcessFile(readFileSync(new URL(file, import.meta.url), 'utf8')).importedFiles.map(x => x.fileName)
    expect(imports, file).not.toContain('../model/store')
  }
})
