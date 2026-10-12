// Delete: every selected node and what is under it; a DEFS node from DEFS. Other defs stay (shared, harmless; the checker
// names a reference left without its def), but a widget root's own <uid>_ defs go with it (dropWidget; the store drops the
// preview values only its slots read, as its deleteWidget does), and only with it: one selected in DEFS stays, said (its
// widget would draw without it until the next re-expansion made it again). Writes no value: no check. A selected native
// widget (M2b T9) is not in the scene: the store's deleteWidget removes it from the page (the store keeps a native a lone
// primary).
import { nodeAt, selected, type Selection } from '../../model/store'
import { first } from '../../srctext/props'
import { dropWidget, widgetsIn } from '../../widgets/core'
import { removeAt } from '../tree'
import type { Command } from '../types'

const del: Command = { kind: 'command', id: 'delete', label: 'Delete', menu: 'edit', order: 10, keys: ['Delete', 'Backspace'],
  when: ctx => selected(ctx.get()).some(x => x.pageId === ctx.page().id),
  run(ctx) {
    const page = ctx.page(), t = ctx.theme(), all = selected(ctx.get()).filter(x => x.pageId === page.id)
    for (const x of all) if (x.native !== undefined) ctx.dispatch({ type: 'deleteWidget', pageId: page.id, uid: x.native })
    const widgets = widgetsIn(page.scene, t), uids = widgets.map(w => w.ref.uid)
    const owned = (x: Selection) => {
      const d = x.inDefs ? page.scene.defs[x.path[0]] : undefined, k = d && first(d, 'ID')
      return typeof k === 'string' && uids.some(u => k.startsWith(u + '_'))
    }
    const set = all.filter(x => x.native === undefined && !owned(x)), kept = all.filter(owned).length
    if (kept) ctx.note(`${kept} skipped: a widget's own def goes with its widget`)
    if (!set.length) return
    const ws = widgets.filter(w => set.some(x => !x.inDefs && x.path.length <= w.path.length && x.path.every((k, i) => w.path[i] === k)))
    const defs = set.filter(x => x.inDefs).map(x => x.path), nodes = set.filter(x => !x.inDefs).map(x => x.path)
    let scene = { ...page.scene, root: removeAt(page.scene.root, nodes), defs: defs.length ? removeAt(page.scene.defs, defs) : page.scene.defs }
    // Give dropWidget each deleted root so its shared def cleanup sees only the nodes that remain.
    for (const { path, ref } of ws) scene = dropWidget({ ...scene, root: [...scene.root, nodeAt(page.scene.root, path)!] }, ref.uid, t)
    return ctx.apply({ scene, selection: [] })
  } }
export default del
