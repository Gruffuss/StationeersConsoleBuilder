// The custom-Lua block (spec 6.4, ruling P10): kept verbatim between markers in the export. A textarea: typing is transient,
// leaving it commits one undo step. The API custom code sees is listed above it.
import type { Project } from '../model/project'
import type { Action } from '../model/store'
import './panels.css'

const API = 'Hooks: U.init() · U.before_reads(dt) · U.after_reads(P, S, dt) · U.before_render(P, S, data) · U.<fn>(E) for a call step. '
  + 'Reserved: VB P T H S C X L R E U rd rds wr wrf log persist page alarms tick (assign their fields, never the names).'

export function CustomLuaPane({ project, dispatch }: { project: Project; dispatch: (a: Action) => void }) {
  return <section className="vb-custom" aria-label="Custom Lua">
    <h2 className="ptitle">Custom Lua</h2>
    <p className="unit">Kept as written between markers in the export.</p>
    <details className="disc" open><summary><span className="ptitle">Hooks and names</span></summary><p className="raised code">{API}</p></details>
    <textarea className="area" aria-label="custom Lua" spellCheck={false} rows={20} value={project.customLua}
      onChange={e => dispatch({ type: 'setLogic', patch: { customLua: e.target.value }, transient: true })}
      onBlur={() => dispatch({ type: 'commitDrag' })} />
    <p className="unit">Typing stays a draft; leaving the editor commits it as one undo step.</p>
  </section>
}
