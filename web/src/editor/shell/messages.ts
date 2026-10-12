import type { Status } from '../../runtime/bridge'

export type Level = 'crit' | 'warn' | 'info' | 'ok'
export type Message = { level: Level; source: string; text: string }
export type MessageInput = { storage: string; note: string; notice: string; selected: number; patchError: string; scripts: boolean
  issues: string[]; fontNote: string; problems: readonly { level: 'error' | 'warning' | 'info'; message: string }[]
  traps: readonly { level: 'error' | 'warning' | 'info'; message: string }[]; hostNotes: readonly string[]; frameProblems: string
  core: string; run: Status | null }

export function messagesOf(i: MessageInput): Message[] {
  const messages: Message[] = []
  const add = (level: Level, source: string, text: string) => { if (text) messages.push({ level, source, text }) }
  add(i.storage.startsWith('Saved') ? 'ok' : i.storage === 'Loading saved project…' || i.storage === 'Not saved: changes are waiting for autosave' ? 'info' : 'warn', 'Autosave', i.storage)
  if (i.note !== i.notice) add('info', 'Editing', i.note)
  add('info', 'Edit', i.notice)
  if (i.selected > 0) add('info', 'Selection', `${i.selected + 1} selected (the panel shows the last)`)
  add('crit', 'Preview', i.patchError)
  if (!i.scripts) {
    for (const text of i.issues) add(text.startsWith('info: ') ? 'info' : 'crit', 'Scene check', text)
    if (i.fontNote) add('warn', 'Preview fonts', `Preview fonts: ${i.fontNote}`)
    for (const [source, problems] of [['Script', i.problems], ['Read traps', i.traps]] as const) {
      for (const p of problems) add(p.level === 'error' ? 'crit' : p.level === 'warning' ? 'warn' : 'info', source, `${p.level}: ${p.message}`)
    }
    for (const text of i.hostNotes) add('info', 'Sim', `info: ${text}`)
  }
  for (const text of i.frameProblems.split('\n')) add('warn', 'Renderer', text)
  add(i.core.startsWith('halted: ') ? 'crit' : 'info', 'Core', i.core)
  if (i.run) {
    const r = i.run
    add(r.error ? 'crit' : r.state === 'Running' ? 'ok' : 'info', 'Run', `${r.state}${r.error ? `: ${r.error}` : ''} (${r.instructions} instructions)`)
  }
  return messages
}

export function checkSummary(ms: readonly Message[]): { level: 'ok' | 'warn' | 'crit'; errors: number; warnings: number; text: string } {
  const checked = ms.filter(m => m.source !== 'Autosave'), errors = checked.filter(m => m.level === 'crit').length, warnings = checked.filter(m => m.level === 'warn').length
  const text = [errors ? `${errors} error${errors === 1 ? '' : 's'}` : '', warnings ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')
  return { level: errors ? 'crit' : warnings ? 'warn' : 'ok', errors, warnings, text: text || 'No problems' }
}
