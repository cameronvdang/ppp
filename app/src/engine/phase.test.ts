import { describe, expect, it } from 'vitest'
import { cyclePhaseFor } from './phase'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-29', ovulationDate: '2026-09-15', fertileWindow: { start: '2026-09-10', end: '2026-09-16' }, uncertaintyDays: 2, cycleDay: null, averageCycleLength: 28, source: 'basic' as const }
const base = { periodStarts: ['2026-08-04', '2026-09-01'], flowDates: ['2026-08-04', '2026-08-05', '2026-08-06', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], prediction, eligibility: eligible }

describe('cyclePhaseFor', () => {
  it.each([
    ['2026-09-03', 'period', 'Period', 3],
    ['2026-09-07', 'follicular', 'Follicular phase', 7],
    ['2026-09-12', 'fertile', 'Fertile window (estimate)', 12],
    ['2026-09-15', 'ovulation', 'Ovulation (estimate)', 15],
    ['2026-09-20', 'luteal', 'Luteal phase', 20],
  ])('%s is %s', (date, phase, label, cycleDay) => {
    expect(cyclePhaseFor({ ...base, date })).toMatchObject({ phase, label, cycleDay })
  })
  it('hides phase estimates on hormonal contraception but keeps the cycle day', () => {
    const r = cyclePhaseFor({ ...base, date: '2026-09-12', eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false } })
    expect(r).toMatchObject({ phase: 'cycle', label: 'Cycle day 12' })
    expect(r.detail).toMatch(/hormonal contraception/)
  })
  it('reports cycle day only when there is no fertile window yet', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-12', prediction: { ...prediction, fertileWindow: null, ovulationDate: null } })).toMatchObject({ phase: 'cycle', label: 'Cycle day 12' })
  })
  it('is unknown with no history or stale history', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-12', periodStarts: [], flowDates: [] })).toMatchObject({ phase: 'unknown', cycleDay: null })
    expect(cyclePhaseFor({ ...base, date: '2027-01-15' })).toMatchObject({ cycleDay: null })
  })
  it('period detail counts the day within the run', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-02' }).detail).toBe('Day 2 of your period')
  })
  it('uses the latest start on or before the date and ends the count after 90 days', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-08-10' }).cycleDay).toBe(7)
    expect(cyclePhaseFor({ ...base, date: '2026-08-01' })).toMatchObject({ phase: 'unknown', cycleDay: null })
    expect(cyclePhaseFor({ ...base, date: '2026-11-30' }).cycleDay).toBe(91)
    expect(cyclePhaseFor({ ...base, date: '2026-12-01' })).toMatchObject({ phase: 'unknown', cycleDay: null })
  })
  it('does not use a later cycle forecast for an earlier cycle', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-08-15' })).toMatchObject({ phase: 'cycle', cycleDay: 12 })
    // A logged start exactly at the fertile-window boundary also invalidates it.
    expect(cyclePhaseFor({ ...base, date: '2026-09-07', periodStarts: [...base.periodStarts, '2026-09-10'] }).phase).toBe('cycle')
    expect(cyclePhaseFor({ ...base, date: '2026-09-07', periodStarts: [...base.periodStarts, '2026-09-11'] }).phase).toBe('follicular')
    expect(cyclePhaseFor({ ...base, date: '2026-08-05' }).phase).toBe('period')
  })
  it('bounds period days by consecutive flow rather than assuming five days', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-05' }).phase).toBe('follicular')
    expect(cyclePhaseFor({ ...base, date: '2026-09-07', flowDates: [...base.flowDates, '2026-09-07'] })).toMatchObject({ phase: 'period', detail: 'Day 1 of your period' })
    expect(cyclePhaseFor({ ...base, date: '2026-09-03', periodStarts: [] })).toMatchObject({ phase: 'period', cycleDay: null, detail: 'Day 3 of your period' })
  })
  it('includes fertile boundaries, prefers ovulation, and stops luteal at the next period estimate', () => {
    for (const date of ['2026-09-10', '2026-09-16']) expect(cyclePhaseFor({ ...base, date }).phase).toBe('fertile')
    expect(cyclePhaseFor({ ...base, date: '2026-09-29' }).phase).toBe('cycle')
    expect(cyclePhaseFor({ ...base, date: '2026-09-29', prediction: { ...prediction, nextPeriodStart: null } }).phase).toBe('luteal')
  })
  it('suppresses estimates during pregnancy while retaining logged flow', () => {
    const eligibility = { ...eligible, periodForecast: false, fertileWindow: false, ovulationForecast: false }
    expect(cyclePhaseFor({ ...base, date: '2026-09-20', eligibility })).toMatchObject({ phase: 'cycle', detail: 'Phase estimates are off during pregnancy.' })
    expect(cyclePhaseFor({ ...base, date: '2026-09-03', eligibility }).phase).toBe('period')
    expect(cyclePhaseFor({ ...base, date: '2026-09-20', eligibility, periodStarts: [] }).phase).toBe('unknown')
  })
  it('respects each fertility eligibility flag', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-15', eligibility: { ...eligible, ovulationForecast: false } }).phase).toBe('fertile')
    expect(cyclePhaseFor({ ...base, date: '2026-09-20', eligibility: { ...eligible, fertileWindow: false } }).phase).toBe('cycle')
  })
})
