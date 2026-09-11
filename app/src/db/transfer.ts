import { decryptJSON, encryptJSON, type Envelope } from '../crypto/vault'
import { open, seal } from '../crypto/sealed'
import { withSealingKey } from '../platform/keyStore'
import { deleteSecureSecret, SECURE_SECRET_KEYS } from '../platform/secureVault'
import { canonicalizeRelayUrl } from '../records/providers/relay'
import { withRelaySettings } from '../records/relaySettings'
import { abortRecordsWork, defaultConnection, getConnection } from '../records/store'
import type { MedicalRecord, RecordsConnection } from '../records/types'
import { db, SK, type ContentBookmark, type DailyLog, type HealthProfile, type Setting } from './schema'
import type { MissedDoseEvent, RegimenRecord } from './regimen'
import { object } from '../records/normalize/fields'
import { assertValid, bookmarkCheck, dailyLogCheck, missedCheck, profileCheck, regimenCheck, settingCheck, validateConnection, validateMedicalRecord, validateRows } from './transferValidation'

const SECRET_KEYS = new Set<string>([SK.pinSalt, SK.pinHash, SK.aiKey, 'recoveryCode', SK.biometricLock, SK.deviceUnlockCredential, ...Object.values(SECURE_SECRET_KEYS), 'recordsRelayToken'])
export interface ExportPayloadV1 { app: 'lunara' | 'ppp'; v: 1; exportedAt: string; dailyLogs: DailyLog[]; settings: Setting[]; contentBookmarks: ContentBookmark[] }
export interface ExportPayloadV2 extends Omit<ExportPayloadV1, 'v'> {
  v: 2
  healthProfiles: HealthProfile[]
  regimenRecords: RegimenRecord[]
  missedDoseEvents: MissedDoseEvent[]
  medicalRecords: MedicalRecord[]
  recordsConnection: Omit<RecordsConnection, 'pendingSession' | 'creationAttempt'> | null
}
export type ExportPayload = ExportPayloadV1 | ExportPayloadV2
function safeSettings(settings: Setting[]): Setting[] {
  return settings.filter(s => !SECRET_KEYS.has(s.key)).map(s => ({ key: s.key, value: s.key === SK.recordsRelayUrl && s.value ? canonicalizeRelayUrl(s.value) : s.value }))
}
function logicalConnection(c: RecordsConnection | undefined, hasRows: boolean): boolean {
  return !!c && (hasRows || c.status !== 'disconnected' || !!c.subject || !!c.importedAt || !!c.lastSyncAt || !!c.sync || !!c.lastError || !!c.sources.length || !!c.consentReceiptIds.length)
}
export function collectExport(): Promise<ExportPayloadV2> {
  return withSealingKey(async key => {
    const snapshot = await db.transaction('r', db.tables, async () => ({
      dailyLogs: await db.dailyLogs.toArray(), settings: safeSettings(await db.settings.toArray()), contentBookmarks: await db.contentBookmarks.toArray(),
      healthProfiles: await db.healthProfiles.toArray(), regimenRecords: await db.regimenRecords.toArray(), missedDoseEvents: await db.missedDoseEvents.toArray(),
      rows: await db.medicalRecords.toArray(), connection: await db.recordsConnection.get('primary'),
    }))
    const { rows, connection, ...tables } = snapshot
    const medicalRecords = await Promise.all(rows.map(row => open<MedicalRecord>(key, row.sealed)))
    const recordsConnection = logicalConnection(connection, rows.length > 0) ? validateConnection(connection) : null
    return { app: 'ppp', v: 2, exportedAt: new Date().toISOString(), ...tables, medicalRecords, recordsConnection }
  })
}
function validatePayload(input: unknown): ExportPayload {
  const p = object(input)
  if (!(p.app === 'lunara' || p.app === 'ppp') || (p.v !== 1 && p.v !== 2)) throw new Error('Not a supported PPP export file.')
  assertValid(p.exportedAt, v => typeof v === 'string' && Number.isFinite(Date.parse(v)), 'export timestamp')
  validateRows(p.dailyLogs, dailyLogCheck, 'daily logs'); validateRows(p.settings, settingCheck, 'settings'); validateRows(p.contentBookmarks, bookmarkCheck, 'bookmarks')
  const legacy = { app: 'ppp' as const, exportedAt: String(p.exportedAt), dailyLogs: p.dailyLogs as DailyLog[], settings: safeSettings(p.settings as Setting[]), contentBookmarks: p.contentBookmarks as ContentBookmark[] }
  if (p.v === 1) return { ...legacy, v: 1 }
  validateRows(p.healthProfiles, profileCheck, 'health profiles'); validateRows(p.regimenRecords, regimenCheck, 'regimens'); validateRows(p.missedDoseEvents, missedCheck, 'adherence')
  if (!Array.isArray(p.medicalRecords)) throw new Error('Invalid medical records in PPP export.')
  const medicalRecords = p.medicalRecords.map(validateMedicalRecord)
  if (new Set(medicalRecords.map(r => r.id)).size !== medicalRecords.length) throw new Error('Duplicate medical records in PPP export.')
  return { ...legacy, v: 2, healthProfiles: p.healthProfiles as HealthProfile[], regimenRecords: p.regimenRecords as RegimenRecord[], missedDoseEvents: p.missedDoseEvents as MissedDoseEvent[], medicalRecords, recordsConnection: validateConnection(p.recordsConnection) }
}
export async function applyImport(input: unknown): Promise<number> {
  // Snapshot the input so caller mutation cannot bypass validation while sealing waits.
  const payload = validatePayload(structuredClone(input))
  return withRelaySettings(async () => {
    let endpointChanged = false
    await withSealingKey(async key => {
      const rows = payload.v === 2 ? await Promise.all(payload.medicalRecords.map(async r => ({ id: r.id, category: r.category, date: r.date, sealed: await seal(key, r) }))) : []
      await db.transaction('rw', db.tables, async () => {
        const oldUrl = (await db.settings.get(SK.recordsRelayUrl))?.value ?? ''
        const nextUrl = payload.settings.find(s => s.key === SK.recordsRelayUrl)?.value ?? oldUrl
        endpointChanged = (oldUrl ? canonicalizeRelayUrl(oldUrl) : '') !== nextUrl
        const current = await getConnection()
        await db.dailyLogs.bulkPut(payload.dailyLogs)
        await db.settings.bulkPut(payload.settings)
        await db.contentBookmarks.bulkPut(payload.contentBookmarks)
        if (payload.v === 2) {
          await db.healthProfiles.clear(); await db.healthProfiles.bulkPut(payload.healthProfiles)
          await db.regimenRecords.clear(); await db.regimenRecords.bulkPut(payload.regimenRecords)
          await db.missedDoseEvents.clear(); await db.missedDoseEvents.bulkPut(payload.missedDoseEvents)
          await db.medicalRecords.clear(); await db.medicalRecords.bulkPut(rows)
          await db.recordsConnection.clear()
          await db.recordsConnection.put(payload.recordsConnection
            ? { ...payload.recordsConnection, id: 'primary', generation: current.generation + 1, status: 'disconnected', importedAt: new Date().toISOString() }
            : { ...defaultConnection(), generation: current.generation + 1 })
        } else if (endpointChanged && current.mode === 'live') {
          const { pendingSession: _, creationAttempt: __, ...rest } = current
          await db.recordsConnection.put({ ...rest, generation: current.generation + 1, status: 'disconnected', lastError: undefined, recoveryAction: undefined })
        }
      })
    })
    if (payload.v === 2 || endpointChanged) abortRecordsWork()
    // The connection is already disabled even if vault cleanup fails.
    if (endpointChanged) await deleteSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken)
    return payload.dailyLogs.length
  })
}
export async function encryptedExport(passphrase: string): Promise<Envelope> {
  return encryptJSON(await collectExport(), passphrase)
}

export async function decryptImport(env: Envelope, passphrase: string): Promise<number> {
  return applyImport(await decryptJSON<ExportPayload>(env, passphrase))
}

/** Share-sheet first (iOS → Save to Files → iCloud Drive), download fallback. */
export async function shareOrDownload(filename: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: 'application/json' })
  const file = new File([blob], filename, { type: 'application/json' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return
    } catch {
      // fall through to download (user cancel or share failure)
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
