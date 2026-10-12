import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

it('describes the game connection this build has, and nothing the recordings contradict', () => {
  expect(readme).not.toContain('does not connect to your game')
  expect(readme).not.toContain('not in this build yet')
  // Recorded (s4-list-chips-editor-closed): the game listed 23 chips with no IC editor open.
  expect(readme).not.toMatch(/IC editor must be open/)
  for (const said of ['Show Send to chip (advanced)', 'Game: not linked', 'Use the chip selected in the IC editor', 'Pick a device',
    'AllowedBrowserOrigins', 'restart the game', 'AllowNetworkChipAccess']) expect(readme, said).toContain(said)
})
