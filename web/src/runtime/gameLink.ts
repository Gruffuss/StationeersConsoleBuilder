// The game link (M6 Task 10; OQ14 (a), OQ15 (b), OQ17 (a)): the session points at one chip in the player's running game,
// chosen from the game's chip list or taken from the chip an IC editor has selected. Send writes there, the device picker
// lists that chip's network, and the linked console's screen is offered as the page's shape. The link lives in memory for
// the tab: its ref is kept for requests and never shown; it is shown by its housing name. It asks the game nothing but on
// a call, made because the player clicked.
import { SHAPES, px, type ShapeKind } from '../model/shapes'
import { readChips, readDevices, readEditorState, readNetworks, type ChipRef, type Device, type GameMcp, type ToolAnswer } from './gameMcp'

export type Screen = { surface: string; w: number; h: number }
/** A `list_chips` entry as the link reads it. `on` and `error` are null when the game does not say. */
export type ChipEntry = { ref: ChipRef; name: string; networkId: number | null; screen: Screen | null; lua: boolean; library: boolean;
  on: boolean | null; error: boolean | null }
export type Linked = { ref: ChipRef; name: string; networkId: number | null; screen: Screen | null }
/** linked: the chip; problem: why the last request failed, until one answers; shapeSettled: the shape offer for this link
 *  was taken or set aside. */
export type LinkState = { linked: Linked | null; problem: string | null; shapeSettled: boolean }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const UNNAMED = 'a chip the game gave no name'

/** The chips of a `list_chips` answer, Lua chips that are not libraries first (each group in the game's order); null when
 *  the answer is not a chip list. */
export function chipEntries(a: ToolAnswer): ChipEntry[] | null {
  const chips = readChips(a)
  if (!chips) return null
  const entries = chips.map(({ ref, entry: e }): ChipEntry => {
    const s = e.screen_size
    return { ref, name: typeof e.housing_name === 'string' && e.housing_name ? e.housing_name : UNNAMED,
      networkId: typeof e.network_id === 'number' && Number.isSafeInteger(e.network_id) ? e.network_id : null,
      screen: object(s) && finite(s.w) && finite(s.h) && s.w > 0 && s.h > 0 ? { surface: typeof s.surface === 'string' ? s.surface : '', w: s.w, h: s.h } : null,
      lua: e.is_lua !== false, library: e.is_library === true,
      on: typeof e.is_on === 'boolean' ? e.is_on : null, error: typeof e.has_error === 'boolean' ? e.has_error : null }
  })
  const linkable = (c: ChipEntry) => c.lua && !c.library
  return [...entries.filter(linkable), ...entries.filter(c => !linkable(c))]
}

export type ShapeOffer =
  | { kind: 'one'; shape: ShapeKind; label: string }
  | { kind: 'several'; size: { w: number; h: number }; shapes: { shape: ShapeKind; label: string }[] }
  | { kind: 'custom'; size: { w: number; h: number } }
/** A console's screen as page shapes (OQ15 (b)): its size rounded to whole px as `px()` rounds, matched against each
 *  shape's px; one match, several (shapes that differ only in design units), or none (a custom size of those px). */
export function shapeOffer(screen: Screen | null): ShapeOffer | null {
  if (!screen) return null
  const size = { w: px(screen.w), h: px(screen.h) }
  const shapes = (Object.entries(SHAPES) as [Exclude<ShapeKind, 'custom'>, (typeof SHAPES)[keyof typeof SHAPES]][])
    .filter(([, s]) => s.px.w === size.w && s.px.h === size.h).map(([shape, s]) => ({ shape: shape as ShapeKind, label: s.label }))
  return shapes.length === 1 ? { kind: 'one', ...shapes[0] } : shapes.length ? { kind: 'several', size, shapes } : { kind: 'custom', size }
}

export class GameLink {
  readonly client: GameMcp
  #state: LinkState = { linked: null, problem: null, shapeSettled: false }
  readonly #listeners = new Set<() => void>()
  constructor(client: GameMcp) { this.client = client }

  get state(): LinkState { return this.#state }
  subscribe(f: () => void): () => void { this.#listeners.add(f); return () => { this.#listeners.delete(f) } }
  #set(change: Partial<LinkState>) {
    this.#state = { ...this.#state, ...change }
    for (const f of [...this.#listeners]) f()
  }
  /** Keeps a request's outcome as the link's problem (a failure the game or the browser gave) or clears it. */
  #heard(a: ToolAnswer) {
    // A refusal in the game's words (`Error: …`) is an answer: the game is there. Anything else that failed is kept.
    if (!a.ok && a.why === 'Stopped') return   // the player's Stop says nothing about the game
    const answered = a.ok || (a.texts ?? []).some(t => t.trimStart().startsWith('Error:')) || /^JSON-RPC error/.test(a.why)
    const problem = answered ? null : a.why
    if (problem !== this.#state.problem) this.#set({ problem })
  }

  async listChips(signal: AbortSignal): Promise<{ ok: true; chips: ChipEntry[] } | { ok: false; answer: ToolAnswer }> {
    const answer = await this.client.listChips(signal)
    this.#heard(answer)
    const chips = chipEntries(answer)
    return chips ? { ok: true, chips } : { ok: false, answer }
  }

  linkChip(c: ChipEntry) {
    const same = this.#state.linked?.ref === c.ref
    this.#set({ linked: { ref: c.ref, name: c.name, networkId: c.networkId, screen: c.screen }, shapeSettled: same && this.#state.shapeSettled })
  }

  /** Links the chip selected in an IC editor in the game, named as the game's chip list names it. */
  async linkEditorChip(signal: AbortSignal): Promise<{ ok: true } | { ok: false; why: string; answer?: ToolAnswer }> {
    const state = await this.client.editorState(signal)
    this.#heard(state)
    if (!state.ok) return { ok: false, why: state.why, answer: state }
    const editor = readEditorState(state)
    if (!editor) return { ok: false, why: 'The game\'s editor state could not be read.', answer: state }
    // Only a selected chip counts: the game reported the editor open with nobody at one (recorded, wireless scope).
    if (editor.selectedChip === null) return { ok: false, why: 'No chip is selected in an IC editor in the game.' }
    const listed = await this.listChips(signal)
    if (!listed.ok) return { ok: false, why: listed.answer.ok ? 'The game\'s chip list could not be read.' : listed.answer.why, answer: listed.answer }
    const chip = listed.chips.find(c => c.ref === editor.selectedChip)
    if (!chip) return { ok: false, why: 'The chip selected in the IC editor is not in the game\'s chip list.' }
    if (!chip.lua || chip.library) return { ok: false, why: `${chip.name} is ${chip.library ? 'a Lua library' : 'not a Lua chip'}, so it cannot be linked.` }
    this.linkChip(chip)
    return { ok: true }
  }

  /** The devices the picker offers: the linked chip's network, or every network when there is no link. */
  async devices(signal: AbortSignal): Promise<{ ok: true; devices: Device[] } | { ok: false; answer: ToolAnswer }> {
    const network = this.#state.linked?.networkId ?? null
    const answer = network !== null ? await this.client.networkDevices(network, signal) : await this.client.allNetworkDevices(signal)
    this.#heard(answer)
    const devices = network !== null ? readDevices(answer) : readNetworks(answer)?.flatMap(n => n.devices) ?? null
    return devices ? { ok: true, devices } : { ok: false, answer }
  }

  unlink() { if (this.#state.linked) this.#set({ linked: null, shapeSettled: false }) }
  settleShape() { if (this.#state.linked && !this.#state.shapeSettled) this.#set({ shapeSettled: true }) }
}
