import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, putHealthProfile } from '../db/schema'
import * as forecasts from '../lib/personalizedForecast'
import { loadCalendarMonth } from './CalendarScreen'

const today = '2026-09-11'

describe('calendar month forecasts through calendarDayMarks', () => {
  beforeEach(async () => {
    for (const table of db.tables) await table.clear()
    await db.dailyLogs.bulkPut([
      { date: '2026-07-01', flow: 'medium' },
      { date: '2026-07-29', flow: 'medium' },
      { date: '2026-08-26', flow: 'medium' },
    ])
  })
  afterEach(() => vi.restoreAllMocks())

  it('uses each visible cycle forecast instead of today’s forecast for past phases', async () => {
    const compute = vi.spyOn(forecasts, 'computePersonalizedForecast')
    const { marksByDate } = await loadCalendarMonth(today, 2026, 7)
    expect(marksByDate.get('2026-08-15')).toMatchObject({ phase: 'luteal', classes: ['cal-day', 'phase-luteal'] })
    expect(marksByDate.get('2026-08-10')).toMatchObject({ phase: 'fertile', classes: ['cal-day', 'fertile'] })
    expect(marksByDate.get('2026-08-12')).toMatchObject({ phase: 'ovulation', classes: ['cal-day', 'ovulation'] })
    expect(marksByDate.get('2026-08-26')?.classes).toContain('period')
    expect(marksByDate.get('2026-08-28')?.classes).toContain('phase-follicular')
    expect(compute.mock.calls).toEqual([[today], ['2026-07-29']])
  })

  it('keeps upcoming predicted period styling and reuses today’s current-cycle forecast', async () => {
    const compute = vi.spyOn(forecasts, 'computePersonalizedForecast')
    const { marksByDate } = await loadCalendarMonth(today, 2026, 8)
    for (const date of ['2026-09-23', '2026-09-24', '2026-09-27']) {
      expect(marksByDate.get(date)?.classes).toContain('predicted')
    }
    expect(marksByDate.get('2026-09-28')?.classes).not.toContain('predicted')
    expect(marksByDate.get(today)?.classes).toContain('today-mark')
    expect(compute.mock.calls).toEqual([[today]])
  })

  it('applies personalized eligibility to past cycles too', async () => {
    await putHealthProfile({ reproductive: { contraception: 'combined-pill-patch-ring' } })
    const { marksByDate } = await loadCalendarMonth(today, 2026, 7)
    for (const date of ['2026-08-10', '2026-08-12', '2026-08-15']) {
      expect(marksByDate.get(date)).toMatchObject({ phase: 'cycle', classes: ['cal-day'] })
    }
  })
})
