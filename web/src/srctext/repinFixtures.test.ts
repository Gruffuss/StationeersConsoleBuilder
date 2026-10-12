import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseSrc } from './parse'
import { checkScene } from './check'

it.each(['repin-colours', 'repin-edges'])('%s observation page passes the editor parser and validator', name => {
  const source = readFileSync(new URL('../../test/fixtures/frames/' + name + '.src', import.meta.url), 'utf8')
  const parsed = parseSrc(source)
  expect(parsed.errors).toEqual([])
  expect(parsed.scene).not.toBeNull()
  const checked = checkScene(parsed.scene!)
  expect(checked.errors).toEqual([])
  expect(checked.src).not.toBeNull()
})
