import { expect, it } from 'vitest'
import { checkSummary, messagesOf, type MessageInput, type Message } from './messages'

const input = (more: Partial<MessageInput> = {}): MessageInput => ({ storage: '', note: '', notice: '', selected: 0, patchError: '', scripts: false, issues: [], fontNote: '', problems: [], traps: [], hostNotes: [], frameProblems: '', core: '', run: null, ...more })
const m = (level: Message['level'], source: string, text: string): Message => ({ level, source, text })

it.each([
  ['Saved', 'ok'], ['Saved locally', 'ok'], ['Loading saved project…', 'info'],
  ['Not saved: changes are waiting for autosave', 'info'], ['Not saved: storage unavailable', 'warn'],
] as const)('levels autosave %s as %s', (storage, level) => expect(messagesOf(input({ storage }))).toEqual([m(level, 'Autosave', storage)]))

it('keeps every status line in order with its original text and source', () => {
  expect(messagesOf(input({ storage: 'Saved', note: 'editing', notice: 'notice', selected: 2, patchError: 'patch failed',
    issues: ['bad scene', 'info: scene note'], fontNote: 'missing face', problems: [{ level: 'error', message: 'bad script' }, { level: 'warning', message: 'script warning' }, { level: 'info', message: 'script info' }],
    traps: [{ level: 'error', message: 'bad trap' }, { level: 'warning', message: 'trap warning' }, { level: 'info', message: 'trap info' }], hostNotes: ['host note'], frameProblems: 'frame one\n\nframe two', core: 'halted: core failed',
    run: { state: 'Halted', error: 'run failed', instructions: 12, output: [] },
  }))).toEqual([
    m('ok', 'Autosave', 'Saved'), m('info', 'Editing', 'editing'), m('info', 'Edit', 'notice'), m('info', 'Selection', '3 selected (the panel shows the last)'), m('crit', 'Preview', 'patch failed'),
    m('crit', 'Scene check', 'bad scene'), m('info', 'Scene check', 'info: scene note'), m('warn', 'Preview fonts', 'Preview fonts: missing face'),
    m('crit', 'Script', 'error: bad script'), m('warn', 'Script', 'warning: script warning'), m('info', 'Script', 'info: script info'),
    m('crit', 'Read traps', 'error: bad trap'), m('warn', 'Read traps', 'warning: trap warning'), m('info', 'Read traps', 'info: trap info'), m('info', 'Sim', 'info: host note'),
    m('warn', 'Renderer', 'frame one'), m('warn', 'Renderer', 'frame two'), m('crit', 'Core', 'halted: core failed'), m('crit', 'Run', 'Halted: run failed (12 instructions)'),
  ])
})

it('omits empty inputs and duplicate notes; script mode omits only its scene and generation diagnostics', () => {
  expect(messagesOf(input())).toEqual([])
  expect(messagesOf(input({ note: 'same', notice: 'same' }))).toEqual([m('info', 'Edit', 'same')])
  expect(messagesOf(input({ scripts: true, issues: ['scene'], fontNote: 'font', problems: [{ level: 'error', message: 'script' }], traps: [{ level: 'error', message: 'trap' }], hostNotes: ['host'], patchError: 'patch', frameProblems: 'frame' }))).toEqual([m('crit', 'Preview', 'patch'), m('warn', 'Renderer', 'frame')])
})

it('levels core and run states by their origin', () => {
  expect(messagesOf(input({ core: 'ready', run: { state: 'Running', error: null, instructions: 42, output: [] } }))).toEqual([m('info', 'Core', 'ready'), m('ok', 'Run', 'Running (42 instructions)')])
  expect(messagesOf(input({ run: { state: 'Halted', error: null, instructions: 0, output: [] } }))).toEqual([m('info', 'Run', 'Halted (0 instructions)')])
  expect(messagesOf(input({ run: { state: 'Running', error: 'failure', instructions: 1, output: [] } }))[0].level).toBe('crit')
})

it.each([
  [[], { level: 'ok', errors: 0, warnings: 0, text: 'No problems' }],
  [[m('crit', 'Core', 'x')], { level: 'crit', errors: 1, warnings: 0, text: '1 error' }],
  [[m('warn', 'Renderer', 'x'), m('warn', 'Script', 'y')], { level: 'warn', errors: 0, warnings: 2, text: '2 warnings' }],
  [[m('crit', 'Core', 'x'), m('warn', 'Script', 'y')], { level: 'crit', errors: 1, warnings: 1, text: '1 error · 1 warning' }],
  [[m('warn', 'Autosave', 'x'), m('info', 'Edit', 'y'), m('ok', 'Run', 'z')], { level: 'ok', errors: 0, warnings: 0, text: 'No problems' }],
] as const)('summarizes messages %#', (messages, summary) => expect(checkSummary(messages)).toEqual(summary))
