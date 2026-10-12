import { expect, it } from 'vitest'
import { linkFiles, systemRoot } from './files'
const bytes = (s: string) => new TextEncoder().encode(s)

it('roots and aliases', () => {
  const root = systemRoot(new Map([
    ['design-system/project/tokens.json', bytes('{}')], ['design-system/design-system.json', bytes('{}')],
    ['design-system/project/readme.md', bytes('book')], ['design-system/project/styles.css', bytes('second')],
    ['design-system/project/_ds_bundle.css', bytes('first')], ['design-system/project/components/Panel.prompt.md', bytes('panel')],
    ['design-system/project/Button/usage.md', bytes('button')], ['../escape', bytes('bad')],
  ]))
  expect([...root.files.keys()]).toEqual(['Button/README.md', 'components/bundle.css', 'components/Panel/README.md', 'README.md', 'tokens.json'])
  expect(new TextDecoder().decode(root.files.get('components/bundle.css'))).toBe('first')
  expect(root.notes.join('\n')).toMatch(/styles.css.*alias/)
  expect(root.notes.join('\n')).toMatch(/escape/)
  expect(systemRoot(new Map([['_ds/tokens/base.css', bytes(':root{}')], ['_ds/bundle.js', bytes('')]])).files.has('tokens/base.css')).toBe(true)
})

it('link files', () => {
  expect(linkFiles('https://example.frame.claudeusercontent.com/_f/1/project/tokens.json')).toEqual({
    base: 'https://example.frame.claudeusercontent.com/_f/1/project/',
    paths: ['tokens.json', 'design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'],
  })
  expect(linkFiles('https://example.test/project')).toHaveProperty('base', 'https://example.test/project/')
  expect(linkFiles('https://claude.ai/artifact/x')).toEqual({ single: 'https://claude.ai/artifact/x' })
  for (const url of ['http://example.test/project/', 'file:///project/', 'javascript:alert(1)', 'https://claude.ai/api/x', 'https://claude.ai/%61pi/x', 'https://u:p@example.test/project/']) expect(linkFiles(url)).toHaveProperty('refused')
})

it('the shortest tokens path selects the design-system root', () => {
  for (const preferred of ['tokens.json', 'z/tokens.json']) {
    const root = systemRoot(new Map([
      ['a/nested/tokens.json', bytes('nested')], [preferred, bytes('preferred')],
    ]))
    expect(new TextDecoder().decode(root.files.get('tokens.json'))).toBe('preferred')
    expect(root.notes).toEqual(['a/nested/tokens.json: another design-system root; using ' + preferred])
  }
})

it('a tokens URL gets the same-folder siblings outside project', () => {
  expect(linkFiles('https://files.example/design/tokens.json')).toEqual({ base: 'https://files.example/design/', paths: ['tokens.json', 'design-system.json', 'README.md', 'components/bundle.css', 'components/bundle.js'] })
})
