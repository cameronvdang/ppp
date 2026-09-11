import { liveQuery } from 'dexie'
import { db, SK } from '../db/schema'
import { parseReminderPreferences, REMINDER_SETTINGS_KEY } from '../engine/reminderPreferences'
import {
  materializeReminderRequests,
  type MaterializedReminderRequest,
  type MaterializeReminderOptions,
  type ReminderPermission,
  type ReminderPlan,
} from '../engine/reminders'
import { localToday } from '../lib/dates'

const DAILY_KEY = 'daily'
const WINDOW_MS = 24 * 60 * 60_000
const MAX_TIMERS = 64
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const firedOccurrences = new Map<string, number>()
let dailyTime: string | null = null
let dailyGeneration = 0
let deliveryGeneration = 0
let scheduledSnapshot: SettingsSnapshot | undefined

type NotificationCtor = {
  new (title: string, options?: { body?: string; tag?: string }): unknown
  permission: string
  requestPermission(): Promise<string>
}
type DeliveryCheck = (deliver: () => void) => Promise<void>

function notificationApi(): NotificationCtor | undefined {
  return (globalThis as { Notification?: NotificationCtor }).Notification
}

export function msUntilNextOccurrence(time: string, now: Date): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Reminder time must use HH:MM.')
  }
  const [hour, minute] = time.split(':').map(Number)
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export async function notificationPermission(request = false): Promise<ReminderPermission> {
  const N = notificationApi()
  if (!N) return 'denied'
  if (N.permission === 'granted') return 'granted'
  if (!request) return N.permission === 'denied' ? 'denied' : 'not-requested'
  return (await N.requestPermission()) === 'granted' ? 'granted' : 'denied'
}

async function registration(): Promise<ServiceWorkerRegistration | undefined> {
  const sw = globalThis.navigator?.serviceWorker
  if (!sw?.getRegistration) return undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      sw.getRegistration(),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), 2_000)
      }),
    ])
  } catch {
    return undefined
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

async function showReminder(
  title: string,
  body: string,
  tag: string,
  stillCurrent: () => boolean,
  authorize: DeliveryCheck = async (deliver) => { deliver() },
): Promise<void> {
  const permission = await notificationPermission(false)
  if (!stillCurrent()) return
  if (permission !== 'granted') {
    clearDaily()
    clearMaterialized()
    return
  }
  const reg = await registration()
  if (!stillCurrent()) return

  // Read permission synchronously at the side effect, after every async lookup
  // and persisted-settings check. A denied permission also clears future timers.
  const deliver: DeliveryCheck = (action) => authorize(() => {
    const granted = notificationApi()?.permission === 'granted'
    if (!stillCurrent()) return
    if (granted) action()
    else { clearDaily(); clearMaterialized() }
  })
  if (reg) {
    let shown: Promise<boolean> | undefined
    await deliver(() => {
      // Handle a rejected worker delivery immediately, then recheck before fallback.
      try {
        const options = { body, tag, renotify: false }
        shown = reg.showNotification(title, options)
          .then(() => true, () => false)
      } catch { /* Some platforms only support the constructor fallback. */ }
    })
    if (!stillCurrent() || (shown && await shown)) return
    if (!stillCurrent()) return
  }
  await deliver(() => {
    const N = notificationApi()
    if (N) new N(title, { body, tag })
  })
}

function clearDaily(): void {
  dailyGeneration += 1
  const timer = timers.get(DAILY_KEY)
  if (timer !== undefined) clearTimeout(timer)
  timers.delete(DAILY_KEY)
  dailyTime = null
}

function clearMaterialized(): void {
  deliveryGeneration += 1
  scheduledSnapshot = undefined
  firedOccurrences.clear()
  for (const [key, timer] of timers) {
    if (key === DAILY_KEY) continue
    clearTimeout(timer)
    timers.delete(key)
  }
}

function armDaily(): void {
  if (!dailyTime) return
  const time = dailyTime
  const generation = dailyGeneration
  const delay = msUntilNextOccurrence(time, new Date())
  const occurrence = new Date(Date.now() + delay)
  const occurrenceDate = [occurrence.getFullYear(), occurrence.getMonth() + 1, occurrence.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-')
  timers.set(DAILY_KEY, setTimeout(() => {
    timers.delete(DAILY_KEY)
    void showReminder(
      'Lunara', 'A gentle moment to check in with yourself.',
      `lunara-daily:${occurrenceDate}:${time}`, () => generation === dailyGeneration,
    ).catch(() => undefined)
    if (notificationApi()?.permission === 'granted') armDaily()
    else clearDaily()
  }, delay))
}

export async function scheduleDailyReminder(time: string): Promise<void> {
  msUntilNextOccurrence(time, new Date())
  const generation = dailyGeneration
  if ((await notificationPermission(true)) !== 'granted') {
    if (generation === dailyGeneration) clearDaily()
    throw new Error('Notification permission was not granted.')
  }
  if (generation !== dailyGeneration) return
  clearDaily()
  dailyTime = time
  armDaily()
}

export async function cancelDailyReminder(): Promise<void> { clearDaily() }
export async function pendingDailyReminder(): Promise<boolean> { return timers.has(DAILY_KEY) }
export async function cancelMaterializedReminders(): Promise<void> { clearMaterialized() }

function scheduleRequests(
  requests: MaterializedReminderRequest[],
  stillCurrent: () => boolean,
  authorize?: DeliveryCheck,
  merge = false,
): void {
  if (!stillCurrent()) return
  if (!merge) clearMaterialized()
  const generation = deliveryGeneration
  const now = Date.now()
  // A delayed refresh can commit at an occurrence's deadline after its timer
  // fired. Remember it through that instant, including while delivery awaits
  // storage or a worker; older occurrences are already excluded below.
  for (const [key, fireAt] of firedOccurrences) {
    if (fireAt < now) firedOccurrences.delete(key)
  }
  const due = requests
    .map((r) => ({ r, delay: Date.parse(r.fireAt) - now }))
    .filter(({ delay }) => delay >= 0 && delay <= WINDOW_MS)
    .sort((a, b) => a.delay - b.delay)
  for (const { r, delay } of due) {
    if (pendingInSessionTimers() >= MAX_TIMERS) break
    const key = `${r.reminderId}:${r.occurrenceKey}`
    if (timers.has(key) || firedOccurrences.has(key)) continue
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      firedOccurrences.set(key, now + delay)
      void showReminder(r.title, r.body, key,
        () => generation === deliveryGeneration && stillCurrent(), authorize,
      ).catch(() => undefined)
    }, delay))
  }
}

