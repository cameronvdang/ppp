// app/src/records/store.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, putHealthProfile, PppDB, createDefaultHealthProfile, getSetting, SK } from '../db/schema'
import { deleteKeyStore } from '../platform/keyStore'
import type { MedicalRecord } from './types'
import { defaultConnection, transitionConnection, clearRecords, countByCategory, getConnection, listRecords, putConnection, putSnapshot } from './store'

const lab = (id: string, date: string | null): MedicalRecord => ({ id: `demo:labs:${id}`, category: 'labs', sourceRecordId: id, sourceName: 'S', date, codes: [], syncedAt: 'now', synthetic: true, name: `Lab ${id}`, value: 1, unit: 'u', status: 'final', referenceRange: null, interpretation: null })
const med = (id: string): MedicalRecord => ({ id: `demo:medications:${id}`, category: 'medications', sourceRecordId: id, sourceName: 'S', date: '2026-01-01', codes: [], syncedAt: 'now', synthetic: true, name: `Med ${id}`, dosage: null, frequency: null, status: 'active', startDate: '2026-01-01', endDate: null, prescriber: null, reason: null })

describe('records store', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await clearRecords()
    await deleteKeyStore()
    await putHealthProfile({ privacy: { consentLedger: [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: '2026-09-11T00:00:00Z' }] } })
  })

  it('starts disconnected with all categories selected', async () => {
    expect(await getConnection()).toMatchObject({ id: 'primary', status: 'disconnected', categories: expect.arrayContaining(['labs', 'vitals']) })
  })

  it('stores sealed rows and reads them back sorted by date', async () => {
    await putSnapshot([lab('a', '2026-02-01'), lab('b', null), lab('c', '2026-03-01')], ['labs'], { status: 'connected', mode: 'demo', expectedGeneration: (await getConnection()).generation })
    const raw = await db.medicalRecords.toArray()
    expect(JSON.stringify(raw)).not.toContain('Lab a')
    expect(raw[0].sealed.v).toBe(1)
    const labs = await listRecords('labs')
    expect(labs.map((r) => r.sourceRecordId)).toEqual(['c', 'a', 'b'])
    expect((await getConnection()).status).toBe('connected')
  })

  it('refresh replaces only the refreshed categories', async () => {
    await putSnapshot([lab('a', '2026-02-01'), med('m1')], ['labs', 'medications'], { expectedGeneration: (await getConnection()).generation })
    await putSnapshot([lab('z', '2026-04-01')], ['labs'], { expectedGeneration: (await getConnection()).generation })
    expect(await countByCategory()).toMatchObject({ labs: 1, medications: 1 })
    expect((await listRecords('labs'))[0].sourceRecordId).toBe('z')
  })

  it('clearRecords empties records and keeps a disconnected generation tombstone', async () => {
    await putSnapshot([med('m1')], ['medications'], { status: 'connected', expectedGeneration: (await getConnection()).generation })
    await putConnection({ subject: 'u_x', expectedGeneration: (await getConnection()).generation })
    await clearRecords()
    expect(await db.medicalRecords.count()).toBe(0)
    expect((await getConnection()).status).toBe('disconnected')
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })



import Dexie, { liveQuery } from 'dexie'
import * as sealed from '../crypto/sealed'
import { destroySecureVault } from '../platform/secureVault'
import { wipeLocalData } from '../lib/dataWipe'

it('migrates an actual v3 database preserving all historical tables', async () => {
  const name = 'ppp-v3-migration'
  const old = new Dexie(name)
  old.version(3).stores({ dailyLogs: 'date', cycles: 'startDate', settings: 'key', contentBookmarks: 'slug', healthProfiles: 'id', regimenRecords: 'id, method, startDate, [method+startDate]', missedDoseEvents: 'id, regimenId, date, [regimenId+date]' })
  const rows: Record<string, object> = {
    dailyLogs: { date: '2026-09-01', flow: 'light' }, cycles: { startDate: '2026-09-01' }, settings: { key: 'goal', value: 'ttc' },
    contentBookmarks: { slug: 'cycle', savedAt: '2026-09-01' }, healthProfiles: createDefaultHealthProfile(),
    regimenRecords: { id: 'regimen-1', method: 'barrier', startDate: '2026-01-01', config: { kind: 'barrier' }, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    missedDoseEvents: { id: 'missed-1', regimenId: 'regimen-1', date: '2026-01-02', kind: 'missed', createdAt: '2026-01-02' },
  }
  for (const [table, row] of Object.entries(rows)) await old.table(table).put(row)
  old.close()
  const upgraded = new PppDB(name)
  try {
    await upgraded.open()
    expect(upgraded.verno).toBe(4)
    for (const [table, row] of Object.entries(rows)) expect(await upgraded.table(table).toArray()).toEqual([row])
    expect(await upgraded.medicalRecords.count()).toBe(0)
    expect(await upgraded.recordsConnection.count()).toBe(0)
  } finally { upgraded.close(); await Dexie.delete(name) }
})

it('emits absent connection in liveQuery without writes or a feedback loop', async () => {
  await db.recordsConnection.clear()
  let writes = 0
  const creating = () => { writes++ }
  db.recordsConnection.hook('creating', creating)
  const emissions: unknown[] = []
  let subscription: { unsubscribe(): void } | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      subscription = liveQuery(getConnection).subscribe({ next: value => { emissions.push(value); resolve() }, error: reject })
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(emissions).toEqual([defaultConnection()])
    expect(writes).toBe(0)
    expect(await db.recordsConnection.count()).toBe(0)
  } finally { subscription?.unsubscribe(); db.recordsConnection.hook('creating').unsubscribe(creating) }
})

