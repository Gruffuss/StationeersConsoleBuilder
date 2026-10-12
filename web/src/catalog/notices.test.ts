import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'

// Line endings follow the checkout (core.autocrlf on Windows), so compare text with LF line endings.
const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const notices = () => read('THIRD-PARTY-NOTICES.md')

it('licenses the project under MIT with the owner\'s holder line', () => {
  const licence = read('LICENSE')
  expect(licence.startsWith('MIT License\n\nCopyright (c) 2026 Gruffus\n')).toBe(true)
  expect(licence).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
})
it('ships the same notices on the site as in the repository', () => {
  expect(read('web/public/THIRD-PARTY-NOTICES.txt')).toBe(notices())
})
it('names every npm package the site bundles, at its locked version', () => {
  const lock = JSON.parse(read('web/package-lock.json')) as { packages: Record<string, { version?: string; dev?: boolean }> }
  const bundled = Object.entries(lock.packages).filter(([path, p]) => path && !p.dev)
  expect(bundled.length).toBeGreaterThan(0)
  for (const [path, p] of bundled) expect(notices(), path).toContain(`${path.replace(/^.*node_modules\//, '')} ${p.version}`)
})
it('carries the copyright notices of the vendored sources and the bundled fonts', () => {
  for (const vendor of ['lua-csharp', 'vector']) {
    const line = read(`core/vendor/${vendor}/LICENSE`).split('\n').find(l => l.startsWith('Copyright'))!
    expect(notices(), vendor).toContain(line.trim())
  }
  const fonts = readdirSync(new URL('../../public/fonts/', import.meta.url)).filter(f => f.startsWith('OFL-'))
  expect(fonts.length).toBeGreaterThan(0)
  for (const ofl of fonts) {
    expect(notices(), ofl).toContain(`fonts/${ofl}`)
    const first = read(`web/public/fonts/${ofl}`).split(/\r?\n/)[0].trim()
    expect(notices(), ofl).toContain(first)
  }
})
