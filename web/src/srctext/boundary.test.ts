// The main thread asks the SceneChecker (check.worker.ts) and never validates, prints for the preview or numbers itself:
// those can take long on a crafted scene. Printing a checked scene and walking the written tree are linear, so allowed.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = fileURLToPath(new URL('..', import.meta.url))
const FORBIDDEN = /\b(validateScene|printSrc|parseOrder|indexToPath|pathToIndex|checkScene|trapsOf)\b/

describe('the main thread', () => {
  it('names none of the slow checks outside srctext/, numbering.ts and traps.ts', () => {
    const files = (readdirSync(src, { recursive: true }) as string[]).map(f => f.replace(/\\/g, '/'))
      .filter(f => /\.tsx?$/.test(f) && !f.includes('.test.') && !f.startsWith('srctext/') && f !== 'model/numbering.ts' && f !== 'schema/traps.ts')
    expect(files).toContain('App.tsx')
    const named = files.filter(f => FORBIDDEN.test(readFileSync(src + f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')))
    expect(named).toEqual([])
  })
})
