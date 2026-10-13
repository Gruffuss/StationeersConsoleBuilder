import { expect, it } from 'vitest'
import { newPage, newProject, type Project } from '../model/project'
import { printChecked } from '../srctext/print'
import { exportScenes, generate } from './generate'

const generated = (p: Project) => generate(p, pg => printChecked(pg.scene)).pages.filter(pg => !pg.empty).map(pg => pg.id)

it('names only the vector scenes an export draws, including Devices when a role scans', () => {
  const plain = newProject()
  expect(exportScenes(plain)).toEqual(generated(plain))
  const two = newProject(); two.pages.push(newPage(two))
  expect(exportScenes(two)).toEqual(generated(two))
  const scanning = newProject(); scanning.roles = [{ id: 'gas', name: 'Gas', prefabs: ['StructureGasSensor'], mode: 'one' }]
  expect(exportScenes(scanning)).toEqual(generated(scanning))
  expect(exportScenes(scanning)).toContain('vb_devices')
  const pinned = newProject(); pinned.roles = [{ id: 'gas', name: 'Gas', prefabs: [], mode: 'one', pin: 0 }]
  expect(exportScenes(pinned)).toEqual(generated(pinned))
  expect(exportScenes(pinned)).not.toContain('vb_devices')
})

it('counts no scene for blank or natives-only pages and counts the first node and FONT defs', () => {
  const p = newProject()
  expect(exportScenes(p)).toEqual([])
  p.pages[0].natives = [{ type: 'icon', uid: 'ico1', params: {} }]
  expect(exportScenes(p)).toEqual([])
  p.pages[0].scene.root = [{ op: 'R', attrs: { w: 10, h: 10 } }]
  expect(exportScenes(p)).toEqual(['p1'])
  p.pages[0].scene.root = []
  p.pages[0].scene.defs = [{ op: 'fOnT', attrs: { src: 'https://fonts.gstatic.com/direct.ttf' } }]
  expect(exportScenes(p)).toEqual(['p1'])
})
