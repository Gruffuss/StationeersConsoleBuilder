import { expect, it } from 'vitest'
import { readable, shownChip } from './gameText'
import { readChips } from '../runtime/gameMcp'

it.each([
  [{ w: 1035.69983, h: 460 }, '2×1'],
  [{ w: 460, h: 460 }, '460×460 px'],
  [{ w: 777, h: 333 }, '777×333 px'],
  [{ w: -1, h: 460 }, ''],
  [null, ''],
])('shows only a console name, screen size and plain error marker (%j)', (screen, size) => {
  const chip = readChips({ ok: true, texts: [JSON.stringify([{ ref_id: 1001, housing_name: 'Control room', is_lua: true, has_error: true, network_id: 3001, screen_size: screen }])], images: [] })![0]
  const result = shownChip(chip, new Map())
  expect(result.name).toBe('Control room')
  expect(result.text).toBe(`Control room${size ? ' · ' + size : ''} · error`)
})

it('leaves out every id and hash field of a JSON answer, at any depth', () => {
  const text = JSON.stringify([{ ref_id: 4001, prefab_hash: -626563514, name_hash: 12345, display_name: null, prefab_name: 'StructureComputer', network_id: 3001,
    nested: { housing_ref_id: 2001, PrefabHash: 77, hashes: [1], device: { referenceId: 9 } } }])
  const out = readable(text, new Map())
  for (const gone of ['4001', '626563514', '12345', '3001', '2001', '77', 'ref_id', 'prefab_hash', 'name_hash', 'network_id', 'PrefabHash', 'referenceId']) expect(out, gone).not.toContain(gone)
  expect(out).toContain('StructureComputer')
})

it('hides a number a plain text names as a chip, device, network, housing, ref, id or hash, known or not', () => {
  const out = readable('Error: no device 55555 on network 3001; chip 1002 (ref_id 1002, housing 2001, id 7, hash -626563514) is busy', new Map([[1002, 'Console B']]))
  for (const gone of ['55555', '3001', '1002', '2001', '626563514']) expect(out, gone).not.toContain(gone)
  expect(out).toContain('chip "Console B"')
  expect(readable('scene "p1": 16 verts, 229 px, rebuilds 2.45/s over 2s', new Map())).toBe('scene "p1": 16 verts, 229 px, rebuilds 2.45/s over 2s')
})
