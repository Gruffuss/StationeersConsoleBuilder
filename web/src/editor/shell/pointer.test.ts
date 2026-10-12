import { expect, it, vi } from 'vitest'
import { pointerStore } from './pointer'

it('resets the pointer between tests and notifies mounted consumers', () => {
  const changed = vi.fn(), unsubscribe = pointerStore.subscribe(changed)
  try {
    pointerStore.set({ x: 1, y: 2 })
    pointerStore.reset()
    expect(pointerStore.get()).toBeNull()
    expect(changed).toHaveBeenCalledTimes(2)
  } finally { unsubscribe() }
})
