import { expect, it } from 'vitest'
import { linkNotSaved, pausedNotSaved, storageNotSaved } from './storageText'

it('a reason that ends a sentence gets no second period', () => {
  for (const end of ['.', '!', '?']) {
    expect(storageNotSaved(`Aborted${end}`, true)).toBe(`Not saved: Aborted${end} Reload will retry the project link.`)
    expect(linkNotSaved(`Bad link${end}`, false)).toBe(`Not saved: Bad link${end} Choose a saved project or Blank.`)
    expect(pausedNotSaved(`Quota${end}`, false)).toBe(`Not saved: Quota${end} Autosave paused; download project JSON to keep your edits.`)
  }
})

it('a reason without an ending gets one period before the next sentence, and stands as it is at the end', () => {
  expect(storageNotSaved('Storage blocked', false)).toBe('Not saved: Storage blocked')
  expect(storageNotSaved('Storage blocked', true)).toBe('Not saved: Storage blocked. Reload will retry the project link.')
  expect(linkNotSaved('Bad link', true)).toBe('Not saved: Bad link. Choose a saved project or Blank. Reload will retry the project link.')
  expect(pausedNotSaved('Quota', true)).toBe('Not saved: Quota. Autosave paused; download project JSON to keep your edits. Reload will retry the project link.')
})
