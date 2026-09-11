import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getSetting, setSetting, SK } from '../db/schema'
import * as deviceUnlock from '../platform/deviceUnlock'
import * as notifications from '../platform/notifications'
import * as secureVault from '../platform/secureVault'
import { KEY_DB_NAME } from '../platform/keyStore'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { saveRelayUrl, saveRelayToken, setDeviceUnlockEnabled } from './Settings'
import { wipeLocalData } from '../lib/dataWipe'
import type { HealthSample } from '../lib/healthImport'
import {
  groupHealthSamples,
  groupHealthSamplesWithProvenance,
} from '../lib/healthImport'

function sample(type: HealthSample['type'], value: HealthSample['value']): HealthSample {
  return {
    id: `${type}-${String(value)}`,
    type,
    startDate: '2026-07-25T10:00:00.000Z',
    endDate: '2026-07-25T11:00:00.000Z',
    value,
    unit: '',
  }
}

describe('health import mapping', () => {
  it('normalizes and aggregates supported samples by local tracker day', () => {
    const grouped = groupHealthSamples([
      sample('menstrualFlow', 'heavy'),
      sample('basalBodyTemperature', 36.72),
      sample('ovulationTest', 'positive'),
      sample('weight', 64.36),
      sample('sleep', 180),
      sample('sleep', 245),
      sample('steps', 4200),
      sample('steps', 3100),
    ])

    expect(grouped.get('2026-07-25')).toEqual({
      flow: 'heavy',
      bbt: 3672,
      opk: 'positive',
      weightKg: 64.4,
      sleepMinutes: 425,
      steps: 7300,
    })
  })

  it('does not guess raw platform category enum values', () => {
    const grouped = groupHealthSamples([
      sample('menstrualFlow', 3),
      sample('ovulationTest', 1),
    ])
    expect(grouped.get('2026-07-25')).toBeUndefined()
  })

  it('deduplicates native sample identifiers before summing measurements', () => {
    const duplicate = {
      ...sample('steps', 4200),
      id: 'same-healthkit-uuid',
    }
    const grouped = groupHealthSamples([duplicate, duplicate])
    expect(grouped.get('2026-07-25')?.steps).toBe(4200)
  })

  it('uses the native device-calendar day instead of truncating a UTC timestamp', () => {
    const grouped = groupHealthSamples([
      {
        ...sample('menstrualFlow', 'medium'),
        startDate: '2026-07-26T01:30:00.000Z',
        localDate: '2026-07-25',
      },
    ])
    expect(grouped.get('2026-07-25')?.flow).toBe('medium')
    expect(grouped.has('2026-07-26')).toBe(false)
  })

  it('keeps source UUIDs and HealthKit cycle-start metadata with imported flow', () => {
    const record: HealthSample = {
      ...sample('menstrualFlow', 'light'),
      id: 'flow-uuid',
      source: 'Health',
      sourceBundleIdentifier: 'com.apple.Health',
      metadata: {
        menstrualCycleStart: true,
        wasUserEntered: true,
      },
    }
    const grouped = groupHealthSamplesWithProvenance([record], 'apple-health')
    expect(grouped.days.get('2026-07-25')?.provenance.flow).toEqual({
      provider: 'apple-health',
      sampleIds: ['flow-uuid'],
      sourceNames: ['Health'],
      menstrualCycleStart: true,
    })
  })
})


