import type { MedicalRecord, RecordCategory, RecordsConnection } from './types'
import { formatRecordDate } from './format'
export function categoryAvailability(c: RecordsConnection, category: RecordCategory): 'Not selected' | 'Not refreshed' | 'Not available' | 'Available' {
  if (!c.categories.includes(category)) return 'Not selected'
  if (c.missingCategories.includes(category) || c.syncStatus === 'not_started' || c.sync?.status === 'not_started') return 'Not refreshed'
  if (!c.grantedCategories.includes(category) || !c.availableCategories.includes(category)) return 'Not available'
  return 'Available'
}
export function recordName(r: MedicalRecord): string { return r.category === 'allergies' ? r.substance : r.name }
export function recordDetail(r: MedicalRecord): string {
  const join = (...values: (string | null)[]) => values.filter(Boolean).join(' · ')
  switch (r.category) {
    case 'demographics': return join(formatRecordDate(r.birthDate), r.gender, r.address, r.phone, r.email)
    case 'medications': return join(r.dosage, r.frequency, r.status, formatRecordDate(r.date))
    case 'conditions': return join(r.status, r.onsetDate ? `onset ${formatRecordDate(r.onsetDate)}` : formatRecordDate(r.recordedDate))
    case 'labs': case 'vitals': return join([r.value === null ? null : String(r.value), r.unit].filter(Boolean).join(' '), formatRecordDate(r.date))
    case 'allergies': return join(r.reaction, r.severity, formatRecordDate(r.recordedDate))
    case 'immunizations': return join(r.status, formatRecordDate(r.date))
  }
}
