export const SHARE_URL_LIMIT = 8000

export function shareUrl(base: string, token: string): { kind: 'link'; url: string } | { kind: 'json'; length: number } {
  if (!/^1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid project token')
  const url = new URL(base)
  url.hash = `p=${token}`
  return url.href.length <= SHARE_URL_LIMIT ? { kind: 'link', url: url.href } : { kind: 'json', length: url.href.length }
}
