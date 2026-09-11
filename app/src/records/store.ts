import { db, getHealthProfile, getSetting, SK, type ConsentDecision, type HealthProfile, type SealedRecordRow } from '../db/schema'
import { open, seal } from '../crypto/sealed'
import { withSealingKey } from '../platform/keyStore'
import { isRecordCategory, RECORD_CATEGORIES } from './categories'
import { canonicalizeRelayUrl } from './providers/relay'
import type { MedicalRecord, RecordCategory, RecordsConnection } from './types'
export type ConnectionPatch = Partial<Omit<RecordsConnection, 'id' | 'generation'>> & { expectedGeneration: number }
export function defaultConnection(): RecordsConnection {
  return { id: 'primary', mode: 'demo', status: 'disconnected', generation: 0, relayBaseUrl: null, categories: [...RECORD_CATEGORIES], grantedCategories: [], availableCategories: [], missingCategories: [], sources: [], consentReceiptIds: [], warnings: [], additionalItems: 0 }
}
export async function getConnection(): Promise<RecordsConnection> { return await db.recordsConnection.get('primary') ?? defaultConnection() }
export function recordsConsentGranted(profile: HealthProfile): boolean {
  return profile.privacy.consentLedger.filter(d => d.purpose === 'medical-records').sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)).at(-1)?.state === 'granted'
}
export function recordsTransaction<T>(run: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.medicalRecords, db.recordsConnection, db.settings, db.healthProfiles], run)
}
/** Re-read this in the very transaction that commits any asynchronous result. */
async function guardedConnection(patch: ConnectionPatch): Promise<RecordsConnection | null> {
  const current = await getConnection()
  if (current.generation !== patch.expectedGeneration || !recordsConsentGranted(await getHealthProfile())) return null
  if (current.mode === 'live' || patch.mode === 'live') {
    try {
      const saved = canonicalizeRelayUrl(await getSetting(SK.recordsRelayUrl) ?? '')
      if (current.relayBaseUrl !== saved || (patch.relayBaseUrl !== undefined && patch.relayBaseUrl !== saved)) return null
    } catch { return null }
  }
  return current
}
function mergePatch(current: RecordsConnection, patch: ConnectionPatch): RecordsConnection {
  const { expectedGeneration: _, ...changes } = patch
  return { ...current, ...changes, id: 'primary', generation: current.generation }
}
export function putConnection(patch: ConnectionPatch): Promise<boolean> {
  return recordsTransaction(async () => {
    const current = await guardedConnection(patch)
    if (!current) return false
    await db.recordsConnection.put(mergePatch(current, patch))
    return true
  })
}
export function putSnapshot(records: MedicalRecord[], categoriesToReplace: RecordCategory[], patch: ConnectionPatch): Promise<boolean> {
  if (new Set(categoriesToReplace).size !== categoriesToReplace.length || !categoriesToReplace.every(isRecordCategory)) return Promise.reject(new Error('Invalid replacement categories.'))
  return withSealingKey(async key => {
    const rows: SealedRecordRow[] = await Promise.all(records.filter(r => categoriesToReplace.includes(r.category)).map(async r => ({ id: r.id, category: r.category, date: r.date, sealed: await seal(key, r) })))
    return recordsTransaction(async () => {
      const current = await guardedConnection(patch)
      if (!current) return false
      const selected = patch.categories ?? current.categories
      if (categoriesToReplace.some(c => !current.categories.includes(c) || !selected.includes(c))) return false
      const granted = patch.grantedCategories ?? current.grantedCategories
      // The initial store can be seeded before a provider grant; orchestration supplies the effective grant.
      if (granted.length && categoriesToReplace.some(c => !granted.includes(c))) return false
      await db.medicalRecords.where('category').anyOf(categoriesToReplace).delete()
      await db.medicalRecords.bulkPut(rows)
      await db.recordsConnection.put(mergePatch(current, patch))
      return true
    })
  })
}
export function listRecords(category?: RecordCategory): Promise<MedicalRecord[]> {
  return withSealingKey(async key => {
    const rows = await (category ? db.medicalRecords.where('category').equals(category).toArray() : db.medicalRecords.toArray())
    const records = await Promise.all(rows.map(r => open<MedicalRecord>(key, r.sealed)))
    return records.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id))
  })
}
export async function countByCategory(): Promise<Record<RecordCategory, number>> {
  const counts = Object.fromEntries(RECORD_CATEGORIES.map(c => [c, 0])) as Record<RecordCategory, number>
  for (const r of await db.medicalRecords.toArray()) if (isRecordCategory(r.category)) counts[r.category]++
  return counts
}
/** Deliberate user transitions invalidate before callers abort local work. No crypto in this transaction. */
export function transitionConnection(update: (current: RecordsConnection) => RecordsConnection, options: { requireConsent?: boolean; consent?: ConsentDecision['state'] | 'remove'; clear?: boolean } = {}): Promise<RecordsConnection> {
  return recordsTransaction(async () => {
    const current = await getConnection()
    const profile = await getHealthProfile()
    if (options.requireConsent && !recordsConsentGranted(profile)) throw new Error('Consent is required to connect medical records.')
    const next = { ...update(current), id: 'primary' as const, generation: current.generation + 1 }
    if (options.consent) {
      const consentLedger = profile.privacy.consentLedger.filter(d => d.purpose !== 'medical-records')
      if (options.consent !== 'remove') consentLedger.push({ purpose: 'medical-records', state: options.consent, version: 1, decidedAt: new Date().toISOString() })
      await db.healthProfiles.put({ ...profile, privacy: { ...profile.privacy, consentLedger } })
    }
    // Cached rows belong to their mode, including categories absent from a partial refresh.
    if (options.clear || current.mode !== next.mode) await db.medicalRecords.clear()
    else await db.medicalRecords.where('category').anyOf(RECORD_CATEGORIES.filter(c => !next.categories.includes(c))).delete()
    await db.recordsConnection.clear()
    await db.recordsConnection.put(next)
    return next
  })
}
export async function clearRecords(): Promise<void> { await transitionConnection(defaultConnection, { clear: true }) }

const controllers = new Set<AbortController>()
export function registerRecordsWork(controller: AbortController): () => void {
  controllers.add(controller)
  return () => { controllers.delete(controller) }
}
export function abortRecordsWork(): void { for (const controller of controllers) controller.abort(); controllers.clear() }
