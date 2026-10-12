// The scene model the src text parses into. Numbers are float32 values (Math.fround), as the mod stores them.
export type Value = number | string | Value[]

/** One node. `attrs` keeps the first occurrence of each key (compared case-insensitively), in written order. */
export interface SrcNode {
  op: string
  attrs: Record<string, Value>
  c?: SrcNode[]          // set when the node has a block, even an empty one
  comments?: string[]    // own-line comments above the node
  eol?: string           // the comment ending the node's line
  tail?: string[]        // comments before the node's own closing }
}

export interface Scene {
  header: Record<string, Value>        // SCENE pairs: w, h, fit, ztext, … (first occurrence of a key wins)
  defs: SrcNode[]
  root: SrcNode[]
  notes?: { header?: string[]; defs?: string[]; defsTail?: string[]; tail?: string[] }   // comments around SCENE / DEFS / at the end
}
