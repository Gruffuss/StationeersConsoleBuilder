// The game link's status item (M6 Task 10, OQ17 (a)): "Game: <housing name>" or "Game: not linked", and "(no answer)"
// while the game did not answer the link's last request. A click opens the link dialog. Self-contained: the redesign's
// status bar mounts it (hook H3).
import type { GameLink } from '../runtime/gameLink'
import { useLink } from './gameText'
import './game.css'

export function GameLinkStatus({ link, onOpen }: { link: GameLink; onOpen: () => void }) {
  const s = useLink(link)!
  return <button className="btn" type="button" aria-label="Game link" onClick={onOpen}>
    Game: <span className="vb-game-name">{s.linked ? s.linked.name : 'not linked'}{s.problem ? ' (no answer)' : ''}</span>
  </button>
}
