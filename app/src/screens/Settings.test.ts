import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getSetting, setSetting, SK } from '../db/schema'
import * as deviceUnlock from '../platform/deviceUnlock'
import * as notifications from '../platform/notifications'
import * as secureVault from '../platform/secureVault'
import { KEY_DB_NAME } from '../platform/keyStore'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { setDeviceUnlockEnabled } from './Settings'
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
    for (const table of db.tables) expect(await table.count()).toBe(0)
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
