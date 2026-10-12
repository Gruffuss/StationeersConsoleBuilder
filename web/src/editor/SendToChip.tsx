// Send to chip: pushes the checked export to a chip in the player's running game, then reads `vector_stats` and a capture
// of that chip, through the game's MCP endpoint (runtime/gameMcp.ts). The chip is the game link's when one exists (M6 Task
// 10), otherwise one the player picks from the game's list here. Self-contained: props in, no layout of its own. It asks
// the game nothing but on a click, and keeps nothing: chips, refs and answers live in this panel only.
import { useId, useState, type ReactNode } from 'react'
import { GameMcp, gameEndpoint, readChips, statsFor, type Chip, type ChipRef, type ToolAnswer } from '../runtime/gameMcp'
import type { GameLink } from '../runtime/gameLink'
import { Answer, readable, shownChip, useAct, useLink, WRAP, type Names, type Step } from './gameText'
import './game.css'

const PUSH = 'Push (set_chip_code)', STATS = 'Stats (vector_stats)', CAPTURE = 'Capture (capture_scripted_screen)'

/** A step said in words: done with `children`, or failed with the game's reason; the raw answer (ids left out) stays
 *  behind Details, for a bug report. */
function Worded({ step, names, children }: { step: Step; names: Names; children: ReactNode }) {
  const a = step.answer, raw = a.texts ?? []
  return <div>
    <div>{step.label}: {a.ok ? 'done' : 'failed'}</div>
    {a.ok ? children : <p style={WRAP}>{readable(a.why, names)}</p>}
    {a.ok && a.images.map((im, k) => <img key={k} src={`data:${im.mime};base64,${im.data}`} alt={`${step.label}, image ${k + 1}`} />)}
    {raw.length > 0 && <details><summary>Details</summary>{raw.map((t, k) => <pre key={k} style={WRAP}>{readable(t, names)}</pre>)}</details>}
  </div>
}

type Shot = { surface: string; w: number; h: number; path: string }
/** The captures a `capture_scripted_screen` answer names (recorded: one `path`, or a `captures` list with `all`). */
function shotsOf(texts: readonly string[]): Shot[] {
  const out: Shot[] = []
  const take = (v: Record<string, unknown>) => {
    if (typeof v.path === 'string') out.push({ surface: typeof v.surface === 'string' ? v.surface : '', w: Number(v.width), h: Number(v.height), path: v.path })
  }
  for (const t of texts) {
    let v: unknown
    try { v = JSON.parse(t) } catch { continue }
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    take(o)
    if (Array.isArray(o.captures)) for (const c of o.captures) if (c && typeof c === 'object') take(c as Record<string, unknown>)
  }
  return out
}

/** The stats step: the game's report covers every vector scene in the world (recorded), so only the pushed script's own
 *  scenes are shown, under the mod's version line. */
