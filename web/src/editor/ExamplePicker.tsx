// Dev-time sample scenes: the structure elements of vector examples 01-19 (test/fixtures/examples, captured from the C#
// host). Choosing one makes a new project with a page per element. M4's templates replace them.
import { newLogic } from '../model/logic'
import { VECTOR_FLOOR, type Project } from '../model/project'
import { sceneOfProps } from '../srctext/fromProps'
import type { Pairs } from '../srctext/props'
import { DEFAULT_THEME, M1_GROUND } from '../theme'

const FIXTURES = import.meta.glob('/test/fixtures/examples/*.props.json', { eager: true, import: 'default' }) as Record<string, Pairs>

// NN-name.<element id>.props.json, grouped by example, elements in file order.
const EXAMPLES = new Map<string, { id: string; props: Pairs }[]>()
for (const file of Object.keys(FIXTURES).sort()) {
  const [, example, id] = /([^/]+?)\.([^/.]+)\.props\.json$/.exec(file)!
  EXAMPLES.set(example, [...EXAMPLES.get(example) ?? [], { id, props: FIXTURES[file] }])
}

/** One page per structure element: id = element id, surface `main` for the first and the element id for the rest. */
export function projectOf(example: string): Project {
  return { version: 1, name: example, target: { vectorMod: VECTOR_FLOOR }, theme: DEFAULT_THEME,
    pages: EXAMPLES.get(example)!.map((e, k) => ({ id: e.id, name: e.id, surface: k === 0 ? 'main' : e.id,
      shape: 'square', size: { w: 460, h: 460 }, background: [M1_GROUND], scene: sceneOfProps(e.props) })), ...newLogic() }
}

export function ExamplePicker({ onPick }: { onPick: (p: Project) => void }) {
  return <select aria-label="Open example" value="" onChange={e => onPick(projectOf(e.target.value))}>
    <option value="" disabled>Open example…</option>
    {[...EXAMPLES.keys()].map(n => <option key={n}>{n}</option>)}
  </select>
}