/** In-session only: delivery requires an open Lunara tab. */
export async function scheduleMaterializedReminders(
  requests: MaterializedReminderRequest[],
  stillCurrent: () => boolean = () => true,
): Promise<void> {
  const generation = deliveryGeneration
  const permission = await notificationPermission(false)
  if (generation !== deliveryGeneration || !stillCurrent()) return
  if (permission !== 'granted') { clearDaily(); clearMaterialized(); return }
  scheduleRequests(requests, stillCurrent)
}

export async function syncReminderPlans(
  plans: ReminderPlan[],
  options: MaterializeReminderOptions,
  stillCurrent: () => boolean = () => true,
): Promise<MaterializedReminderRequest[]> {
  const requests = materializeReminderRequests(plans, {
    ...options, limit: Math.min(MAX_TIMERS, options.limit ?? MAX_TIMERS),
  })
  await scheduleMaterializedReminders(requests, stillCurrent)
  return stillCurrent() ? requests : []
}

let schedulerRunning = false
let schedulerGeneration = 0
let schedulerLifecycle = 0
let startup: Promise<void> | undefined
let hourly: ReturnType<typeof setInterval> | undefined
let settingsSubscription: { unsubscribe(): void } | undefined
const inFlightRefreshes = new Set<Promise<void>>()
let initialSubscription: Promise<void> | undefined
let finishInitialSubscription: (() => void) | undefined
const settingsKeys = [REMINDER_SETTINGS_KEY, SK.reminderTime]
type SettingsSnapshot = [raw: string | undefined, legacyTime: string | undefined, timeZone: string]

async function readSettings(): Promise<SettingsSnapshot> {
  const [raw, legacyTime] = await db.settings.bulkGet(settingsKeys)
  return [raw?.value, legacyTime?.value, Intl.DateTimeFormat().resolvedOptions().timeZone]
}

function withCurrentSettings(
  snapshot: SettingsSnapshot,
  stillCurrent: () => boolean,
  action: () => void,
): Promise<void> {
  // Keep the final read and synchronous side effect in one read transaction,
  // so a disable/wipe cannot commit between them, even before liveQuery updates.
  return db.transaction('r', db.settings, async () => {
    const current = await readSettings()
    if (stillCurrent() && current.every((value, index) => value === snapshot[index])) action()
  })
}