function Stats({ answer, scenes, names }: { answer: Extract<ToolAnswer, { ok: true }>; scenes: readonly string[]; names: Names }) {
  const r = statsFor(answer.texts.join('\n'), scenes)
  return <div>
    <div>{STATS}: done</div>
    {r.version && <div className="unit">{r.version}</div>}
    {r.scenes.length ? r.scenes.map(s => <pre key={s.scene} style={WRAP}>{readable(s.text, names)}</pre>)
      : <p>No scene of this script is in the game's report yet. Read the stats again once the script has run.</p>}
  </div>
}

/** Whether the IC editor took the pushed code, in words, from a `set_chip_code` answer (OQ16 (a): `editor_then_chip`). */
function synced(a: ToolAnswer): string | null {
  if (!a.ok) return null
  for (const t of a.texts) {
    let v: unknown
    try { v = JSON.parse(t) } catch { continue }
    if (!v || typeof v !== 'object') continue
    const r = v as { editor_synced?: unknown; editor_sync_reason?: unknown }
    if (r.editor_synced === true) return 'The IC editor showing this chip shows the new code too.'
    if (r.editor_synced === false) {
      const why = typeof r.editor_sync_reason === 'string' ? r.editor_sync_reason.trim() : ''
      return why ? `The IC editor was not updated: ${why}${/[.!?]$/.test(why) ? '' : '.'}` : 'The IC editor was not updated.'
    }
  }
  return null
}

/** `artifact.scenes`: the vector scene ids the script draws (its pages', and the Devices page's when generated). */
export function SendToChip({ artifact, client, link, origin }: { artifact: { lua: string; name: string; scenes: readonly string[] } | null; client?: GameMcp; link?: GameLink; origin?: string }) {
  const here = origin ?? globalThis.location?.origin ?? ''
  const [own] = useState(() => client || link ? null : new GameMcp({ endpoint: gameEndpoint(), origin: here }))
  const game = link?.client ?? client ?? own!
  const linked = useLink(link)?.linked ?? null
  const group = useId()
  const [chips, setChips] = useState<{ answer: ToolAnswer; list: Chip[] | null } | null>(null)
  const [picked, setPicked] = useState<ChipRef | null>(null)
  const [sent, setSent] = useState<{ ref: ChipRef; name: string; scenes: readonly string[]; steps: Step[] } | null>(null)
  const { busy, act, stop } = useAct()

  const list = () => act(async signal => {
    const answer = await game.listChips(signal), found = readChips(answer)
    setChips({ answer, list: found })
    setPicked(p => found?.some(c => c.ref === p) ? p : null)
  })

  const send = () => {
    const ref = linked?.ref ?? picked
    if (!artifact || ref === null) return
    const lua = artifact.lua, scenes = artifact.scenes, name = linked?.name ?? names.get(ref) ?? 'the chosen chip'
    return act(async signal => {
      const steps: Step[] = []
      const show = (label: string, answer: ToolAnswer) => { steps.push({ label, answer }); setSent({ ref, name, scenes, steps: [...steps] }) }
      setSent({ ref, name, scenes, steps: [] })
      const set = await game.setChipCode(ref, lua, signal, 'editor_then_chip')
      show(PUSH, set)
      if (!set.ok) return
      const stats = await game.vectorStats(signal)
      show(STATS, stats)
      if (!stats.ok) return
      show(CAPTURE, await game.capture(ref, signal))
    })
  }

  /** Asks one tool again, putting its answer in place of that step's. */
  const again = (label: string, ask: (ref: ChipRef, signal: AbortSignal) => Promise<ToolAnswer>) => {
    if (!sent) return
    const ref = sent.ref
    return act(async signal => {
      const answer = await ask(ref, signal)
      // In its own place, so the steps keep the order they ran in.
      setSent(s => s && s.ref === ref ? { ...s, steps: s.steps.map(x => x.label === label ? { label, answer } : x) } : s)
    })
  }

  const landed = !!sent?.steps[0]?.answer.ok
  const listed = chips?.list?.map(c => ({ chip: c, ...shownChip(c, new Map()) })) ?? []
  const names: Names = new Map(listed.map(s => [s.chip.ref, s.name]))
  if (linked) names.set(linked.ref, linked.name)
  if (sent) names.set(sent.ref, sent.name)
  const sync = sent?.steps[0] && synced(sent.steps[0].answer)
  // Send pushes a Lua script: a chip the game reports as not Lua (an IC10 chip) or as a Lua library is not offered.
  const shown = listed.filter(({ chip }) => !chip.fields.some(([k, v]) => k === 'is_lua' && v === 'false' || k === 'is_library' && v === 'true'))
  const skipped = listed.length - shown.length
  const twins = new Set(shown.map(s => s.name)).size < shown.length
  return <section className="vb-send" aria-label="Send to chip">
    <p>Send to chip pushes the checked script to a chip in your running game through StationeersLua's MCP endpoint ({game.endpoint}).
      Send replaces the chip's program; its current code is not kept.</p>
    <p>{artifact ? `Ready: the checked script of "${artifact.name}".` : 'Check export first: Send pushes only the checked script that Download and Copy give.'}</p>
    {linked ? <p>Sends to {linked.name}, the linked chip.</p> : <>
    <div className="vb-game-actions"><button className="btn" type="button" aria-label="List chips" disabled={busy} onClick={() => void list()}>List chips</button></div>
    {chips && (chips.list
      ? chips.list.length
        ? <fieldset>
          <legend>Chips</legend>
          {skipped > 0 && <p>{skipped} listed chips are not offered: Send pushes a Lua script, so it leaves out the chips the
            game reports as not Lua (is_lua false) or as Lua libraries (is_library true).</p>}
          {shown.map(({ chip, text }, k) => <label key={k}>
            <input type="radio" name={group} value={k} aria-label={text} checked={picked === chip.ref} disabled={busy}
              onChange={() => setPicked(chip.ref)} />
            {text}
          </label>)}
          {twins && <p>Some chips show the same name. To tell them apart, give their consoles different names with the
            Labeller in game, then list the chips again.</p>}
        </fieldset>
        : <div>The game listed no chips.</div>
      : <Answer step={{ label: 'List chips (list_chips)', answer: chips.answer }} names={names} />)}
    </>}
    <div className="vb-game-actions">
      <button className="btn primary" type="button" aria-label="Send to the chosen chip" disabled={busy || !artifact || (linked ? false : picked === null)} onClick={() => void send()}>Send</button>
      <button className="btn flat" type="button" aria-label="Stop" disabled={!busy} onClick={stop}>Stop</button>
    </div>
    <div aria-live="polite">{busy ? 'Waiting for the game…' : ''}</div>
    {sent && <div>
      {/* "Sent" only once the push landed; while it runs, or when it failed or was stopped, the line says so. */}
      <div>{!sent.steps.length ? `Sending to ${sent.name}…` : landed ? `Sent to ${sent.name}.` : `Not sent to ${sent.name}.`}</div>
      <div className="vb-send-steps">{sent.steps.map(s => s.label === STATS ? s.answer.ok
        ? <Stats key={s.label} answer={s.answer} scenes={sent.scenes} names={names} /> : <Answer key={s.label} step={s} names={names} />
        : s.label === PUSH ? <Worded key={s.label} step={s} names={names}><p>The chip took the script.</p>{sync && <p>{sync}</p>}</Worded>
        : <Worded key={s.label} step={s} names={names}>{s.answer.ok && shotsOf(s.answer.texts).map((c, k) => <div key={k}>
          <p>{`The game saved a capture of ${c.surface || 'the screen'}${Number.isFinite(c.w) && Number.isFinite(c.h) ? ` (${c.w} × ${c.h} px)` : ''} to:`}</p>
          {/* The game's own file path: a name and a time, never an id (recorded form ss-screen-<housing>-<surface>-<date>-<time>.png). */}
          <code style={WRAP}>{c.path}</code></div>)}</Worded>)}</div>
      {landed && <>
        <p>vector_stats reports the last build that landed: if the new script had not landed yet, read the stats again.</p>
        <p>The game saves each capture as a PNG file on this computer and answers with its path: open that file to look at
          it, since this page cannot.</p>
        <div className="vb-game-actions"><button className="btn" type="button" aria-label="Read stats again" disabled={busy} onClick={() => void again(STATS, (_ref, signal) => game.vectorStats(signal))}>Read stats again</button>
        <button className="btn" type="button" aria-label="Capture again" disabled={busy} onClick={() => void again(CAPTURE, (ref, signal) => game.capture(ref, signal))}>Capture again</button></div>
      </>}
    </div>}
    <details>
      <summary>Setting up the game</summary>
      <p>In StationeersLua's mod settings, under [MCP Server], set Enabled = true and add this page's origin, {here}, to
        AllowedBrowserOrigins, then restart the game: a change to that list took effect only after a restart. While the
        game is starting it may answer "Request timed out waiting for game thread"; try again once your world is loaded.
        The browser may ask to allow access to devices on your local network.</p>
      <p>Which chips List chips shows is the game's choice, set by StationeersLua's chip-access settings: its own
        description names the IC editor's selected chip, a Wireless Development Board with AllowNetworkChipAccess, and worn
        gear with AllowPersonalAreaNetworkChipAccess. One game with no IC editor open listed every chip on its network.
        A chip that is not listed cannot be sent to.</p>
    </details>
  </section>
}
