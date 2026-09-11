import { isRecordCategory, normalizeCategories, recordId } from '../categories'
import type { MedicalRecord, NormalizeResult, RecordCategory, RecordsSource, RecordsWarning, SyncDetails } from '../types'
import { array, date, displayValue, extraArrayItems, object, string } from './fields'

/** Fields remain unknown until read; upstream objects are never spread into storage. */
export interface FinchnodeHealthRecord { id?: unknown; object?: unknown; categories?: unknown; consent?: unknown; sources?: unknown; data?: unknown; meta?: unknown }
export function readWarnings(value: unknown): RecordsWarning[] {
  return array(value).map(object).flatMap(w => typeof w.code === 'string' && typeof w.message === 'string'
    ? [{ code: w.code, message: w.message, category: isRecordCategory(w.category) ? w.category : null }] : [])
}
function normalize(value: unknown, category: RecordCategory, syncedAt: string): MedicalRecord | null {
  const r = object(value), id = string(r.id), name = string(category === 'allergies' ? r.substance : r.name)
  if (!id || !/^rec_[a-f0-9]{24}$/.test(id) || !name) return null
  const base = { id: recordId('live', category, id), sourceRecordId: string(r.sourceRecordId), sourceName: string(r.sourceName) ?? string(r.source), syncedAt, synthetic: false,
    codes: array(r.codes).map(object).map(c => ({ system: string(c.system), code: string(c.code), display: string(c.display) })).filter(c => c.system || c.code || c.display) }
  switch (category) {
    case 'demographics': return { ...base, category, date: date(r.birthDate), name, birthDate: date(r.birthDate), gender: string(r.gender), address: string(r.address), phone: string(r.phone), email: string(r.email) }
    case 'medications': return { ...base, category, date: date(r.startDate), name, dosage: string(r.dosage), frequency: string(r.frequency), status: string(r.status), startDate: date(r.startDate), endDate: date(r.endDate), prescriber: string(r.prescriber), reason: string(r.reason) }
    case 'conditions': return { ...base, category, date: date(r.onsetDate) ?? date(r.recordedDate), name, status: string(r.status), verificationStatus: string(r.verificationStatus), severity: string(r.severity), onsetDate: date(r.onsetDate), recordedDate: date(r.recordedDate) }
    case 'labs': case 'vitals': return { ...base, category, date: date(r.date), name, value: displayValue(r.value), unit: string(r.unit), status: string(r.status), referenceRange: string(r.referenceRange), interpretation: string(r.interpretation) }
    case 'allergies': return { ...base, category, date: date(r.recordedDate), substance: name, reaction: string(r.reaction), severity: string(r.severity), status: string(r.status), verificationStatus: string(r.verificationStatus), recordedDate: date(r.recordedDate) }
    case 'immunizations': return { ...base, category, date: date(r.date), name, code: string(r.code), status: string(r.status), manufacturer: string(r.manufacturer), lotNumber: string(r.lotNumber) }
  }
}
export function normalizeFinchnodeHealthRecord(record: FinchnodeHealthRecord, opts: { syncedAt: string; categories: readonly RecordCategory[] }): NormalizeResult & SyncDetails & { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[] } {
  const r = object(record), meta = object(r.meta), data = object(r.data)
  const syncStatus = meta.syncStatus
  if (r.object !== 'health_record' || typeof r.id !== 'string' || !/^u_[a-f0-9]{16}$/.test(r.id) || !Array.isArray(r.categories)
    || !['complete', 'partial', 'not_started'].includes(String(syncStatus)) || !Array.isArray(meta.availableCategories) || !Array.isArray(meta.missingCategories)
    || r.data === null || typeof r.data !== 'object' || Array.isArray(r.data)) throw new Error('The records service returned an invalid snapshot.')
  const grantedCategories = normalizeCategories(array(r.categories)).filter(c => opts.categories.includes(c))
  const records = new Map<string, MedicalRecord>()
  let skipped = 0, additionalItems = 0
  for (const [category, value] of Object.entries(data)) {
    if (!isRecordCategory(category)) { additionalItems += extraArrayItems(value); continue }
    if (!grantedCategories.includes(category)) continue
    const values = category === 'demographics' ? value == null ? [] : [value, ...array(object(value).records)] : array(value)
    if (category !== 'demographics' && value != null && !Array.isArray(value)) skipped++
    for (const value of values) {
      const normalized = normalize(value, category, opts.syncedAt)
      if (normalized) records.set(normalized.id, normalized) // later nested demographic wins
      else skipped++
    }
  }
  return { records: [...records.values()], skipped, additionalItems,
    sources: array(r.sources).map(object).flatMap(s => string(s.system) ? [{ system: string(s.system)!, organization: string(s.organization), lastSyncedAt: date(s.lastSyncedAt) }] : []),
    warnings: readWarnings(meta.warnings), syncStatus: syncStatus as 'complete' | 'partial' | 'not_started', sync: { status: syncStatus as 'complete' | 'partial' | 'not_started' },
    grantedCategories, availableCategories: normalizeCategories(array(meta.availableCategories)).filter(c => grantedCategories.includes(c)),
    missingCategories: normalizeCategories(array(meta.missingCategories)).filter(c => grantedCategories.includes(c)), failure: null,
    consentReceiptIds: array(object(r.consent).receiptIds).filter((v): v is string => string(v) !== null),
  }
}