describe('Settings browser privacy actions', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()))
    })
    await secureVault.destroySecureVault()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requires a PIN before starting device enrollment', async () => {
    const enroll = vi.spyOn(deviceUnlock, 'enrollDeviceUnlock')
    await expect(setDeviceUnlockEnabled(true, false)).rejects.toThrow('Set a PIN first')
    expect(enroll).not.toHaveBeenCalled()
    expect(await getSetting(SK.biometricLock)).toBeUndefined()
  })

  it('enrolls a new authenticator before enabling the device gate', async () => {
    const enroll = vi.spyOn(deviceUnlock, 'enrollDeviceUnlock').mockImplementation(async () => {
      expect(await getSetting(SK.biometricLock)).toBeUndefined()
      await setSetting(SK.deviceUnlockCredential, 'enrolled-device')
      return { credentialId: 'enrolled-device' }
    })
    const status = vi.spyOn(deviceUnlock, 'getBiometricStatus')
    await setDeviceUnlockEnabled(true, true)
    expect(enroll).toHaveBeenCalledOnce()
    expect(status).not.toHaveBeenCalled()
    expect(await getSetting(SK.biometricLock)).toBe('1')
    expect(await getSetting(SK.deviceUnlockCredential)).toBe('enrolled-device')
    await setDeviceUnlockEnabled(false, true)
    expect(await getSetting(SK.biometricLock)).toBeUndefined()
    expect(await getSetting(SK.deviceUnlockCredential)).toBeUndefined()
  })

  it('leaves the flag off when device enrollment fails', async () => {
    vi.spyOn(deviceUnlock, 'enrollDeviceUnlock').mockRejectedValue(new Error('Cancelled'))
    await expect(setDeviceUnlockEnabled(true, true)).rejects.toThrow('Cancelled')
    expect(await getSetting(SK.biometricLock)).toBeUndefined()
  })

  it('stops reminders, clears every app table inside vault destruction, then reloads', async () => {
    for (const table of db.tables) {
      await table.put({ [table.schema.primKey.keyPath as string]: 'wipe-test-record' })
      expect(await table.count()).toBe(1)
    }
    await secureVault.setSecureSecret('openai-api-key', 'private-test-key')
    const order: string[] = []
    const stop = notifications.stopReminderScheduler
    vi.spyOn(notifications, 'stopReminderScheduler').mockImplementation(async () => {
      order.push('stop')
      await stop()
    })
    const destroy = secureVault.destroySecureVault
    vi.spyOn(secureVault, 'destroySecureVault').mockImplementation(async (clearAppData) => {
      order.push('destroy')
      expect(clearAppData).toBeTypeOf('function')
      await destroy(clearAppData)
      order.push('destroyed')
    })
    const reload = vi.fn(() => { order.push('reload') })
    await wipeLocalData(reload)
    expect(order).toEqual(['stop', 'destroy', 'destroyed', 'reload'])
    expect(reload).toHaveBeenCalledOnce()
    for (const table of db.tables) expect(await table.count()).toBe(table.name === 'recordsConnection' ? 1 : 0)
    expect(await db.recordsConnection.get('primary')).toMatchObject({ status: 'disconnected' })
    expect(await db.recordsConnection.get('primary')).not.toHaveProperty('subject')
    expect(await secureVault.getSecureSecret('openai-api-key')).toBeNull()
  })

  it('propagates a blocked key deletion with the exact retry message and never reloads', async () => {
    await secureVault.setSecureSecret('openai-api-key', 'private-test-key')
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(KEY_DB_NAME, 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const reload = vi.fn()
    try {
      await expect(wipeLocalData(reload)).rejects.toThrow('Close other Lunara tabs and try again.')
      expect(reload).not.toHaveBeenCalled()
    } finally {
      blocker.close()
    }
  })

  it('rolls back app clearing and does not reload when any table clear fails', async () => {
    await db.dailyLogs.put({ date: '2026-09-01', flow: 'light' })
    await setSetting(SK.pinHash, 'pin-hash')
    const tablePrototype = Object.getPrototypeOf(db.settings)
    const clear = tablePrototype.clear
    vi.spyOn(tablePrototype, 'clear').mockImplementation(function (this: typeof db.settings) {
      return this.name === 'settings'
        ? Promise.reject(new Error('Storage failed'))
        : clear.call(this)
    })
    const reload = vi.fn()
    await expect(wipeLocalData(reload)).rejects.toThrow('Storage failed')
    expect(reload).not.toHaveBeenCalled()
    expect(await db.dailyLogs.count()).toBe(1)
    expect(await getSetting(SK.pinHash)).toBe('pin-hash')
  })
})

