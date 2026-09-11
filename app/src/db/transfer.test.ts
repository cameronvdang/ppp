// app/src/db/transfer.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, SK, getSetting, createDefaultHealthProfile } from './schema'
import { defaultConnection, getConnection, listRecords } from '../records/store'
import type { MedicalRecord } from '../records/types'
import { applyImport, collectExport, type ExportPayloadV2 } from './transfer'

const cond: MedicalRecord = { id: 'live:conditions:rec_000000000000000000000001', category: 'conditions', sourceRecordId: 'provider-source-1', sourceName: 'Clinic', date: '2021-03-12', codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: false, name: 'Example condition', status: 'active', verificationStatus: 'confirmed', severity: null, onsetDate: '2021-03-12', recordedDate: null }
const connection = { ...defaultConnection(), mode: 'live' as const, status: 'connected' as const, relayBaseUrl: 'https://relay.test', categories: ['conditions'] as const, subject: 'u_0123456789abcdef' }
// Use mutable categories in the actual ExportPayloadV2 factory.
const payload = (): ExportPayloadV2 => ({ app: 'lunara' as const, v: 2 as const, exportedAt: '2026-09-11T00:00:00Z', dailyLogs: [], settings: [], contentBookmarks: [], healthProfiles: [], regimenRecords: [], missedDoseEvents: [], medicalRecords: [cond], recordsConnection: { ...connection, categories: [...connection.categories] } })

beforeEach(async () => {
    installLifecycleLocks()
  for (const table of db.tables) await table.clear()
})

