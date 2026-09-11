import { db } from '../db/schema'
import { getConnection, listRecords } from '../records/store'
import { recordName } from '../records/presentation'
import type { MedicalRecord, RecordsConnection } from '../records/types'
export interface ProviderReportData { connection: RecordsConnection; conditions: MedicalRecord[]; medications: MedicalRecord[]; allergies: MedicalRecord[] }
export async function loadProviderReport(include: boolean): Promise<ProviderReportData | null> {
  if (!include) return null
  // Observe the table before async key access so refresh/deletion invalidates the report.
  await db.medicalRecords.count()
  const connection = await getConnection()
  const records = await listRecords()
  return { connection, conditions: records.filter(r => r.category === 'conditions' && r.status === 'active'), medications: records.filter(r => r.category === 'medications' && r.status === 'active'), allergies: records.filter(r => r.category === 'allergies') }
}
export function ProviderRecordsReport({ data }: { data: ProviderReportData }) {
  return <section className="provider-records-report">
    <h2>Records from your provider</h2>
    {(['conditions', 'medications', 'allergies'] as const).map(category => <div key={category}>
      <h3>{category === 'conditions' ? 'Active conditions' : category === 'medications' ? 'Active medications' : 'Allergies'}</h3>
      {data[category].length ? <ul>{data[category].map(r => <li key={r.id}>{recordName(r)} — {'status' in r ? r.status ?? 'Status not supplied' : 'Status not supplied'} — {r.date ?? 'Date not supplied'} — {r.sourceName ?? 'Source not supplied'}</li>)}</ul> : <p className="muted">No imported items in this section.</p>}
    </div>)}
    <p className="muted">{data.connection.mode === 'demo' ? 'Sample data. ' : ''}Imported via FinchNode on {data.connection.lastSyncAt ?? data.connection.importedAt ?? 'date not supplied'}. Not verified by Lunara.</p>
  </section>
}
