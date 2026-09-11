import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildIcs } from './ics'
// app/src/calendar/forecastEvents.test.ts
import { describe, expect, it } from 'vitest'
import { forecastCalendarEvents } from './forecastEvents'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-25', ovulationDate: '2026-09-11', fertileWindow: { start: '2026-09-07', end: '2026-09-12' }, uncertaintyDays: 2, cycleDay: 15, averageCycleLength: 28, source: 'basic' as const }
const diagnostics = { periodWindow: { start: '2026-09-23', end: '2026-09-27' }, ovulationWindow: { start: '2026-09-10', end: '2026-09-12' }, fertileWindowRange: { start: '2026-09-06', end: '2026-09-12' } } as any

describe('forecastCalendarEvents', () => {
  it('emits discreet period, fertile and ovulation events for one cycle', () => {
    const ev = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics }, { cycles: 1, discreet: true })
    expect(ev.map((e) => [e.uid, e.summary, e.start, e.end])).toEqual([
      ['ppp-a-0@ppp.local', 'PPP', '2026-09-23', '2026-09-27'],
      ['ppp-b-0@ppp.local', 'PPP +', '2026-09-06', '2026-09-12'],
      ['ppp-c-0@ppp.local', 'PPP ○', '2026-09-10', '2026-09-12'],
    ])
    expect(ev[0].description).toBe('Estimate from PPP, ±2 days.')
    expect(ev.every(e => e.kind === undefined)).toBe(true)
  })
  it('shifts later cycles by the cycle length and widens the period window', () => {
    const ev = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics }, { cycles: 3, discreet: false })
    const periods = ev.filter((e) => e.uid.startsWith('ppp-a-'))
    expect(periods.map((e) => [e.start, e.end])).toEqual([['2026-09-23', '2026-09-27'], ['2026-10-19', '2026-10-27'], ['2026-11-14', '2026-11-26']])
    expect(periods[2].summary).toBe('Period expected')
    expect(periods[2].description).toBe('Estimate from PPP, ±6 days. Not for contraception.')
  })
  it('omits fertility events when not eligible and everything when the period forecast is off', () => {
    expect(forecastCalendarEvents({ prediction, eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false }, diagnostics }, { cycles: 2, discreet: true }).every((e) => e.uid.startsWith('ppp-a-'))).toBe(true)
    expect(forecastCalendarEvents({ prediction, eligibility: { ...eligible, periodForecast: false }, diagnostics }, { cycles: 2, discreet: true })).toEqual([])
  })
})

it('uses profile-adjusted uncertainty rather than the raw diagnostic window', () => {
  const ev = forecastCalendarEvents({ prediction: { ...prediction, uncertaintyDays: 7 }, eligibility: eligible, diagnostics }, { cycles: 1, discreet: true })
  expect(ev[0]).toMatchObject({ start: '2026-09-18', end: '2026-10-02' })
})
it('clamps cycles, suppresses missing history and keeps IDs stable across privacy modes', () => {
  const f = { prediction, eligibility: eligible, diagnostics }
  expect(forecastCalendarEvents(f, { cycles: 6, discreet: true })).toHaveLength(18)
  expect(forecastCalendarEvents(f, { cycles: 99, discreet: true })).toHaveLength(18)
  expect(forecastCalendarEvents(f, { cycles: 0, discreet: true })).toHaveLength(3)
  expect(forecastCalendarEvents({ ...f, prediction: { ...prediction, nextPeriodStart: null } }, { cycles: 3, discreet: true })).toEqual([])
  expect(forecastCalendarEvents({ ...f, prediction: { ...prediction, averageCycleLength: 14 } }, { cycles: 3, discreet: true })).toEqual([])
  const discreet = forecastCalendarEvents(f, { cycles: 3, discreet: true, sequence: 1 })
  const descriptive = forecastCalendarEvents(f, { cycles: 3, discreet: false, sequence: 2 })
  expect(discreet.map(e => e.uid)).toEqual(descriptive.map(e => e.uid))
  expect(descriptive.every(e => e.kind && e.sequence === 2 && e.description?.endsWith('Not for contraception.'))).toBe(true)
})
it('matches the CRLF golden forecast byte for byte without sensitive kind metadata', () => {
  const events = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics }, { cycles: 1, discreet: true, sequence: 1 })
  const ics = buildIcs(events, { calName: 'PPP', now: new Date('2026-09-11T10:00:00Z') })
  expect(ics).toBe(readFileSync(resolve(__dirname, '__fixtures__/forecast.golden.ics'), 'utf8'))
  expect(ics).not.toContain('X-PPP-KIND')
  expect(ics).not.toMatch(/period|fertile|ovulation|contraception/i)
})