it('preserves missing ciphertext on partial refresh; complete empty clears; not-started keeps timestamp', async () => {
  installLifecycleLocks()
  await clearRecords()
  await putHealthProfile({ privacy: { consentLedger: [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: 'now' }] } })
  const expectedGeneration = (await getConnection()).generation
  await putSnapshot([lab('a', null), med('m')], ['labs', 'medications'], { expectedGeneration, lastSyncAt: 'before' })
  const before = await db.medicalRecords.get('demo:medications:m')
  await putSnapshot([lab('b', null)], ['labs'], { expectedGeneration, syncStatus: 'partial', availableCategories: ['labs'], missingCategories: ['medications'] })
  expect(await db.medicalRecords.get('demo:medications:m')).toEqual(before)
  await putSnapshot([], ['labs'], { expectedGeneration, syncStatus: 'complete' })
  expect(await listRecords('labs')).toEqual([])
  await putConnection({ expectedGeneration, syncStatus: 'not_started' })
  expect(await db.medicalRecords.get('demo:medications:m')).toEqual(before)
  expect((await getConnection()).lastSyncAt).toBe('before')
})

for (const action of ['clear', 'disconnect', 'wipe', 'revoke', 'relay-change'] as const) {
  it(`rejects suspended sealing and error commits after independent-client ${action}`, async () => {
    installLifecycleLocks()
    await clearRecords()
    await putHealthProfile({ privacy: { consentLedger: [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: 'now' }] } })
    if (action === 'relay-change') {
      await db.settings.put({ key: SK.recordsRelayUrl, value: 'https://relay.test' })
      await transitionConnection(c => ({ ...c, mode: 'live', relayBaseUrl: 'https://relay.test' }))
    }
    const expectedGeneration = (await getConnection()).generation
    let release!: () => void, entered!: () => void
    const enteredSeal = new Promise<void>(r => { entered = r })
    const held = new Promise<void>(r => { release = r })
    const realSeal = sealed.seal
    vi.spyOn(sealed, 'seal').mockImplementationOnce(async (...args) => { entered(); await held; return realSeal(...args) })
    const writing = putSnapshot([lab('late', null)], ['labs'], { expectedGeneration, subject: 'late-subject' })
    await enteredSeal
    const other = new PppDB()
    let destruction: Promise<void> | undefined
    try {
      await other.transaction('rw', other.recordsConnection, other.medicalRecords, other.healthProfiles, other.settings, async () => {
        if (action === 'revoke') {
          const profile = (await other.healthProfiles.get('primary'))!
          await other.healthProfiles.put({ ...profile, privacy: { ...profile.privacy, consentLedger: [{ purpose: 'medical-records', state: 'declined', version: 1, decidedAt: 'now' }] } })
        } else if (action === 'relay-change') await other.settings.put({ key: SK.recordsRelayUrl, value: 'https://other-relay.test' })
        else {
          await other.recordsConnection.put({ ...defaultConnection(), generation: expectedGeneration + 1 })
          await other.medicalRecords.clear()
          if (action === 'wipe') await other.healthProfiles.clear()
        }
      })
      if (action === 'wipe') destruction = destroySecureVault(async () => { await other.medicalRecords.clear() })
      release()
      expect(await writing).toBe(false)
      expect(await putConnection({ expectedGeneration, status: 'error', lastError: 'Late error' })).toBe(false)
      await destruction
      expect(await db.medicalRecords.count()).toBe(0)
      expect((await getConnection()).subject).toBeUndefined()
      expect((await getConnection()).lastError).toBeUndefined()
    } finally { release(); other.close() }
  })
}
it('removes deselected categories in the same generation transition', async () => {
  installLifecycleLocks()
  await clearRecords()
  await putHealthProfile({ privacy: { consentLedger: [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: 'now' }] } })
  await putSnapshot([lab('a', null), med('m')], ['labs', 'medications'], { expectedGeneration: (await getConnection()).generation })
  await transitionConnection(c => ({ ...c, categories: ['labs'] }), { requireConsent: true })
  expect(await listRecords('medications')).toEqual([])
  expect(await listRecords('labs')).toHaveLength(1)
})
it('full wipe retains a nonpersonal monotonic tombstone and removes consent', async () => {
  installLifecycleLocks()
  await clearRecords()
  const generation = (await getConnection()).generation
  await wipeLocalData(() => {})
  expect((await getConnection()).generation).toBeGreaterThan(generation)
  expect(await db.healthProfiles.count()).toBe(0)
  expect(await getSetting(SK.recordsRelayUrl)).toBeUndefined()
  expect(await db.recordsConnection.toArray()).toEqual([{ ...defaultConnection(), generation: (await getConnection()).generation }])
})
