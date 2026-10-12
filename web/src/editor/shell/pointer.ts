import type { Pt } from '../../editing/types'

let point: Pt | null = null
const listeners = new Set<() => void>()
export const pointerStore = {
  reset: () => pointerStore.set(null),
  get: () => point,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  set: (next: Pt | null) => {
    if (point?.x === next?.x && point?.y === next?.y) return
    point = next; for (const listener of listeners) listener()
  },
}
