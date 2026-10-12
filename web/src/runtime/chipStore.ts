// The preview chip's stores, kept on the main thread so a worker restart keeps them (spec §7): persist, wiped when the
// loaded Lua changes and the project says so (off by default: P5 measured 2026-10-11), and chip memory, which survives. IndexedDB is M4.
export class ChipStore {
  persist: Record<string, string> = {}
  memory: (number | string)[] = new Array(512).fill(0)   // a word may be "NaN", "Infinity" or "-Infinity" (ruling P20), handed back as is
  private lastLua: string | null = null

  /** Before a load: a Lua that differs from the last one loaded wipes persist when `wipe`; memory always stays. */
  beforeLoad(lua: string, wipe: boolean) {
    if (wipe && this.lastLua !== null && this.lastLua !== lua) this.persist = {}
    this.lastLua = lua
  }
  /** A status carries the stores only when they changed; a memory that is not 512 words is not taken. */
  update(s: { persist?: Record<string, string> | null; memory?: (number | string)[] | null }) {
    if (s.persist) this.persist = s.persist
    if (s.memory && s.memory.length === 512) this.memory = s.memory
  }
  wipePersist() { this.persist = {} }
}
