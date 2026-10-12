import { useState } from 'react'
import type { Project } from '../../model/project'
import { devicesName } from '../../codegen/devicesPage'

export function DevicesRow(p: { project: Project; play: boolean; active: string; problems: readonly { level: string; message: string }[] }) {
  const [open, setOpen] = useState(false)
  if (!p.project.roles.some(r => r.pin === undefined && r.ref === undefined)) return null
  const name = devicesName(p.project), problem = p.problems.find(p => p.message.startsWith('the Devices page has no way in'))
  return <div className="vb-devices-row"><button className="lrow" aria-expanded={open} onClick={() => setOpen(v => !v)}>Devices<span className="unit">{p.play && p.active === name ? 'on the chip' : 'generated'}</span></button>
    <div className="raised" hidden={!open}><h3 className="ptitle">Devices page</h3><p>Page id and surface {name}.</p>
      <p>Built by the export when a role scans the network. It holds a Header, a Repeater of the scanned devices, a message, a page number and the buttons PREV, NEXT, RESCAN, BACK and SAVE.</p>
      <p>It has no editor. It shows in Play, when the chip turns to it. The way in is a page step: Logic › Actions, step page {name}, on a button or a tab.</p>
      <p>When a project page already holds that id or surface, the next free name is used.</p>
      {problem && <p><span className="chip warn">WARN</span>{problem.message}</p>}
    </div>
  </div>
}
