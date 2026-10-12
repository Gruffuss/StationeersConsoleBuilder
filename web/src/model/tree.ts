import type { SrcNode } from './scene'

export const nodeAt = (nodes: SrcNode[], path: number[]) =>
  path.reduce<SrcNode | undefined>((n, k, i) => (i ? n?.c : nodes)?.[k], undefined)

/** Copy the lists along a path; undefined for an empty or missing path. */
export const replaceAt = (nodes: SrcNode[], path: number[], by: SrcNode): SrcNode[] | undefined => {
  const lists: SrcNode[][] = []
  for (let d = 0, list: SrcNode[] | undefined = nodes; d < path.length; d++) {
    if (!list?.[path[d]]) return undefined
    lists.push(list)
    list = list[path[d]].c
  }
  let x = by
  for (let d = lists.length - 1; d >= 0; d--) {
    const copy = lists[d].map((y, i) => i === path[d] ? x : y)
    if (d === 0) return copy
    x = { ...lists[d - 1][path[d - 1]], c: copy }
  }
  return undefined
}
