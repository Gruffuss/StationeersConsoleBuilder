import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import catalog from '../catalog/fonts.json'

const fonts = new URL('../../public/fonts/', import.meta.url)

it('ships a SIL OFL 1.1 licence beside every bundled woff2', () => {
  const files = readdirSync(fonts).filter(f => f.endsWith('.woff2'))
  expect(files).toContain('JetBrainsMono-Regular.woff2')
  expect(files).toContain('JetBrainsMono-Bold.woff2')
  for (const file of files) {
    const family = file.split('-')[0]
    const license = readFileSync(new URL(`OFL-${family}.txt`, fonts), 'utf8')
    expect(license.replace(/\s+/g, ' '), file).toContain('SIL OPEN FONT LICENSE Version 1.1')
  }
})

it('uses local files for all eight private chrome faces without adding a preview face', () => {
  const css = readFileSync(new URL('./fonts.css', import.meta.url), 'utf8')
  const urls = [...css.matchAll(/url\(['"]?(.*?)['"]?\)/g)].map(m => m[1])
  expect(urls).toEqual(['/fonts/Barlow-Regular.woff2', '/fonts/Barlow-Medium.woff2', '/fonts/Barlow-SemiBold.woff2', '/fonts/Barlow-Bold.woff2', '/fonts/BarlowCondensed-SemiBold.woff2', '/fonts/BarlowCondensed-Bold.woff2', '/fonts/JetBrainsMono-Regular.woff2', '/fonts/JetBrainsMono-Bold.woff2'])
  for (const url of urls) expect(existsSync(new URL(url.slice('/fonts/'.length), fonts)), url).toBe(true)
  expect([...css.matchAll(/font-display:\s*swap/g)]).toHaveLength(8)
  expect(catalog.faces.some(f => f.file.startsWith('JetBrainsMono'))).toBe(false)
})

it('loads the three chrome stylesheets before App', () => {
  const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8')
  expect(main.split(/\r?\n/).slice(0, 3)).toEqual(["import './ui/tokens.css'", "import './ui/fonts.css'", "import './ui/base.css'"])
})
