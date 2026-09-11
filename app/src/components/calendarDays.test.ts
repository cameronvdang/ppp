import { describe, expect, it } from 'vitest'
import type { DailyLog } from '../db/schema'
import { calendarDayMarks } from './calendarDays'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-29', ovulationDate: '2026-09-15', fertileWindow: { start: '2026-09-10', end: '2026-09-16' }, uncertaintyDays: 2, cycleDay: null, averageCycleLength: 28, source: 'basic' as const }
const ctx = { periodStarts: ['2026-09-01'], flowDates: ['2026-09-01', '2026-09-02'], logsByDate: new Map<string, DailyLog>([['2026-09-07', { date: '2026-09-07', digestion: ['nausea'] }], ['2026-09-20', { date: '2026-09-20', symptoms: ['headache'] }]]), prediction, eligibility: eligible }

describe('calendarDayMarks', () => {
  it('tints follicular and luteal days and marks days with symptoms', () => {
    expect(calendarDayMarks('2026-09-07', ctx)).toMatchObject({ phase: 'follicular', hasSymptoms: true })
    expect(calendarDayMarks('2026-09-07', ctx).classes).toEqual(expect.arrayContaining(['phase-follicular', 'has-symptoms']))
    expect(calendarDayMarks('2026-09-20', ctx).classes).toEqual(expect.arrayContaining(['phase-luteal', 'has-symptoms']))
    expect(calendarDayMarks('2026-09-12', ctx).classes).toContain('fertile')
    expect(calendarDayMarks('2026-09-01', ctx).classes).toContain('period')
    expect(calendarDayMarks('2026-09-08', ctx).hasSymptoms).toBe(false)
  })
  it('adds no phase tint when fertility estimates are not eligible', () => {
    const r = calendarDayMarks('2026-09-20', { ...ctx, eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false } })
    expect(r.classes.some((c) => c.startsWith('phase-'))).toBe(false)
  })
  it('marks digestion and mood independently and ignores empty or unrelated notes', () => {
    for (const log of [{ digestion: ['diarrhea'] }, { moods: ['calm'] }, { symptoms: ['headache'] }] satisfies Partial<DailyLog>[]) {
      expect(calendarDayMarks('2026-09-08', { ...ctx, logsByDate: new Map([['2026-09-08', { date: '2026-09-08', ...log }]]) }).hasSymptoms).toBe(true)
    }
    for (const log of [{}, { symptoms: [], moods: [], digestion: [] }, { notes: 'A note', flow: 'light' }] satisfies Partial<DailyLog>[]) {
      expect(calendarDayMarks('2026-09-08', { ...ctx, logsByDate: new Map([['2026-09-08', { date: '2026-09-08', ...log }]]) }).hasSymptoms).toBe(false)
    }
  })
  it('preserves period, predicted period, ovulation and today markers with symptoms', () => {
    expect(calendarDayMarks('2026-09-15', ctx).classes).toEqual(['cal-day', 'ovulation'])
    expect(calendarDayMarks('2026-09-29', ctx).classes).toContain('predicted')
    expect(calendarDayMarks('2026-10-03', ctx).classes).toContain('predicted')
    expect(calendarDayMarks('2026-10-04', ctx).classes).not.toContain('predicted')
    expect(calendarDayMarks('2026-09-20', { ...ctx, today: '2026-09-20' }).classes).toEqual(['cal-day', 'phase-luteal', 'today-mark', 'has-symptoms'])
    expect(calendarDayMarks('2026-09-29', { ...ctx, flowDates: [...ctx.flowDates, '2026-09-29'] }).classes).toEqual(['cal-day', 'period'])
  })
  it('suppresses predicted and fertility markers in pregnancy while retaining symptoms and logged flow', () => {
    const pregnant = { ...ctx, eligibility: { ...eligible, periodForecast: false, fertileWindow: false, ovulationForecast: false } }
    for (const date of ['2026-09-07', '2026-09-12', '2026-09-15', '2026-09-20', '2026-09-29']) {
      expect(calendarDayMarks(date, pregnant).classes.filter(c => /phase-|fertile|ovulation|predicted/.test(c))).toEqual([])
    }
    expect(calendarDayMarks('2026-09-07', pregnant).hasSymptoms).toBe(true)
    expect(calendarDayMarks('2026-09-01', pregnant).classes).toContain('period')
  })
  it('does not tint unknown history or extend old fertile estimates indefinitely', () => {
    expect(calendarDayMarks('2026-09-12', { ...ctx, periodStarts: [], flowDates: [] }).classes).toEqual(['cal-day'])
    expect(calendarDayMarks('2027-01-12', { ...ctx, prediction: { ...prediction, nextPeriodStart: null } }).phase).toBe('unknown')
  })
})
