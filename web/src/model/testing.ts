// Test helpers, imported by tests only.
import type { SrcNode, Value } from './scene'

/** A node; `c` given means it has a block. */
export const node = (op: string, attrs: Record<string, Value> = {}, c?: SrcNode[]): SrcNode => ({ op, attrs, ...(c && { c }) })
