import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it.each(['invalid JSON', 'drift'])('catalogue CLI reports %s without a stack trace', fault => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-check-'))
  try {
    writeFileSync(join(dir, 'Stationpedia.json'), fault === 'invalid JSON' ? '{' : JSON.stringify({ version: '0.2.6403.27689', pages: [] }))
    const table = { values: { On: { value: 1 } } }
    writeFileSync(join(dir, 'Enums.json'), JSON.stringify({ scriptEnums: { LogicType: table, LogicSlotType: table, LogicBatchMethod: table } }))
    writeFileSync(join(dir, 'devices.md'), 'game v0.2.6403.27689\n## Devices\n### Sensor\n`1`\nLogic: On=RW\n')
    const r = spawnSync(process.execPath, ['../tools/catalog/build.ts', '--export', dir, '--md', join(dir, 'devices.md'), '--check'], { encoding: 'utf8' })
    expect({ status: r.status, signal: r.signal, stderr: r.stderr }).toEqual({ status: 2, signal: null, stderr: expect.any(String) })
    expect(r.stderr.trim().split('\n')).toHaveLength(1)
    expect(r.stderr).toContain(fault === 'invalid JSON' ? 'JSON' : 'Sensor: in the md, not in the export')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 10_000) // measured: 2.139 s full suite; at least 3x headroom
