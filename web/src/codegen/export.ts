import { BUILDER_VERSION } from '../version'
import type { Generated } from './generate'
import type { MapEntry, Problem } from './linemap'

export type ExportArtifact = { lua: string; map: MapEntry[]; problems: Problem[]; embeddedBytes: number; totalBytes: number; date: string }

export function assembleExport(g: Generated, token: string | null, at: Date, version = BUILDER_VERSION): ExportArtifact {
  if (!version.trim() || /[\r\n\u0085\u2028\u2029]/.test(version)) throw new Error('invalid builder version')
  if (!Number.isFinite(at.getTime())) throw new Error('invalid export date')
  if (token !== null && !/^1\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid project token')
  const date = at.toISOString()
  if (!g.lua) return { lua: '', map: [], problems: g.problems.length ? g.problems : [{ level: 'error', message: 'no script was generated' }], date, embeddedBytes: 0, totalBytes: 0 }
  const firstEnd = g.lua.indexOf('\n')
  if (firstEnd < 0 || !g.lua.startsWith('-- VectorBuilder export')) throw new Error('missing generator header')
  const header = g.lua.slice(0, firstEnd) + ` · builder ${version} · UTC ${date}`
  const block = token === null ? '' : `--[==[ vectorbuilder:project ${token} ]==]\n`
  const lua = header + g.lua.slice(firstEnd) + block
  return { lua, map: g.map, problems: g.problems, date,
    embeddedBytes: new TextEncoder().encode(block).length,
    totalBytes: new TextEncoder().encode(lua).length }
}
