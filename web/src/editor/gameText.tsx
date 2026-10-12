// What the game-facing panels (Send to chip, the game link, the device picker) share: how a game answer is shown to the
// player, the link's state as a hook, and one pending request at a time with Stop.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Chip, ToolAnswer } from '../runtime/gameMcp'
import type { GameLink, LinkState } from '../runtime/gameLink'
import { shapeOffer } from '../runtime/gameLink'

// Reference ids (a chip's, a device's, a network's) are the game's internal handles: requests carry them, but the player
// never sees one (owner, 2026-10-12). A chip is shown by what else the game says of it; an answer's text loses its id
// fields and its hash fields (a prefab's, a name's), a known id standing alone in a text becomes the name it stands for,
// and any other number a text names as a chip's, device's, network's, housing's, ref, id or hash is hidden.
export const isIdKey = (k: string) => /(^|_)(ids?|ref|hash(es)?)$/i.test(k) || /[a-z](Id|Ids|Ref|Hash|Hashes)$/.test(k)
const REF = /(?<![\d.])\d+(?!\d|\.\d)/g
const NAMED_NUMBER = /\b((?:chips?|devices?|networks?|housings?|ref(?:_id|s)?|reference(?:[ _]?id)?|ids?|hash(?:es)?|prefab_hash|name_hash)\b[\s:=#]*)-?\d+(?![\d.]*\d)/gi
export type Names = Map<number, string>
function withoutIds(v: unknown, names: Names): unknown {
  if (Array.isArray(v)) return v.map(x => withoutIds(x, names))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !isIdKey(k)).map(([k, x]) => [k, withoutIds(x, names)]))
  return typeof v === 'string' ? named(v, names) : v
}
const named = (t: string, names: Names) => t.replace(REF, d => names.has(Number(d)) ? `"${names.get(Number(d))}"` : d).replace(NAMED_NUMBER, '$1(hidden)')
/** A text as the player may read it: a JSON object or list without its id fields, or the text with each known id replaced
 *  by its name. */
export function readable(t: string, names: Names): string {
  let v: unknown
  try { v = JSON.parse(t) } catch { return named(t, names) }
  return v && typeof v === 'object' ? JSON.stringify(withoutIds(v, names), null, t.includes('\n') ? 2 : undefined) : named(t, names)
}
/** A listed console's name, screen size and error marker; game handles stay out of the row. */
export function shownChip(c: Chip, names: Names): { name: string; text: string } {
  const field = c.fields.find(([k, v]) => !isIdKey(k) && /name|label/i.test(k) && v)
  const name = field ? readable(field[1], names) : 'a chip the game gave no name'
  const s = c.entry.screen_size as { w?: unknown; h?: unknown } | null
  const offer = s && typeof s.w === 'number' && typeof s.h === 'number' && Number.isFinite(s.w) && Number.isFinite(s.h) && s.w > 0 && s.h > 0
    ? shapeOffer({ surface: '', w: s.w, h: s.h }) : null
  const size = offer?.kind === 'one' ? offer.label : offer ? `${offer.size.w}×${offer.size.h} px` : ''
  return { name, text: [name, size, c.entry.has_error === true ? 'error' : ''].filter(Boolean).join(' · ') }
}

export type Step = { label: string; answer: ToolAnswer }
// An answer keeps its line breaks and wraps long lines inside whatever holds it (a dialog, a panel).
export const WRAP = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } as const
export function Answer({ step, names }: { step: Step; names: Names }) {
  const { label, answer: a } = step, texts = a.texts ?? []
  return <div>
    <div>{label}: {a.ok ? 'done' : 'failed'}</div>
    {!a.ok && !texts.includes(a.why) && <pre style={WRAP}>{readable(a.why, names)}</pre>}
    {texts.map((t, k) => <pre key={k} style={WRAP}>{readable(t, names)}</pre>)}
    {a.ok && a.images.map((im, k) => <img key={k} src={`data:${im.mime};base64,${im.data}`} alt={`${label}, image ${k + 1}`} />)}
  </div>
}

const NONE = () => () => {}
/** The link's state, re-rendering on each change; null without a link. */
export function useLink(link: GameLink | undefined): LinkState | null {
  return useSyncExternalStore(link ? f => link.subscribe(f) : NONE, () => link?.state ?? null)
}

/** One request at a time: `act` runs work with a signal, `stop` aborts it, `busy` while it runs; unmounting aborts it. */
export function useAct() {
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort(); pending.current = null }, [])
  const act = useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return
    const stop = new AbortController()
    pending.current = stop; setBusy(true)
    try { await work(stop.signal) } finally {
      if (pending.current === stop) { pending.current = null; setBusy(false) }
    }
  }, [])
  return { busy, act, stop: () => pending.current?.abort() }
}
