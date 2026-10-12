import { expect, it } from 'vitest'
import { newPage, newProject, type Project } from '../model/project'
import { printChecked } from '../srctext/print'
import { exportScenes, generate } from './generate'

const generated = (p: Project) => generate(p, pg => printChecked(pg.scene)).pages.map(pg => pg.id)

it('names the vector scenes an export draws: one per page, and the Devices page when a role scans', () => {
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
