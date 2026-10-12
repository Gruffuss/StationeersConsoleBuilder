import { useEffect, useRef } from 'react'

export const filename = (name: string, extension: string) => {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/, '').trim() || 'console'
  return (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(clean) ? '_' : '') + clean + extension
}

export function useDownloads() {
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>()), live = useRef(false)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      for (const [url, timer] of urls.current) { clearTimeout(timer); URL.revokeObjectURL(url) }
      urls.current.clear()
    }
  }, [])
  return (text: string, name: string, type: string) => {
    if (!live.current) return
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type }))
    a.href = url; a.download = name
    try { a.click() } finally {
      urls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000))
    }
  }
}
