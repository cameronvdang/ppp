// app/src/lib/personalizedForecast.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, putHealthProfile } from '../db/schema'
import { computePersonalizedForecast } from './personalizedForecast'

describe('computePersonalizedForecast', () => {
  beforeEach(async () => { for (const t of db.tables) await t.clear() })

  it('returns an insufficient-data forecast with no history', async () => {
    const r = await computePersonalizedForecast('2026-09-11')
    expect(r.prediction.source).toBe('insufficient-data')
    expect(r.prediction.nextPeriodStart).toBeNull()
  })

  it('forecasts from two period starts and suppresses fertility on hormonal contraception', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    const r = await computePersonalizedForecast('2026-08-10')
    expect(r.prediction.nextPeriodStart).toBe('2026-08-26')
    expect(r.prediction.uncertaintyDays).toBe(7)
    expect(r.predictionContext.eligibility.periodForecast).toBe(true)
    await putHealthProfile({ reproductive: { contraception: 'combined-pill-patch-ring' } })
    const s = await computePersonalizedForecast('2026-08-10')
    expect(s.predictionContext.eligibility.fertileWindow).toBe(false)
  })
})
