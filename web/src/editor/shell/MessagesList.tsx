import type { Message } from './messages'

export function MessagesList({ messages }: { messages: readonly Message[] }) {
  return <ul className="vb-message-list">{messages.map((m, k) => <li key={k}>
    <span className={'chip ' + m.level}>{m.level.toUpperCase()}</span><span className="unit">{m.source}</span><span className={m.level === 'crit' ? 't-crit' : undefined}>{m.text}</span>
  </li>)}</ul>
}
