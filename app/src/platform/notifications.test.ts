// app/src/platform/notifications.test.ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, SK } from '../db/schema'
import {
  defaultReminderPreferences,
  REMINDER_SETTINGS_KEY,
  serializeReminderPreferences,
} from '../engine/reminderPreferences'
import type { MaterializedReminderRequest } from '../engine/reminders'
import * as notifications from './notifications'
import {
  cancelDailyReminder,
  cancelMaterializedReminders,
  msUntilNextOccurrence,
  notificationPermission,
  pendingDailyReminder,
  pendingInSessionTimers,
  scheduleDailyReminder,
  scheduleMaterializedReminders,
} from './notifications'

describe('in-session reminders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T08:00:00'))
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }))
    vi.stubGlobal('navigator', {})
  })
  afterEach(async () => {
    await cancelDailyReminder()
    await cancelMaterializedReminders()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('computes the delay to the next HH:MM, rolling to tomorrow when passed', () => {
    const now = new Date('2026-09-11T08:00:00')
    expect(msUntilNextOccurrence('09:30', now)).toBe(90 * 60_000)
    expect(msUntilNextOccurrence('07:00', now)).toBe(23 * 60 * 60_000)
  })

  it('reports permission from the Notification API', async () => {
    expect(await notificationPermission()).toBe('granted')
    ;(globalThis as any).Notification.permission = 'default'
    expect(await notificationPermission()).toBe('not-requested')
    expect(await notificationPermission(true)).toBe('granted')
  })

  it('fires the daily reminder at the requested time and re-arms', async () => {
    await scheduleDailyReminder('08:05')
    expect(await pendingDailyReminder()).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect((globalThis as any).Notification).toHaveBeenCalledWith('Lunara', expect.objectContaining({ body: expect.any(String) }))
    expect(await pendingDailyReminder()).toBe(true)
  })

  it('rejects malformed times and unsupported permission', async () => {
    for (const time of ['25:99', '9:00', '09:0', '09:00:00', ' 09:00']) {
      await expect(scheduleDailyReminder(time)).rejects.toThrow(/HH:MM/)
    }
    ;(globalThis as any).Notification.permission = 'denied'
    ;(globalThis as any).Notification.requestPermission = vi.fn(async () => 'denied')
    await expect(scheduleDailyReminder('09:00')).rejects.toThrow(/permission/)
  })

  it('schedules only requests due within 24 hours', async () => {
    const base = Date.now()
    await scheduleMaterializedReminders([
      { id: 1, reminderId: 'r1', occurrenceKey: 'a', kind: 'water', route: 'today', state: 'scheduled', title: 'Lunara', body: 'Sip', fireAt: new Date(base + 60_000).toISOString() } as any,
      { id: 2, reminderId: 'r1', occurrenceKey: 'b', kind: 'water', route: 'today', state: 'scheduled', title: 'Lunara', body: 'Sip', fireAt: new Date(base + 30 * 60 * 60_000).toISOString() } as any,
    ])
    expect(pendingInSessionTimers()).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((globalThis as any).Notification).toHaveBeenCalledTimes(1)
  })
})

const realSetTimeout = globalThis.setTimeout
const minute = 60_000
const hour = 60 * minute
const clients = new Set([notifications])
const databases = new Set([db])

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function request(delay = minute, occurrenceKey = 'occurrence'): MaterializedReminderRequest {
  return {
    id: 1, reminderId: 'water', occurrenceKey, kind: 'water', route: 'today',
    state: 'scheduled', title: 'Lunara', body: 'Sip',
    fireAt: new Date(Date.now() + delay).toISOString(),
  }
}

async function savePreferences(enabled = true, time = '08:05') {
  const preferences = defaultReminderPreferences({
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    startDate: '2026-09-11', permission: 'not-requested',
  })
  preferences.plans[0].enabled = enabled
  preferences.plans[0].localTime = time
  await db.settings.put({ key: REMINDER_SETTINGS_KEY, value: serializeReminderPreferences(preferences) })
}

// fake-indexeddb queues native tasks. Keep those real while advancing only the
// application clock/timers, and drain storage/liveQuery before the next jump.
async function settleStorage() {
  await new Promise((resolve) => realSetTimeout(resolve, 15))
  await vi.advanceTimersByTimeAsync(0)
  await new Promise((resolve) => realSetTimeout(resolve, 15))
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await settleStorage()
}

