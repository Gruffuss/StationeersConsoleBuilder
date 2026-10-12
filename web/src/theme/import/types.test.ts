import { expect, it } from 'vitest'
import { finite, safePath } from './types'
it('reader boundary primitives', () => {
  expect(finite(1e39)).toBe(false)
  expect(finite(1)).toBe(true)
  expect(safePath('a\\b')).toBe('a/b')
  for (const path of ['../a', '/a', 'C:/a', 'a/../b', 'a\u0000b']) expect(safePath(path)).toBeUndefined()
})