async function refreshScheduler(): Promise<void> {
  if (!schedulerRunning) return
  const generation = ++schedulerGeneration
  const stillCurrent = () => schedulerRunning && generation === schedulerGeneration
  const lifecycle = schedulerLifecycle
  const deliveryCurrent = () => schedulerRunning && lifecycle === schedulerLifecycle
  try {
    const snapshot = await readSettings()
    if (!stillCurrent()) return
    const permission = await notificationPermission(false)
    if (!stillCurrent()) return
    const [raw, legacyTime, timeZone] = snapshot
    if ((!raw && !legacyTime) || permission !== 'granted') {
      clearDaily()
      clearMaterialized()
      return
    }
    const prefs = parseReminderPreferences(raw, {
      timeZone, startDate: localToday(), permission, legacyTime,
    })
    const requests = materializeReminderRequests(
      prefs.plans.map((plan) => ({ ...plan, permission })),
      { now: new Date(), horizonDays: 1, limit: MAX_TIMERS },
    )
    await withCurrentSettings(snapshot, stillCurrent, () => {
      clearDaily()
      const unchanged = scheduledSnapshot?.every((value, index) => value === snapshot[index]) ?? false
      // A routine refresh must retain timers due now and worker lookups already
      // in flight: the engine only materializes occurrences strictly after now.
      scheduleRequests(requests, deliveryCurrent,
        (deliver) => withCurrentSettings(snapshot, deliveryCurrent, deliver), unchanged)
      scheduledSnapshot = snapshot
    })
  } catch (error) {
    // A failed old read must not cancel timers committed by a newer refresh.
    if (!stillCurrent()) return
    clearDaily()
    clearMaterialized()
    throw error
  }
}

export function refreshReminderScheduler(): Promise<void> {
  const promise = refreshScheduler()
  inFlightRefreshes.add(promise)
  void promise.finally(() => inFlightRefreshes.delete(promise)).catch(() => undefined)
  return promise
}

/** Wait for startup's initial subscription emission and all refreshes it starts. */
export async function whenIdle(): Promise<void> {
  await startup
  await initialSubscription
  while (inFlightRefreshes.size) await Promise.all([...inFlightRefreshes])
}

const refresh = () => {
  void refreshReminderScheduler().catch(() => undefined)
}
const visible = () => { if (document.visibilityState === 'visible') refresh() }

export async function startReminderScheduler(): Promise<void> {
  if (schedulerRunning) return startup
  schedulerRunning = true
  const lifecycle = ++schedulerLifecycle
  document.addEventListener('visibilitychange', visible)
  hourly = setInterval(refresh, 60 * 60_000)
  startup = (async () => {
    try {
      // Subscribe after the first commit so liveQuery's initial emission cannot
      // supersede it and let await start() resolve before timers are installed.
      await refreshReminderScheduler()
      if (!schedulerRunning || lifecycle !== schedulerLifecycle) return
      let initialDone!: () => void
      initialSubscription = new Promise<void>(resolve => { initialDone = resolve })
      finishInitialSubscription = initialDone
      const changed = () => {
        if (schedulerRunning && lifecycle === schedulerLifecycle) {
          void refreshReminderScheduler().catch(() => undefined).finally(initialDone)
        } else initialDone()
      }
      settingsSubscription = liveQuery(readSettings).subscribe({
        next: changed,
        // Re-read with fresh generation guards before treating storage as failed.
        error: changed,
      })
    } catch (error) {
      if (lifecycle === schedulerLifecycle) await stopReminderScheduler()
      throw error
    }
  })()
  return startup
}

export async function stopReminderScheduler(): Promise<void> {
  schedulerRunning = false
  schedulerGeneration += 1
  schedulerLifecycle += 1
  startup = undefined
  if (hourly !== undefined) clearInterval(hourly)
  hourly = undefined
  globalThis.document?.removeEventListener('visibilitychange', visible)
  settingsSubscription?.unsubscribe()
  settingsSubscription = undefined
  finishInitialSubscription?.()
  finishInitialSubscription = undefined
  initialSubscription = undefined
  clearDaily()
  clearMaterialized()
}

export interface NativeReminderAction {
  action: 'open' | 'complete' | 'snooze'
  reminderId: string
  occurrenceKey: string
  route: string
}

/** Action buttons need a service-worker click handler, which is not installed yet. */
export async function listenForReminderActions(
  _listener: (action: NativeReminderAction) => void,
): Promise<{ remove(): void } | undefined> {
  return undefined
}

export function pendingInSessionTimers(): number {
  return [...timers.keys()].filter((key) => key !== DAILY_KEY).length
}
