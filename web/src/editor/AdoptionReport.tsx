import type { AdoptReport } from '../project/adopt'

export function AdoptionReport({ report, onDismiss }: { report: AdoptReport; onDismiss: () => void }) {
  return <section aria-label="Adoption report">
    <h3>Adoption report</h3>
    <button type="button" aria-label="Dismiss adoption report" onClick={onDismiss}>Dismiss report</button>
    <p>{report.complete ? 'Capture complete' : 'Capture incomplete'}</p>
    <h4>Pages</h4><ul>{report.pages.map(p => <li key={p.id}>{p.id}: {p.from}</li>)}</ul>
    <h4>Left out</h4><ul>{report.leftOut.map((note, i) => <li key={i}>{note}</li>)}</ul>
    <h4>Notes</h4><ul>{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
  </section>
}
