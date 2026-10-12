// The game link dialog's content (M6 Task 10; OQ14 (a), OQ15 (b), OQ17 (a)): link the session to a chip in the running
// game, from the game's chip list by name or as the chip an IC editor has selected; unlink; and take the linked console's
// screen as the current page's shape. Self-contained: props in, no layout of its own; the redesign's dialog mounts it.
// It asks the game nothing but on a click. No ref, network id or hash is shown.
import { useState } from 'react'
import type { Page } from '../model/project'
import { px } from '../model/shapes'
import type { Action } from '../model/store'
import { shapeOffer, type ChipEntry, type GameLink as Link } from '../runtime/gameLink'
import type { ToolAnswer } from '../runtime/gameMcp'
import { Answer, readable, useAct, useLink, type Names } from './gameText'
import './game.css'

const words = (c: ChipEntry) => [c.on === null ? '' : c.on ? 'on' : 'off', c.error === null ? '' : c.error ? 'has an error' : 'no error',
  c.screen ? `screen ${px(c.screen.w)} × ${px(c.screen.h)} px` : 'no screen',
  c.library ? 'a Lua library, so not linkable' : !c.lua ? 'not a Lua chip, so not linkable' : ''].filter(Boolean).join(', ')

export function GameLink({ link, page, dispatch }: { link: Link; page: Pick<Page, 'id' | 'shape' | 'size'>; dispatch: (a: Action) => void }) {
  const state = useLink(link)!, linked = state.linked
  const [chips, setChips] = useState<ChipEntry[] | null>(null)
  const [failure, setFailure] = useState<{ label: string; answer: ToolAnswer } | null>(null)
  const [note, setNote] = useState('')
  const { busy, act, stop } = useAct()

  const list = () => act(async signal => {
    setFailure(null); setNote('')
    const r = await link.listChips(signal)
    if (r.ok) setChips(r.chips)
    else setFailure({ label: 'List chips (list_chips)', answer: r.answer })
  })
  const fromEditor = () => act(async signal => {
    setFailure(null); setNote('')
    const r = await link.linkEditorChip(signal)
    if (r.ok) return
    if (r.answer && !r.answer.ok) setFailure({ label: 'The chip selected in the IC editor', answer: r.answer })
    else setNote(r.why)
  })

  const names: Names = new Map((chips ?? []).map(c => [c.ref, c.name]))
  if (linked) { names.set(linked.ref, linked.name); if (linked.networkId !== null) names.set(linked.networkId, 'the linked network') }
  const linkable = (chips ?? []).filter(c => c.lua && !c.library)
  const twins = new Set(linkable.map(c => c.name)).size < linkable.length
  const offer = linked && !state.shapeSettled ? shapeOffer(linked.screen) : null
  // The player's click is the only way the page changes: one setPageShape, one undo step.
  const take = (a: Extract<Action, { type: 'setPageShape' }>) => { dispatch(a); link.settleShape() }

  return <section className="vb-game-link" aria-label="Game link">
    <p>{linked ? `Linked to ${linked.name}.` : 'Not linked.'}</p>
    <p>Linking points this session at one chip in your running game: Send writes there, Pick a device lists that chip's
      network, and its console's screen size is offered as the page's shape. The link lasts until this tab closes.</p>
    <div className="vb-game-actions">
    <button className="btn" type="button" aria-label="List chips" disabled={busy} onClick={() => void list()}>List chips</button>
    <button className="btn" type="button" aria-label="Use the chip selected in the IC editor" disabled={busy} onClick={() => void fromEditor()}>Use the chip selected in the IC editor</button>
    <button className="btn" type="button" aria-label="Unlink" disabled={busy || !linked} onClick={() => link.unlink()}>Unlink</button>
    <button className="btn flat" type="button" aria-label="Stop" disabled={!busy} onClick={stop}>Stop</button>
    </div>
    <div aria-live="polite">{busy ? 'Waiting for the game…' : note}</div>
    {failure && <Answer step={failure} names={names} />}
    {!failure && state.problem && <p>The game did not answer the last request: {readable(state.problem, names)}</p>}
    {offer && <div>
      {offer.kind === 'one' ? page.shape === offer.shape ? <p>This page has this console's shape already ({offer.label}).</p>
        : <button className="btn primary" type="button" aria-label={`Use this console's shape: ${offer.label}`}
          onClick={() => take({ type: 'setPageShape', pageId: page.id, shape: offer.shape })}>{`Use this console's shape: ${offer.label}`}</button>
      : offer.kind === 'several' ? <>
        <p>{`This console's screen is ${offer.size.w} × ${offer.size.h} px, the size of several shapes that differ in design units; choose one:`}</p>
        {offer.shapes.map(s => <button className="btn" key={s.shape} type="button" aria-label={`Use this console's shape: ${s.label}`}
          onClick={() => take({ type: 'setPageShape', pageId: page.id, shape: s.shape })}>{`Use this console's shape: ${s.label}`}</button>)}
      </> : <button className="btn primary" type="button" aria-label={`Use this console's size: ${offer.size.w} × ${offer.size.h} px (custom)`}
        onClick={() => take({ type: 'setPageShape', pageId: page.id, shape: 'custom', size: offer.size })}>{`Use this console's size: ${offer.size.w} × ${offer.size.h} px (custom)`}</button>}
      <button className="btn flat" type="button" aria-label="Not now" onClick={() => link.settleShape()}>Not now</button>
      <p>The page's own shape control can change it again at any time.</p>
    </div>}
    {chips && (chips.length ? <ul>
      {chips.map((c, k) => <li key={k}>
        {`${c.name} (${words(c)})`}
        {/* A chip that cannot be linked gets no button: its row's words say why. */}
        {c.lua && !c.library && <button className="btn" type="button" aria-label={`Link ${c.name}`} disabled={busy || linked?.ref === c.ref}
          onClick={() => link.linkChip(c)}>{linked?.ref === c.ref ? 'Linked' : 'Link'}</button>}
      </li>)}
    </ul> : <p>The game listed no chips.</p>)}
    {twins && <p>Some chips show the same name. To tell them apart, give their consoles different names with the Labeller in
      game, then list the chips again.</p>}
  </section>
}
