// The "Not saved" messages of autosave (spec §8). A reason comes from a browser or a link reader and may end its own
// sentence: it never gets a second period.
const ended = (reason: string) => /[.!?]$/.test(reason) ? reason : reason + '.'
const RETRY = ' Reload will retry the project link.'

/** A project link that could not be read at start-up. */
export const linkNotSaved = (error: string, retry: boolean) => 'Not saved: ' + ended(error) + ' Choose a saved project or Blank.' + (retry ? RETRY : '')
/** Browser storage unavailable at start-up: the reason stands as it is unless a sentence follows it. */
export const storageNotSaved = (reason: string, retry: boolean) => 'Not saved: ' + (retry ? ended(reason) + RETRY : reason)
/** A save that failed: autosave pauses. */
export const pausedNotSaved = (reason: string, retry: boolean) =>
  'Not saved: ' + ended(reason) + ' Autosave paused; download project JSON to keep your edits.' + (retry ? RETRY : '')