async function clientWithPausedSubscription() {
  vi.doMock('dexie', async (importOriginal) => ({
    ...await importOriginal<typeof import('dexie')>(),
    // Model another tab whose liveQuery change notification has not arrived yet.
    liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
  }))
  vi.resetModules()
  try {
    const client = await import('./notifications')
    const database = (await import('../db/schema')).db
    clients.add(client)
    databases.add(database)
    return { client, database }
  } finally {
    vi.doUnmock('dexie')
  }
}

describe('reminder scheduler and delivery', () => {
  let documentStub: EventTarget & { visibilityState: string }
  let center: Map<string, NotificationOptions>
  let NotificationMock: ReturnType<typeof vi.fn> & {
    permission: string
    requestPermission: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    await db.open()
    await db.settings.clear()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-09-11T08:00:00'))
    documentStub = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('document', documentStub)
    vi.stubGlobal('navigator', {})
    center = new Map()
    NotificationMock = Object.assign(vi.fn((_title: string, options: NotificationOptions) => {
      center.set(options.tag!, options)
    }), { permission: 'granted', requestPermission: vi.fn(async () => 'granted') })
    vi.stubGlobal('Notification', NotificationMock)
  })

  afterEach(async () => {
    for (const client of clients) await client.stopReminderScheduler()
    await settleStorage()
    for (const database of databases) database.close()
    clients.clear()
    clients.add(notifications)
    databases.clear()
    databases.add(db)
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads saved preferences without prompting and starts only one scheduler', async () => {
    await savePreferences()
    const addListener = vi.spyOn(documentStub, 'addEventListener')
    await notifications.startReminderScheduler()
    await notifications.startReminderScheduler()
    expect(pendingInSessionTimers()).toBe(1)
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    expect(addListener).toHaveBeenCalledTimes(1)
    expect(NotificationMock.requestPermission).not.toHaveBeenCalled()
    await advance(5 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    expect([...center.keys()][0]).toBe('settings-cycle:settings-cycle:2026-09-11:08:05')
  })

  it('slides the hourly window and delivers the next day after more than 24 hours', async () => {
    await savePreferences()
    await notifications.startReminderScheduler()
    await settleStorage()
    await advance(5 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    await advance(55 * minute)
    for (let elapsed = 1; elapsed < 24; elapsed += 1) await advance(hour)
    await advance(5 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(2)
    expect([...center.keys()]).toEqual([
      'settings-cycle:settings-cycle:2026-09-11:08:05',
      'settings-cycle:settings-cycle:2026-09-12:08:05',
    ])
  })

  it('deduplicates occurrences across independent module clients with stable tags', async () => {
    await savePreferences()
    vi.resetModules()
    const other = await import('./notifications')
    clients.add(other)
    databases.add((await import('../db/schema')).db)
    expect(other).not.toBe(notifications)
    await Promise.all([notifications.startReminderScheduler(), other.startReminderScheduler()])
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    expect(other.pendingInSessionTimers()).toBe(1)
    await advance(5 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(2)
    expect(center.size).toBe(1)
    expect(NotificationMock.mock.calls[0][1].tag).toBe(NotificationMock.mock.calls[1][1].tag)
    await savePreferences(false)
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(0)
    expect(other.pendingInSessionTimers()).toBe(0)
  })

  it.each(['disable', 'wipe'] as const)('observes a persisted %s and cancels timers', async (change) => {
    await savePreferences()
    await notifications.startReminderScheduler()
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    if (change === 'disable') await savePreferences(false)
    else await db.settings.clear()
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(0)
    await advance(5 * minute)
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('cancels all timers on permission denial without prompting', async () => {
    await savePreferences()
    await notifications.startReminderScheduler()
    await settleStorage()
    await scheduleDailyReminder('08:10')
    NotificationMock.permission = 'denied'
    await notifications.refreshReminderScheduler()
    expect(pendingInSessionTimers()).toBe(0)
    expect(await pendingDailyReminder()).toBe(false)
    expect(NotificationMock.requestPermission).not.toHaveBeenCalled()
  })

  it('refreshes when visible, and stop removes the listener, interval, and subscription', async () => {
    await savePreferences()
    const removeListener = vi.spyOn(documentStub, 'removeEventListener')
    await notifications.startReminderScheduler()
    await settleStorage()
    await cancelMaterializedReminders()
    documentStub.visibilityState = 'hidden'
    documentStub.dispatchEvent(new Event('visibilitychange'))
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(0)
    documentStub.visibilityState = 'visible'
    documentStub.dispatchEvent(new Event('visibilitychange'))
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    await notifications.stopReminderScheduler()
    expect(removeListener).toHaveBeenCalledTimes(1)
    documentStub.dispatchEvent(new Event('visibilitychange'))
    await savePreferences(true, '08:10')
    await advance(hour)
    expect(pendingInSessionTimers()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('loads the legacy daily time and includes occurrence dates in legacy daily tags', async () => {
    await db.settings.put({ key: SK.reminderTime, value: '08:05' })
    await notifications.startReminderScheduler()
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    await notifications.stopReminderScheduler()
    await scheduleDailyReminder('08:05')
    await advance(5 * minute)
    await advance(24 * hour)
    expect([...center.keys()]).toEqual(['lunara-daily:2026-09-11:08:05', 'lunara-daily:2026-09-12:08:05'])
  })

  it('caps unique timers at 64, excludes past/invalid/far dates, and cancels replacements', async () => {
    const requests = Array.from({ length: 70 }, (_, index) => request(minute + index, String(index)))
    await scheduleMaterializedReminders([
      request(-1, 'past'), { ...request(), fireAt: 'invalid' }, request(25 * hour, 'far'),
      ...requests, requests[0],
    ])
    expect(pendingInSessionTimers()).toBe(64)
    await scheduleMaterializedReminders([request(2 * minute, 'replacement')])
    expect(pendingInSessionTimers()).toBe(1)
    await advance(2 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    expect([...center.keys()]).toEqual(['water:replacement'])
  })

  it.each(['absent', 'missing method', 'rejected', 'hung'] as const)(
    'falls back from an %s registration lookup within two seconds', async (behavior) => {
      const lookup = deferred<ServiceWorkerRegistration | undefined>()
      const getRegistration = vi.fn(() => {
        if (behavior === 'rejected') return Promise.reject(new Error('Unavailable'))
        return lookup.promise
      })
      if (behavior !== 'absent') vi.stubGlobal('navigator', {
        serviceWorker: behavior === 'missing method' ? {} : { getRegistration },
      })
      await scheduleMaterializedReminders([request()])
      await advance(minute)
      if (behavior === 'hung') {
        expect(NotificationMock).not.toHaveBeenCalled()
        await advance(1_999)
        expect(NotificationMock).not.toHaveBeenCalled()
        await advance(1)
      }
      expect(NotificationMock).toHaveBeenCalledTimes(1)
      const showNotification = vi.fn(async () => {})
      lookup.resolve({ showNotification } as unknown as ServiceWorkerRegistration)
      await settleStorage()
      expect(showNotification).not.toHaveBeenCalled()
      expect(NotificationMock).toHaveBeenCalledTimes(1)
    },
  )

  it('uses a registration without accessing an unbounded ready promise', async () => {
    const showNotification = vi.fn(async () => {})
    const ready = vi.fn(() => { throw new Error('must not read ready') })
    vi.stubGlobal('navigator', { serviceWorker: {
      getRegistration: vi.fn(async () => ({ showNotification })), get ready() { return ready() },
    } })
    await scheduleMaterializedReminders([request()])
    await advance(minute)
    expect(showNotification).toHaveBeenCalledWith('Lunara', { body: 'Sip', tag: 'water:occurrence', renotify: false })
    expect(ready).not.toHaveBeenCalled()
    expect(NotificationMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['stop', 'wipe', 'disable', 'permission'] as const)(
    'does not deliver when %s happens during a worker lookup', async (change) => {
      const lookup = deferred<ServiceWorkerRegistration | undefined>()
      const getRegistration = vi.fn(() => lookup.promise)
      const showNotification = vi.fn(async () => {})
      vi.stubGlobal('navigator', { serviceWorker: { getRegistration } })
      await savePreferences()
      await notifications.startReminderScheduler()
      await settleStorage()
      await advance(5 * minute)
      expect(getRegistration).toHaveBeenCalledTimes(1)
      if (change === 'stop') await notifications.stopReminderScheduler()
      else if (change === 'wipe') await db.settings.clear()
      else if (change === 'disable') await savePreferences(false)
      else NotificationMock.permission = 'denied'
      lookup.resolve({ showNotification } as unknown as ServiceWorkerRegistration)
      await settleStorage()
      await advance(2_000)
      expect(showNotification).not.toHaveBeenCalled()
      expect(NotificationMock).not.toHaveBeenCalled()
      expect(pendingInSessionTimers()).toBe(0)
    },
  )

  it('rechecks permission at delivery and cancels other due timers', async () => {
    await scheduleMaterializedReminders([request(), request(2 * minute, 'later')])
    NotificationMock.permission = 'denied'
    await advance(minute)
    expect(pendingInSessionTimers()).toBe(0)
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('does not re-arm a legacy reminder if stopped while permission is requested', async () => {
    const permission = deferred<string>()
    NotificationMock.permission = 'default'
    NotificationMock.requestPermission.mockReturnValueOnce(permission.promise)
    const scheduling = scheduleDailyReminder('08:05')
    await notifications.stopReminderScheduler()
    NotificationMock.permission = 'granted'
    permission.resolve('granted')
    await scheduling
    expect(await pendingDailyReminder()).toBe(false)
  })

  it.each(['disable', 'wipe', 'new time'] as const)(
    'checks persisted %s at delivery before a liveQuery notification arrives', async (change) => {
      const { client } = await clientWithPausedSubscription()
      const lookup = deferred<ServiceWorkerRegistration | undefined>()
      const showNotification = vi.fn(async () => {})
      vi.stubGlobal('navigator', { serviceWorker: { getRegistration: () => lookup.promise } })
      await savePreferences()
      await client.startReminderScheduler()
      await advance(5 * minute)
      if (change === 'wipe') await db.settings.clear()
      else await savePreferences(change === 'new time', change === 'new time' ? '08:10' : '08:05')
      lookup.resolve({ showNotification } as unknown as ServiceWorkerRegistration)
      await settleStorage()
      expect(showNotification).not.toHaveBeenCalled()
      expect(NotificationMock).not.toHaveBeenCalled()
    },
  )

  it('does not commit preferences disabled while the startup permission read completes', async () => {
    const { client } = await clientWithPausedSubscription()
    await savePreferences()
    let change: Promise<void> | undefined
    Object.defineProperty(NotificationMock, 'permission', {
      configurable: true,
      get() {
        change ??= savePreferences(false)
        return 'granted'
      },
    })
    await client.startReminderScheduler()
    await change
    expect(client.pendingInSessionTimers()).toBe(0)
    await advance(5 * minute)
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)(
    'ignores a stale preference read that later %ss after a newer refresh', async (outcome) => {
      const { client, database } = await clientWithPausedSubscription()
      await savePreferences()
      await client.startReminderScheduler()
      const release = deferred<void>()
      const captured = deferred<void>()
      const bulkGet = database.settings.bulkGet.bind(database.settings)
      vi.spyOn(database.settings, 'bulkGet').mockImplementationOnce((keys) => bulkGet(keys).then((rows) => {
        captured.resolve()
        return release.promise.then(() => rows)
      }))
      const oldRefresh = client.refreshReminderScheduler()
      const settled = oldRefresh.catch(() => undefined)
      await captured.promise
      await savePreferences(true, '08:10')
      await client.refreshReminderScheduler()
      expect(client.pendingInSessionTimers()).toBe(1)
      if (outcome === 'reject') release.reject(new Error('Old read failed'))
      else release.resolve()
      await settled
      expect(client.pendingInSessionTimers()).toBe(1)
      await advance(5 * minute)
      expect(NotificationMock).not.toHaveBeenCalled()
      await advance(5 * minute)
      expect(NotificationMock).toHaveBeenCalledTimes(1)
      expect([...center.keys()][0]).toContain(':08:10')
    },
  )

  it('does not fall back after a worker failure if preferences were disabled meanwhile', async () => {
    const { client } = await clientWithPausedSubscription()
    const shown = deferred<void>()
    const showNotification = vi.fn(() => shown.promise)
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ showNotification }) } })
    await savePreferences()
    await client.startReminderScheduler()
    await advance(5 * minute)
    expect(showNotification).toHaveBeenCalledTimes(1)
    await savePreferences(false)
    shown.reject(new Error('Worker delivery failed'))
    await settleStorage()
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('keeps a newer successful refresh when the initial startup read later fails', async () => {
    const { client, database } = await clientWithPausedSubscription()
    await savePreferences()
    const release = deferred<void>()
    const captured = deferred<void>()
    const bulkGet = database.settings.bulkGet.bind(database.settings)
    vi.spyOn(database.settings, 'bulkGet').mockImplementationOnce((keys) => bulkGet(keys).then((rows) => {
      captured.resolve()
      return release.promise.then(() => rows)
    }))
    const startup = client.startReminderScheduler().then(() => 'started', () => 'failed')
    await captured.promise
    await client.refreshReminderScheduler()
    expect(client.pendingInSessionTimers()).toBe(1)
    release.reject(new Error('Initial read failed'))
    expect(await startup).toBe('started')
    expect(client.pendingInSessionTimers()).toBe(1)
    await advance(5 * minute)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
  })

  it('delivers an occurrence at the exact hourly refresh time', async () => {
    await savePreferences(true, '09:00')
    await notifications.startReminderScheduler()
    await settleStorage()
    await advance(hour)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    expect([...center.keys()][0]).toBe('settings-cycle:settings-cycle:2026-09-11:09:00')
  })

  it.each(['in flight', 'already delivered'] as const)(
    'does not re-arm an occurrence %s when a refresh commits at its deadline', async (deliveryState) => {
      const { client, database } = await clientWithPausedSubscription()
      const lookup = deferred<ServiceWorkerRegistration | undefined>()
      const showNotification = vi.fn(async () => {})
      if (deliveryState === 'in flight') {
        vi.stubGlobal('navigator', { serviceWorker: { getRegistration: () => lookup.promise } })
      }
      await savePreferences()
      await client.startReminderScheduler()
      await advance(5 * minute - 1)

      // Materialize before the deadline, then hold the final settings check
      // until the original timer has fired. Start the transaction only after
      // release so IndexedDB cannot auto-commit a deliberately suspended one.
      const release = deferred<void>()
      const captured = deferred<void>()
      const transaction = database.transaction.bind(database)
      vi.spyOn(database, 'transaction').mockImplementationOnce(((...args: Parameters<typeof transaction>) => {
        captured.resolve()
        return release.promise.then(() => transaction(...args))
      }) as typeof database.transaction)
      const refresh = client.refreshReminderScheduler()
      await captured.promise
      await advance(1)
      expect(client.pendingInSessionTimers()).toBe(0)
      if (deliveryState === 'already delivered') expect(NotificationMock).toHaveBeenCalledTimes(1)

      release.resolve()
      await refresh
      const pendingAfterRefresh = client.pendingInSessionTimers()
      await advance(0)
      lookup.resolve({ showNotification } as unknown as ServiceWorkerRegistration)
      await settleStorage()
      expect(deliveryState === 'in flight' ? showNotification : NotificationMock).toHaveBeenCalledTimes(1)
      expect(pendingAfterRefresh).toBe(0)
    },
  )

  it('keeps an in-flight delivery valid across a refresh with unchanged preferences', async () => {
    const lookup = deferred<ServiceWorkerRegistration | undefined>()
    const showNotification = vi.fn(async () => {})
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: () => lookup.promise } })
    await savePreferences()
    await notifications.startReminderScheduler()
    await settleStorage()
    await advance(5 * minute)
    await notifications.refreshReminderScheduler()
    lookup.resolve({ showNotification } as unknown as ServiceWorkerRegistration)
    await settleStorage()
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect(NotificationMock).not.toHaveBeenCalled()
  })

  it('replaces the old occurrence time after a timezone change and visible refresh', async () => {
    vi.setSystemTime(new Date('2026-09-11T08:00:00Z'))
    let timeZone = 'UTC'
    const DateTimeFormat = Intl.DateTimeFormat
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => {
      const formatter = new DateTimeFormat(locales, options)
      if (!options?.timeZone) {
        const resolved = formatter.resolvedOptions()
        vi.spyOn(formatter, 'resolvedOptions').mockReturnValue({ ...resolved, timeZone })
      }
      return formatter
    })
    await savePreferences()
    await notifications.startReminderScheduler()
    await settleStorage()
    expect(pendingInSessionTimers()).toBe(1)
    timeZone = 'America/New_York'
    documentStub.dispatchEvent(new Event('visibilitychange'))
    await settleStorage()
    await advance(5 * minute)
    expect(NotificationMock).not.toHaveBeenCalled()
    await advance(4 * hour)
    expect(NotificationMock).toHaveBeenCalledTimes(1)
    expect([...center.keys()][0]).toBe('settings-cycle:settings-cycle:2026-09-11:08:05')
  })
})
