// app/src/calendar/reminderEvents.test.ts
import { describe, expect, it } from 'vitest'
import { reminderCalendarEvents, rruleFor } from './reminderEvents'
import { defaultReminderPreferences, withReminderGlobals } from '../engine/reminderPreferences'

describe('rruleFor', () => {
  it.each([
    [{ type: 'daily' }, 'FREQ=DAILY'],
    [{ type: 'daily', every: 3 }, 'FREQ=DAILY;INTERVAL=3'],
    [{ type: 'weekdays', weekdays: [1, 3, 7] }, 'FREQ=WEEKLY;BYDAY=MO,WE,SU'],
    [{ type: 'interval-days', startDate: '2026-09-12', every: 21 }, 'FREQ=DAILY;INTERVAL=21'],
    [{ type: 'monthly', day: 15 }, 'FREQ=MONTHLY;BYMONTHDAY=15'],
    [{ type: 'daily', endDate: '2026-12-31' }, 'FREQ=DAILY;UNTIL=20261231T235959'],
  ])('maps %j', (recurrence, rrule) => {
    expect(rruleFor(recurrence as any, '2026-09-11').rrule).toBe(rrule)
  })
  it('maps once and dates without an rrule', () => {
    expect(rruleFor({ type: 'once', date: '2026-10-01' }, '2026-09-11')).toEqual({ start: '2026-10-01' })
    expect(rruleFor({ type: 'dates', dates: ['2026-10-01', '2026-10-05'] }, '2026-09-11')).toMatchObject({ start: '2026-10-01', rdates: ['2026-10-05'] })
  })
})

describe('reminderCalendarEvents', () => {
  it('exports only enabled plans, with private titles by default and floating times', () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
    prefs.plans = prefs.plans.map((p, i) => ({ ...p, enabled: i < 2, localTime: '20:30' }))
    const ev = reminderCalendarEvents(prefs, '2026-09-11')
    expect(ev).toHaveLength(2)
    expect(ev[0]).toMatchObject({ uid: 'ppp-r-0@ppp.local', summary: 'PPP', time: '20:30', durationMinutes: 15, alarmMinutesBefore: 0 })
    expect(ev[0].description).not.toMatch(/period|fertile|medication|pregnan/i)
  })
  it('uses the category title when private previews are off', () => {
    const prefs = withReminderGlobals(defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' }), { privatePreviews: false })
    prefs.plans = prefs.plans.map((p) => ({ ...p, enabled: p.id === 'settings-bbt' }))
    expect(reminderCalendarEvents(prefs, '2026-09-11')[0].summary).toBe('PPP check-in')
  })
  it('keeps opaque UIDs stable across plan ordering, enabled subsets and preview modes', () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
    prefs.plans = prefs.plans.map(plan => ({ ...plan, enabled: true }))
    const ids = reminderCalendarEvents(prefs, '2026-09-11').map(event => event.uid)
    expect(ids).toEqual(prefs.plans.map((_, i) => `ppp-r-${i}@ppp.local`))
    prefs.plans.reverse()
    prefs.plans[1].enabled = false
    prefs.privatePreviews = false
    expect(reminderCalendarEvents(prefs, '2026-09-12').map(event => event.uid)).toEqual(ids.reverse().filter((_, i) => i !== 1))
  })
  it('hashes unknown plan IDs without exposing their contents', () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
    prefs.plans = [{ ...prefs.plans[0], enabled: true, id: 'hello' }]
    expect(reminderCalendarEvents(prefs, '2026-09-11')[0].uid).toBe('ppp-r-h4f9f2cab@ppp.local')
    prefs.plans[0].localTime = '10:00'
    prefs.privatePreviews = false
    expect(reminderCalendarEvents(prefs, '2026-09-12')[0].uid).toBe('ppp-r-h4f9f2cab@ppp.local')
  })
})

it('aligns DTSTART with weekdays, interval anchors and valid month days', () => {
  expect(rruleFor({ type: 'weekdays', weekdays: [1, 3] }, '2026-09-11').start).toBe('2026-09-14')
  expect(rruleFor({ type: 'daily', startDate: '2026-09-01', every: 3 }, '2026-09-11').start).toBe('2026-09-13')
  expect(rruleFor({ type: 'interval-days', startDate: '2026-09-01', every: 21 }, '2026-09-11').start).toBe('2026-09-22')
  expect(rruleFor({ type: 'monthly', day: 31 }, '2026-09-11').start).toBe('2026-10-31')
  expect(rruleFor({ type: 'monthly', day: 15, startDate: '2026-12-20' }, '2026-09-11').start).toBe('2027-01-15')
})
it('preserves floating recurrence dates and does not apply quiet hours', () => {
  const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-11' })
  prefs.plans = [{ ...prefs.plans[0], enabled: true, localTime: '23:30', recurrence: { type: 'dates', dates: ['2026-10-01', '2026-10-05'] } }]
  expect(reminderCalendarEvents(prefs, '2026-09-11')[0]).toMatchObject({ date: '2026-10-01', time: '23:30', rdates: [{ date: '2026-10-05', time: '23:30' }] })
})
it('omits recurring series that have already ended', () => {
  const prefs = defaultReminderPreferences({ timeZone: 'UTC', startDate: '2026-09-01' })
  prefs.plans = [{ ...prefs.plans[0], enabled: true, recurrence: { type: 'daily', endDate: '2026-09-10' } }]
  expect(reminderCalendarEvents(prefs, '2026-09-11')).toEqual([])
})
