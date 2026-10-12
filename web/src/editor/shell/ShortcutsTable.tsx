import type { ShortcutSection } from './shortcuts'

export function ShortcutsTable({ sections }: { sections: ShortcutSection[] }) {
  return <>{sections.map(s => <section key={s.title} aria-label={s.title}>
    <h3 className="ptitle">{s.title}</h3>{s.note && <p className="unit">{s.note}</p>}
    <dl>{s.rows.map((r, k) => <div key={k}><dt>{r.what}</dt><dd>{r.keys.split(' · ').map((key, n) => <kbd className="kbd" key={n}>{key}</kbd>)}</dd></div>)}</dl>
  </section>)}</>
}
