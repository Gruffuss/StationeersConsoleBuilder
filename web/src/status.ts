// The status area under the editor.
import type { Status } from './runtime/bridge'

/**
 * The lines shown, and the lines announced (aria-live): errors are announced, with the core line once the core halted
 * and the run line once the chip halted with an error. A running chip's run line changes its instruction count on every
 * tick, so it is only shown.
 */
export function statusLines(core: string, run: Status | null, errors: string[]) {
  const halted = core.startsWith('halted: ')
  const line = run ? `${run.state}${run.error ? `: ${run.error}` : ''} (${run.instructions} instructions)` : ''
  return {
    shown: [halted ? '' : core, run?.error ? '' : line].filter(Boolean).join('\n'),
    spoken: [halted ? core : '', run?.error ? line : '', ...errors].filter(Boolean).join('\n'),
  }
}

/** A patch's reply carries the chip's own error too (`carried`, from the last load or tick): only another is the patch's. */
export const patchFailure = (s: Status, carried: string | null) => s.error && s.error !== carried ? `patch failed: ${s.error}` : ''
