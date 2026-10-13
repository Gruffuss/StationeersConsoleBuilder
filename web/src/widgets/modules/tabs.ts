// Page tabs (builder-defined, Q8): one tab per project page by default; the hosting page's tab is ringed, baked (each page
// is its own scene); each tab's step goes to its page. Never inside the Header (Q9). Each tab stores its label and page id,
// so a page renamed or deleted later leaves its tab as it was (ruling 10). Labels after all the groups (E5). down: 0.11.36.
import { body, box, el, keyed, label, literal, oneLine, plainTextProblem, pos, ring } from '../paint'
import type { WidgetModule } from '../types'

type Tab = { label: string; page: string; key: number }
type P = { x: number; y: number; w: number; h: number; tabs: Tab[]; active: string; gap: number }
const tabs: WidgetModule<P> = {
  type: 'tabs', label: 'Page tabs', group: 'chrome', prefix: 'nav', resize: 'both',
  params: [...box(), { key: 'tabs', name: 'Tabs', type: 'list', min: 1, item: [{ key: 'label', name: 'Label', type: 'text' }, { key: 'page', name: 'Page', type: 'page' }, { key: 'key', name: 'Tab id', type: 'num', min: 0, int: true }] },
    { key: 'active', name: 'Highlighted page', type: 'page' }, { key: 'gap', name: 'Gap', type: 'num', min: 0 }],
  defaults: (t, ctx) => ({ x: 24, y: 24, w: ctx.size.w - 48, h: t.geo.size.control,
    // A page name a label cannot show as written (a leading $, a closed {$ or {= placeholder) starts its tab blank, for the
    // player to name, rather than sanitize's fallback (the first default tab's label, the wrong text).
    tabs: ctx.pages.length ? ctx.pages.map((p, key) => ({ label: plainTextProblem(p.name) === null ? p.name : '', page: p.id, key })) : [{ label: 'Main', page: ctx.page, key: 0 }],
    active: ctx.page, gap: t.geo.space[3] }),
  // At least one line of its button-label labels, which have fit=ellipsis.
  fix: (p, t) => ({ ...p, tabs: keyed(p.tabs), h: Math.max(p.h, oneLine(t, 'button-label')) }),
  expand(p, t, uid) {
    const n = p.tabs.length, bw = pos((p.w - (n - 1) * p.gap) / n), at = (k: number) => p.x + k * (bw + p.gap)
    return {
      nodes: [...p.tabs.map((tab, k) => el('G', { id: `${uid}_g${k}` }, [el('R', { id: `${uid}_t${k}`, click: 1, x: at(k), y: p.y, w: bw, h: p.h }),
          ...(tab.page === p.active ? [ring(t, at(k), p.y, bw, p.h, undefined, `tab.${tab.key}.ring`)] : []), body(t, 'secondary', at(k), p.y, bw, p.h, `tab.${tab.key}.body`)])),
        ...p.tabs.map((tab, k) => label(t, 'button-label', { x: at(k), y: p.y, w: bw, h: p.h }, literal(t, 'button-label', tab.label), { align: 'center', fit: true, tag: `tab.${tab.key}.label` }))],
      slots: [], clicks: p.tabs.map((tab, k) => ({ id: `${uid}_t${k}`, step: `page(${tab.page})` })),
    }
  },
}
export default tabs
