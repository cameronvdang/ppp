import type { shareOrDownload } from '../db/transfer'
import { defaultReminderPreferences, REMINDER_SETTINGS_KEY, serializeReminderPreferences } from '../engine/reminderPreferences'
// app/src/calendar/export.test.ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, putHealthProfile, setSetting, SK } from '../db/schema'
import { exportForecastCalendar, exportRemindersCalendar } from './export'

type Share = (filename: string, contents: string, mime?: string) => Promise<void>

describe('calendar export', () => {
  beforeEach(async () => { for (const t of db.tables) await t.clear(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Calendar exports must not fetch') })) })
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals() })

  it('does not share when there is nothing to export', async () => {
    const share = vi.fn<Share>(async () => {})
    expect(await exportForecastCalendar({ today: '2026-09-11', share })).toEqual({ events: 0, skipped: 'Log two period starts first.' })
    expect(await exportRemindersCalendar({ share })).toEqual({ events: 0, skipped: 'Turn on a reminder first.' })
    expect(share).not.toHaveBeenCalled()
  })

  it('shares a forecast file honouring the saved preferences', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    await setSetting(SK.calendarDiscreet, '0'); await setSetting(SK.calendarCycles, '6')
    const share = vi.fn<Share>(async () => {})
    const r = await exportForecastCalendar({ today: '2026-08-10', now: new Date('2026-08-10T00:00:00Z'), share })
    expect(r.events).toBeGreaterThanOrEqual(6)
    const [name, ics, mime] = share.mock.calls[0]
    expect(name).toBe('ppp-forecast.ics'); expect(mime).toBe('text/calendar')
    expect(ics).toContain('SUMMARY:Period expected'); expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(r.events)
  })

  it('defaults to three discreet cycles and suppresses pregnancy forecasts', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    const share = vi.fn<Share>(async () => {})
    const result = await exportForecastCalendar({ today: '2026-08-10', share })
    const ics = share.mock.calls[0][1]
    expect(result.events).toBe(9)
    expect(ics).not.toMatch(/X-PPP-KIND|period|fertile|ovulation|contraception/i)
    await putHealthProfile({ primaryGoal: 'pregnancy', goals: ['pregnancy'] })
    share.mockClear()
    expect(await exportForecastCalendar({ today: '2026-08-10', share })).toMatchObject({ events: 0 })
    expect(share).not.toHaveBeenCalled()
  })
  it('exports enabled reminder plans using neutral notification copy and local times', async () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
    prefs.plans[3].enabled = true
    prefs.plans[3].localTime = '23:30'
    await setSetting(REMINDER_SETTINGS_KEY, serializeReminderPreferences(prefs))
    const share = vi.fn<Share>(async () => {})
    const result = await exportRemindersCalendar({ today: '2026-09-11', now: new Date('2026-09-11T10:00:00Z'), share })
    expect(result.events).toBe(1)
    const [name, ics, mime] = share.mock.calls[0]
    expect(name).toBe('ppp-reminders.ics')
    expect(mime).toBe('text/calendar')
    expect(ics).toContain('SUMMARY:PPP\r\n')
    expect(ics).toContain('DTSTART:20260911T233000\r\n')
    expect(ics).toContain('RRULE:FREQ=DAILY\r\n')
    expect(ics).toContain('TRIGGER:PT0M\r\n')
    expect(ics).not.toContain('TZID')
    expect(ics).not.toContain('Basal temperature')
  })
  it('validates the full file before sharing and propagates delivery failures', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    const share = vi.fn<Share>(async () => {})
    await expect(exportForecastCalendar({ today: '2026-08-10', now: new Date('invalid'), share })).rejects.toThrow()
    expect(share).not.toHaveBeenCalled()
    share.mockRejectedValue(new Error('File delivery failed'))
    await expect(exportForecastCalendar({ today: '2026-08-10', share })).rejects.toThrow('File delivery failed')
  })

  it('preserves cancellation for both UIs to remain silent', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
    prefs.plans[0].enabled = true
    await setSetting(REMINDER_SETTINGS_KEY, serializeReminderPreferences(prefs))
    const share = vi.fn<typeof shareOrDownload>(async () => 'cancelled')
    expect(await exportForecastCalendar({ today: '2026-08-10', share })).toEqual({ events: 0, cancelled: true })
    expect(await exportRemindersCalendar({ today: '2026-09-11', share })).toEqual({ events: 0, cancelled: true })
  })
})
