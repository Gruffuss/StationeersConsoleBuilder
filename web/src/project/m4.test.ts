import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { beforeAll, expect, it, vi } from 'vitest'
import { loadCatalog } from '../catalog'
import { assembleExport } from '../codegen/export'
import { generate, type Generated } from '../codegen/generate'
import { hostOf } from '../codegen/hostOf'
import { fixtureProjects } from '../codegen/testing'
import type { Project } from '../model/project'
import { printSrc } from '../srctext/print'
import { DEFAULT_THEME, THEMES } from '../theme'
import { compressProject, decompressProject, projectText } from './codec'
import { embeddedToken, readProject } from './input'
import { TEMPLATES, templateProject } from './templates'
import { writeArtifactStamp } from './artifactStamp'

const at = new Date('2026-10-12T00:00:00.000Z')
const output = new URL('../../../.test-artifacts/m4-artifacts/', import.meta.url)
type Pair = { id: string; project: Project; generated: Generated; on: ReturnType<typeof assembleExport>; off: ReturnType<typeof assembleExport> }
let pairs: Pair[] = []
beforeAll(async () => {
  const catalog = await loadCatalog()
  mkdirSync(output, { recursive: true })
  const font = fixtureProjects().natives
  font.name = 'FONT native-only multi-page'
  font.pages[0].scene.defs = [{ op: 'FONT', attrs: { src: 'https://fonts.gstatic.com/direct.ttf' } }]
  font.pages.push({ ...font.pages[0], id: 'p2', name: 'Second', surface: 'second', natives: font.pages[0].natives!.map(n => ({ ...n, uid: n.uid.replace('1', '2') })), scene: {
    ...font.pages[0].scene, defs: [{ op: 'FONT', attrs: { src: 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700' } }] } })
  for (const [id, project] of [...TEMPLATES.map(t => [t.id, templateProject(t.id, DEFAULT_THEME)] as const), ['font-native', font] as const]) {
    const generated = generate(project, pg => printSrc(pg.scene))
    const on = assembleExport(generated, await compressProject(project), at)
    const off = assembleExport(generated, null, at)
    pairs.push({ id, project, generated, on, off })
    const stem = id === 'font-native' ? id : 'template-' + id
    writeFileSync(new URL(stem + '-on.lua', output), on.lua)
    if (id !== 'font-native') writeFileSync(new URL(stem + '-off.lua', output), off.lua)
    writeFileSync(new URL(stem + '.pages.json', output), JSON.stringify(generated.pages))
    writeFileSync(new URL(stem + '.host.json', output), JSON.stringify(hostOf(project, catalog, null).host))
  }
  const artifacts = pairs.flatMap(({ id }) => {
    const stem = id === 'font-native' ? id : 'template-' + id
    return [stem + '-on.lua', ...(id === 'font-native' ? [] : [stem + '-off.lua']), stem + '.host.json', stem + '.pages.json']
  })
  writeArtifactStamp(output, artifacts)
})

it('m4_exact_fourteen_just_generated_template_artifacts', () => {
  expect(pairs.filter(p => p.id !== 'font-native')).toHaveLength(7)
  expect(readdirSync(output).filter(f => /^template-.*\.lua$/.test(f))).toHaveLength(14)
})
it.each(TEMPLATES.map(t => [t.id] as const))('m4_%s_decoded_fields_metadata_preamble_and_manifest', async id => {
  const { project: p, generated: g, on, off } = pairs.find(p => p.id === id)!
  expect(JSON.parse(projectText(readProject(await decompressProject(embeddedToken(on.lua)!)).project))).toEqual(JSON.parse(projectText(p)))
  expect(embeddedToken(off.lua)).toBeNull()
  expect(on.date).toBe(at.toISOString())
  expect(on.lua.split('\n')[0]).toBe(g.lua.split('\n')[0] + ' · builder 0.4.0 · UTC ' + at.toISOString())
  for (const a of [on, off]) {
    expect(a.lua).not.toContain('\r')
    expect(a.lua.slice(a.lua.indexOf('\n'), a.lua.indexOf('-- VectorBuilder runtime'))).toBe(g.lua.slice(g.lua.indexOf('\n'), g.lua.indexOf('-- VectorBuilder runtime')))
    expect(a.lua).toContain('floor = 11118'); expect(a.lua).toContain('lt(ver,11118)')
    expect(a.problems.filter(p => p.level === 'error')).toEqual([])
    expect(a.totalBytes).toBe(new TextEncoder().encode(a.lua).length)
  }
  for (const theme of Object.keys(THEMES)) {
    const themed = templateProject(id, theme), generated = generate(themed, pg => printSrc(pg.scene))
    expect(generated.pages).toEqual(JSON.parse(readFileSync(new URL(`../../test/fixtures/codegen/template-${id}-${theme}.pages.json`, import.meta.url), 'utf8')))
  }
})
it('m4_FONT_native_only_multpage_preserves_defs_without_consent', async () => {
  const pair = pairs.find(p => p.id === 'font-native')!
  const fetch = vi.spyOn(globalThis, 'fetch')
  expect(pair.generated.pages.filter(p => p.id !== '__devices').every(p => p.src.includes('FONT'))).toBe(true)
  const restored = readProject(await decompressProject(embeddedToken(pair.on.lua)!)).project
  expect(JSON.parse(projectText(restored))).toEqual(JSON.parse(projectText(pair.project)))
  expect(restored.pages.map(pg => pg.scene.defs)).toEqual(pair.project.pages.map(pg => pg.scene.defs))
  expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore()
})
it('m4_compression_independent_roundtrip_and_final_genuine_block_wins', async () => {
  const p = fixtureProjects().control
  p.name = 'Unicode 温度 🛰️'
  const older = await compressProject(templateProject('blank'))
  p.customLua = `local false_marker = "--[==[ vectorbuilder:project 1.AAAA ]==]"\n--[==[ vectorbuilder:project ${older} ]==]\n`
  const native = await compressProject(p), alternate = '1.' + gzipSync(projectText(p), { level: 1 }).toString('base64url')
  for (const token of [native, alternate]) {
    const artifact = assembleExport(generate(p, pg => printSrc(pg.scene)), token, at)
    expect(embeddedToken(artifact.lua)).toBe(token)
    expect(projectText(readProject(await decompressProject(embeddedToken(artifact.lua)!)).project)).toBe(projectText(p))
  }
})