describe('transfer v2', () => {
  it('restores a viewable snapshot with an imported disconnected connection', async () => {
    await applyImport(payload())
    expect(await listRecords('conditions')).toEqual([cond])
    expect(await getConnection()).toMatchObject({ status: 'disconnected', subject: connection.subject, relayBaseUrl: connection.relayBaseUrl, importedAt: expect.any(String) })
    const exported = await collectExport()
    expect(exported.medicalRecords).toEqual([cond])
    expect(exported.recordsConnection).not.toBeNull()
    expect(exported.recordsConnection).not.toHaveProperty('pendingSession')
    expect(exported.recordsConnection).not.toHaveProperty('creationAttempt')
  })

  it('replaces populated data with empty arrays and preserves an empty connection snapshot', async () => {
    await applyImport(payload())
    await applyImport({ ...payload(), medicalRecords: [] })
    expect(await listRecords()).toEqual([])
    expect((await collectExport()).recordsConnection).toMatchObject({ subject: connection.subject })
    await applyImport({ ...payload(), medicalRecords: [], recordsConnection: null })
    expect((await collectExport()).recordsConnection).toBeNull()
    expect((await getConnection()).status).toBe('disconnected')
  })

  it('v1 preserves existing medical records and their connection', async () => {
    await applyImport(payload())
    const before = await getConnection()
    await applyImport({ app: 'lunara', v: 1, exportedAt: '2026-09-11T00:00:00Z', dailyLogs: [], settings: [], contentBookmarks: [] })
    expect(await listRecords()).toEqual([cond])
    expect(await getConnection()).toEqual(before)
  })

  it.each([SK.pinSalt, SK.pinHash, SK.aiKey, 'recoveryCode', SK.biometricLock, SK.deviceUnlockCredential])(
    'excludes security setting %s on export and import', async (key) => {
      await db.settings.put({ key, value: 'local-secret' })
      expect((await collectExport()).settings.some((row) => row.key === key)).toBe(false)
      await applyImport({ ...payload(), settings: [{ key, value: 'imported-secret' }] })
      expect(await getSetting(key)).not.toBe('imported-secret')
      expect(JSON.stringify(await collectExport())).not.toContain('local-secret')
    },
  )

  it.each([{ app: 'other', v: 2 }, { app: 'lunara', v: 3 }])('rejects invalid app/version before writes: %j', async (bad) => {
    await applyImport(payload())
    const before = await collectExport()
    await expect(applyImport({ ...payload(), ...bad } as any)).rejects.toThrow()
    expect((await collectExport()).medicalRecords).toEqual(before.medicalRecords)
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })


import * as cryptoSealed from '../crypto/sealed'
import { getSecureSecret, SECURE_SECRET_KEYS, setSecureSecret } from '../platform/secureVault'
import { normalizeFinchnodeHealthRecord } from '../records/normalize/finchnode'
import liveFixture from '../records/__fixtures__/finchnode-health-record.json'
import type { RegimenRecord, MissedDoseEvent } from './regimen'

const now = '2026-09-11T00:00:00Z'
const canonical = () => {
  const profile = createDefaultHealthProfile(now)
  profile.privacy.consentLedger = [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: now }]
  profile.reproductive.tryingSince = '2026-06'
  const regimen: RegimenRecord = { id: 'pill-1', method: 'combined-pill-patch-ring', startDate: '2026-01-01', createdAt: now, updatedAt: now, product: 'Example', config: { kind: 'pill', activePillsPerPack: 21, placeboPillsPerPack: 7, schedule: 'standard' } }
  const missed: MissedDoseEvent = { id: 'missed-1', regimenId: 'pill-1', date: '2026-09-09', kind: 'late', hoursLate: 2, recordedAt: now }
  return { ...payload(), dailyLogs: [{ date: '2026-09-09', notes: 'Original log' }], settings: [{ key: SK.goal, value: 'ttc' }, { key: SK.recordsRelayUrl, value: 'https://relay.test' }], contentBookmarks: [{ slug: 'cycle', savedAt: now }], healthProfiles: [profile], regimenRecords: [regimen], missedDoseEvents: [missed] }
}
it('round-trips canonical tables and restored consent into a fresh database without network', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await applyImport(canonical())
  const exported = await collectExport()
  db.close(); await db.delete(); await db.open()
  await applyImport(exported)
  const restored = await collectExport()
  for (const key of ['dailyLogs', 'settings', 'contentBookmarks', 'healthProfiles', 'regimenRecords', 'missedDoseEvents', 'medicalRecords'] as const) expect(restored[key]).toEqual(exported[key])
  expect(restored.healthProfiles[0].privacy.consentLedger[0].state).toBe('granted')
  expect(restored.recordsConnection?.status).toBe('disconnected')
  expect(fetch).not.toHaveBeenCalled()
})
it.each(['demo', 'live'] as const)('fully replaces an old %s snapshot including its empty categories and pending state', async mode => {
  await applyImport({ ...payload(), medicalRecords: [{ ...cond, id: mode === 'demo' ? 'demo:conditions:condition-1' : cond.id, synthetic: mode === 'demo' }], recordsConnection: { ...connection, mode, categories: [...connection.categories], subject: mode === 'demo' ? 'patient-demo-001' : connection.subject } })
  await db.recordsConnection.update('primary', { pendingSession: { id: 'cs_0123456789abcdef0123', externalId: 'abcdefghijklmnop', categories: ['conditions'], startedAt: now } })
  const generation = (await getConnection()).generation
  const labs = normalizeFinchnodeHealthRecord(liveFixture, { syncedAt: now, categories: ['labs'] }).records
  const nextSubject = 'u_ffffffffffffffff'
  await applyImport({ ...payload(), medicalRecords: labs, recordsConnection: { ...payload().recordsConnection!, subject: nextSubject, categories: ['labs'] } })
  expect(await listRecords()).toEqual(labs)
  const next = await getConnection()
  expect(next.subject).toBe(nextSubject)
  expect(next.categories).toEqual(['labs'])
  expect(next.pendingSession).toBeUndefined()
  expect(next.generation).toBe(generation + 1)
  await applyImport({ ...payload(), healthProfiles: [], regimenRecords: [], missedDoseEvents: [], medicalRecords: [], recordsConnection: null })
  expect(await db.healthProfiles.count()).toBe(0)
  expect(await db.regimenRecords.count()).toBe(0)
  expect(await db.missedDoseEvents.count()).toBe(0)
})
it('rolls back every imported table if the final connection write fails', async () => {
  await applyImport(canonical())
  const before = await collectExport()
  const fail = () => { throw new Error('Injected final table failure') }
  db.recordsConnection.hook('creating', fail)
  try {
    const replacement = canonical()
    replacement.dailyLogs[0].notes = 'Replacement'
    replacement.settings[0].value = 'cycle'
    replacement.contentBookmarks = []
    replacement.healthProfiles[0].displayName = 'Changed'
    replacement.regimenRecords = []
    replacement.missedDoseEvents = []
    replacement.medicalRecords = []
    await expect(applyImport(replacement)).rejects.toThrow('Injected final table failure')
  } finally { db.recordsConnection.hook('creating').unsubscribe(fail) }
  const after = await collectExport()
  expect({ ...after, exportedAt: before.exportedAt }).toEqual(before)
})
it.each([
  { medicalRecords: [{ ...cond, name: null }] }, { medicalRecords: [{ ...cond, id: 'unstable' }] }, { healthProfiles: [{}] },
  { regimenRecords: [{ id: 'missing-fields' }] }, { missedDoseEvents: [{}] }, { dailyLogs: [{ date: 'invalid' }] }, { settings: [{ key: 'x', value: 42 }] }, { contentBookmarks: [null] }, { recordsConnection: { id: 'primary' } }, { v: 3 },
])('validates the entire payload before any sealing/write: %j', async bad => {
  await applyImport(canonical())
  const seal = vi.spyOn(cryptoSealed, 'seal')
  const before = await collectExport()
  await expect(applyImport({ ...payload(), ...bad })).rejects.toThrow()
  expect(seal).not.toHaveBeenCalled()
  const after = await collectExport()
  expect({ ...after, exportedAt: before.exportedAt }).toEqual(before)
})
it('excludes every security setting and all vault values in a single transfer', async () => {
  const keys = [SK.pinSalt, SK.pinHash, SK.aiKey, 'recoveryCode', SK.biometricLock, SK.deviceUnlockCredential, ...Object.values(SECURE_SECRET_KEYS)]
  for (const key of keys) await db.settings.put({ key, value: `secret-${key}` })
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'vault-token' }))
  await setSecureSecret(SECURE_SECRET_KEYS.openAiApiKey, 'vault-ai-secret')
  await applyImport({ ...canonical(), settings: [...canonical().settings, ...keys.map(key => ({ key, value: `incoming-${key}` }))] })
  const exported = await collectExport()
  expect(JSON.stringify(exported)).not.toMatch(/secret-|incoming-|vault-token|vault-ai-secret/)
  expect(exported.settings.find(s => s.key === SK.recordsRelayUrl)?.value).toBe('https://relay.test')
  for (const key of keys) expect(await getSetting(key)).toBe(`secret-${key}`)
})
it.each([1, 2])('import v%s changing relay A to B disables the old connection and deletes its bound token', async version => {
  await applyImport(canonical())
  await db.recordsConnection.update('primary', { status: 'connected' })
  const generation = (await getConnection()).generation
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok-A' }))
  const input = { ...canonical(), v: version, settings: [{ key: SK.recordsRelayUrl, value: 'https://relay-b.test/' }] }
  await applyImport(input)
  expect(await getSetting(SK.recordsRelayUrl)).toBe('https://relay-b.test')
  expect((await getConnection()).status).toBe('disconnected')
  expect((await getConnection()).generation).toBeGreaterThan(generation)
  expect(await listRecords()).toEqual([cond])
  expect(await getSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken)).toBeNull()
})
it.each(['http://localhost.evil', 'http://127.0.0.1.evil', 'https://user:pass@relay.test', 'https://relay.test?token=x', 'https://relay.test#token'])('rejects unsafe imported relay URL before writing: %s', async value => {
  await applyImport(canonical())
  await expect(applyImport({ ...payload(), settings: [{ key: SK.recordsRelayUrl, value }] })).rejects.toThrow()
  expect(await getSetting(SK.recordsRelayUrl)).toBe('https://relay.test')
})
it('same URL import preserves a locally saved binding but never activates an imported connection', async () => {
  await applyImport(canonical())
  const envelope = JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok-A' })
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, envelope)
  await applyImport({ ...canonical(), settings: [{ key: SK.recordsRelayUrl, value: 'https://relay.test///' }] })
  expect(await getSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken)).toBe(envelope)
  expect((await getConnection()).status).toBe('disconnected')
})
