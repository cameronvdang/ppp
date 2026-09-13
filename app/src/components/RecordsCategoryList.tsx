import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { CATEGORY_LABELS } from '../records/categories'
import { categoryAvailability, recordDetail, recordName } from '../records/presentation'
import { getConnection, listRecords } from '../records/store'
import type { RecordCategory } from '../records/types'
import { loadReport, readyReport } from '../lib/reportLoad'
export function RecordsCategoryList({ category, onBack }: { category: RecordCategory; onBack(): void }) {
  const result = useLiveQuery(() => loadReport(category, async () => {
    // Observe the Dexie table before the browser key/crypto awaits.
    await db.medicalRecords.where('category').equals(category).count()
    const connection = await getConnection()
    return { connection, records: await listRecords(category) }
  }), [category])
  const data = readyReport(result, category)
  const availability = data ? categoryAvailability(data.connection, category) : null
  return <section className="overlay records-category" role="dialog" aria-modal="true" aria-labelledby="records-category-title">
    <div className="overlay-head">
      <button className="back-btn" onClick={onBack} aria-label="Back">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
      </button>
      <h2 id="records-category-title">{CATEGORY_LABELS[category]}</h2>
    </div>
    <div className="overlay-body">
      {data?.connection.mode === 'demo' && <p className="records-banner">Sample data. None of this is about you.</p>}
      {!data ? <p role={result?.status === 'error' ? 'alert' : 'status'}>{result?.status === 'error' ? 'Could not load these records. Close this list and try again.' : 'Loading records…'}</p> : <>
        {availability !== 'Available' && <p className="records-notice">{availability}.{data.records.length > 0 ? ' Showing previously saved records.' : ''}</p>}
        {data.records.length === 0 && availability === 'Available' && <p>Nothing in this category from your provider.</p>}
        <ul className="records-list">{data.records.map(r => <li className="records-row" key={r.id}>
          <strong>{recordName(r)}</strong>
          <p>{recordDetail(r)}</p>
          {(r.category === 'labs' || r.category === 'vitals') && r.referenceRange && <p className="muted">Reference range: {r.referenceRange}</p>}
          <p className="muted">{r.sourceName ?? 'Source not supplied'} · from your provider</p>
        </li>)}</ul>
      </>}
    </div>
  </section>
}
