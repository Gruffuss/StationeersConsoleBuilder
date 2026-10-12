// Dev mode: runs one of the vector examples (copied to <base>examples by `npm run precore`) as raw Lua on the chip.
import { useEffect, useRef, useState } from 'react'
import type { CoreBridge } from './runtime/bridge'
import { projectOf } from './editor/ExamplePicker'
import { PageFontPanel } from './editor/PageFontPanel'
import type { Project } from './model/project'
import type { Scene } from './model/scene'

export const EXAMPLE_SIZE = { w: 460, h: 460 }
const EXAMPLES = ['01-hello', '02-moving', '03-data', '04-repeat', '05-curves', '06-paint', '07-clip', '08-console', '09-scroll',
  '10-text', '11-symbols', '12-click', '13-src', '14-ztext', '15-effects', '16-pointer', '17-pictures', '18-lines', '19-webfonts']

/** `onRun` hears each example as it is sent to the core. */
export function ExampleScripts({ bridge, onRun, onFontScene }: { bridge: CoreBridge; onRun?: (name: string) => void; onFontScene?: (scene: Scene | undefined) => void }) {
  // Leaving scripts mode unmounts this: a fetch that ends after that must not replace the project's chip.
  const mounted = useRef(true)
  const latest = useRef('')
  const [project, setProject] = useState<Project | null>(null)
  const [pageId, setPageId] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const run = async (name: string) => {
    latest.current = name
    setProject(null)
    onFontScene?.(undefined)
    const res = await fetch(`${import.meta.env.BASE_URL}examples/${name}.lua`)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const lua = await res.text()
    if (!mounted.current || latest.current !== name) return
    bridge.load(lua, EXAMPLE_SIZE)
    const selected = projectOf(name)
    setProject(selected); setPageId(selected.pages[0].id)
    onFontScene?.(selected.pages[0].scene)
    onRun?.(name)
  }
  return <><select aria-label="Run example script" defaultValue=""
    onChange={e => { const name = e.target.value; run(name).catch(err => console.error(`example ${name} could not be fetched`, err)) }}>
    <option value="" disabled>Run example script…</option>
    {EXAMPLES.map(n => <option key={n}>{n}</option>)}
  </select>
    {project && <details className="vb-fonts"><summary>Fonts</summary>
      {project.pages.length > 1 && <label>Example font page <select value={pageId} onChange={e => {
        setPageId(e.target.value); onFontScene?.(project.pages.find(p => p.id === e.target.value)!.scene)
      }}>
        {project.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></label>}
      <PageFontPanel key={`${project.name}/${pageId}`} page={project.pages.find(p => p.id === pageId)!} project={project} />
    </details>}
  </>
}
