import { describe, expect, it } from 'vitest'
import { SHARE_URL_LIMIT, shareUrl } from './share'

describe('share URLs', () => {
  it('keeps project data in one fragment, retaining the site path and query and replacing the old hash', () => {
    expect(shareUrl('https://example.test/builder/?mode=edit#old', '1.AAAA')).toEqual({ kind: 'link', url: 'https://example.test/builder/?mode=edit#p=1.AAAA' })
    expect(shareUrl('https://example.test/builder?mode=edit#p=old&other=x', '1.A_-0')).toEqual({ kind: 'link', url: 'https://example.test/builder?mode=edit#p=1.A_-0' })
  })
  it('chooses JSON above the 8000-character full-URL threshold without truncating', () => {
    const prefix = 'https://example.test/', fragment = '#p=1.AAAA'
    const base = prefix + 'x'.repeat(8000 - prefix.length - fragment.length)
    expect(SHARE_URL_LIMIT).toBe(8000)
    expect(shareUrl(base, '1.AAAA')).toEqual({ kind: 'link', url: base + fragment })
    expect(shareUrl(base + 'x', '1.AAAA')).toEqual({ kind: 'json', length: 8001 })
    expect(shareUrl(prefix + 'x'.repeat(8000), '1.AAAA')).toEqual({ kind: 'json', length: prefix.length + 8000 + fragment.length })
  })
  it('measures the final normalized absolute URL, including encoded Unicode and existing query', () => {
    const base = 'https://example.test/漢字?mode=edit'
    expect(shareUrl(base, '1.AAAA')).toEqual({ kind: 'link', url: 'https://example.test/%E6%BC%A2%E5%AD%97?mode=edit#p=1.AAAA' })
    const large = 'https://example.test/?query=' + 'x'.repeat(8000)
    expect(shareUrl(large, '1.AAAA')).toEqual({ kind: 'json', length: large.length + '#p=1.AAAA'.length })
  })
  it.each(['', '/builder', 'https://', 'https://[broken', 'not a URL'])('refuses malformed absolute base %j', base => {
    expect(() => shareUrl(base, '1.AAAA')).toThrow()
  })
  it.each(['1.', '2.AAAA', '1xAAAA', '1.AA==', '1.A+A/', '1.AAAA\n', '1.AAAA&p=other', '1.漢字'])('refuses malformed token %j', token => {
    expect(() => shareUrl('https://example.test/', token)).toThrow(/token/i)
  })
})