import { loadRelaySettings } from '../records/relaySettings'
import { getConnection, listRecords, putSnapshot } from '../records/store'
import { grantRecordsConsent, startConnection, syncSnapshot, completePendingConnection } from '../records/connect'
import type { ConnectSessionState, RecordsProvider, RecordsSnapshot } from '../records/providers/types'
const relayId = 'cs_0123456789abcdef0123'
const recordsSnapshot: RecordsSnapshot = { records: [], syncStatus: 'complete', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], sources: [], warnings: [], failure: null, consentReceiptIds: [], skipped: 0, additionalItems: 0, synthetic: false }
describe('Settings records relay binding', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    for (const table of db.tables) await table.clear()
    await secureVault.destroySecureVault()
    vi.stubGlobal('location', { origin: 'https://app.test' })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const connected = async () => {
    await saveRelayUrl('https://relay-a.test')
    await saveRelayToken('https://relay-a.test', 'tok-A')
    await grantRecordsConsent()
    const provider: RecordsProvider = { mode: 'live', startConnect: vi.fn(async () => ({ sessionId: relayId, redirectUrl: 'https://connect.test/s', completed: false, subject: null, expiresAt: null })), getSession: vi.fn(async (): Promise<ConnectSessionState> => ({ id: relayId, status: 'completed', subject: 'u_0123456789abcdef', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], warnings: [], failure: null, expiresAt: null })), fetchSnapshot: vi.fn(async () => recordsSnapshot) }
    await startConnection(['labs'], { provider, navigate: vi.fn() })
    await completePendingConnection({ isReturn: true, sessionId: relayId, invalidSession: false }, { provider })
    await putSnapshot([{ id: 'live:labs:rec_000000000000000000000001', category: 'labs', sourceRecordId: 'lab-1', sourceName: 'Clinic', date: null, codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: false, name: 'Cached lab', value: 1, unit: null, status: null, referenceRange: null, interpretation: null }], ['labs'], { expectedGeneration: (await getConnection()).generation })
    vi.mocked(provider.fetchSnapshot).mockClear()
    return provider
  }
  it.each(['https://relay-b.test', ''])('disconnects URL edits to %s, retains the snapshot and removes the token', async next => {
    const provider = await connected(), before = await getConnection(), rows = await listRecords()
    await saveRelayUrl(next)
    expect((await getConnection()).status).toBe('disconnected')
    expect((await getConnection()).generation).toBe(before.generation + 1)
    expect((await getConnection()).subject).toBe(before.subject)
    expect((await getConnection()).pendingSession).toBeUndefined()
    expect(await listRecords()).toEqual(rows)
    expect(await secureVault.getSecureSecret(secureVault.SECURE_SECRET_KEYS.recordsRelayToken)).toBeNull()
    await syncSnapshot({ provider })
    expect(provider.fetchSnapshot).not.toHaveBeenCalled()
  })
  it('canonical-equivalent URLs keep the connection and token', async () => {
    await connected()
    const before = await getConnection()
    await saveRelayUrl('https://RELAY-A.test:443///')
    expect(await getConnection()).toEqual(before)
    expect(await loadRelaySettings()).toEqual({ baseUrl: 'https://relay-a.test', token: 'tok-A', tokenRelayBaseUrl: 'https://relay-a.test' })
  })
  it.each(['http://localhost.evil', 'http://127.0.0.1.evil', 'https://user:pass@relay.test', 'https://relay.test?key=x', 'https://relay.test#x'])('rejects unsafe saved URL %s before writes', async input => {
    await saveRelayUrl('https://relay-a.test')
    await expect(saveRelayUrl(input)).rejects.toThrow()
    expect(await getSetting(SK.recordsRelayUrl)).toBe('https://relay-a.test')
  })
  it('only reports a token saved when its binding matches and rejects a stale form', async () => {
    await saveRelayUrl('https://relay-a.test')
    await secureVault.setSecureSecret(secureVault.SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay-a.test.evil', token: 'tok' }))
    expect((await loadRelaySettings()).token).toBeNull()
    await saveRelayUrl('https://relay-b.test')
    await expect(saveRelayToken('https://relay-a.test', 'tok-A')).rejects.toThrow(/changed in another tab/)
    await expect(saveRelayToken('https://relay-b.test', '')).rejects.toThrow(/required/)
    expect((await loadRelaySettings()).token).toBeNull()
  })
  it('serializes a suspended token save with endpoint changes and cleans the old credential', async () => {
    await saveRelayUrl('https://relay-a.test')
    let release!: () => void, entered!: () => void
    const waiting = new Promise<void>(r => { entered = r }), held = new Promise<void>(r => { release = r })
    const save = secureVault.setSecureSecret
    vi.spyOn(secureVault, 'setSecureSecret').mockImplementationOnce(async (...args) => { entered(); await held; return save(...args) })
    const saving = saveRelayToken('https://relay-a.test', 'tok-A')
    await waiting
    const changing = saveRelayUrl('https://relay-b.test')
    release()
    await Promise.all([saving, changing])
    expect(await getSetting(SK.recordsRelayUrl)).toBe('https://relay-b.test')
    expect((await loadRelaySettings()).token).toBeNull()
  })
  it('reports token cleanup failure after disabling live access', async () => {
    const p = await connected()
    vi.spyOn(secureVault, 'deleteSecureSecret').mockRejectedValueOnce(new Error('private vault details'))
    await expect(saveRelayUrl('https://relay-b.test')).rejects.toThrow(/old token could not be removed/)
    expect((await getConnection()).status).toBe('disconnected')
    expect((await loadRelaySettings()).token).toBeNull()
    await syncSnapshot({ provider: p })
    expect(p.fetchSnapshot).not.toHaveBeenCalled()
  })
})
it('does not recreate a relay credential when its save queued behind vault destruction', async () => {
  installLifecycleLocks()
  for (const table of db.tables) await table.clear()
  await saveRelayUrl('https://relay-a.test')
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>(r => { entered = r }), held = new Promise<void>(r => { release = r })
  const destroying = secureVault.destroySecureVault(async () => { entered(); await held; await db.settings.clear() })
  await waiting
  const saving = saveRelayToken('https://relay-a.test', 'must-not-reappear')
  const rejected = expect(saving).rejects.toThrow(/changed in another tab/)
  release()
  await destroying
  await rejected
  expect(await secureVault.getSecureSecret(secureVault.SECURE_SECRET_KEYS.recordsRelayToken)).toBeNull()
  vi.unstubAllGlobals()
})
