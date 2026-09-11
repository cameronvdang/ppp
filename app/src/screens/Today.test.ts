import { describe, expect, it } from 'vitest'
import { addDays, daysBetween } from '../engine/cycle'
import { cyclePhaseFor } from '../engine/phase'
import { phaseFor } from './Today'

const prediction = { nextPeriodStart: '2026-09-29', ovulationDate: '2026-09-15', fertileWindow: { start: '2026-09-10', end: '2026-09-16' }, uncertaintyDays: 2, cycleDay: null, averageCycleLength: 28, source: 'basic' as const }
const eligibility = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }

function heroFor(date: string, flowDates: string[]) {
  const phase = cyclePhaseFor({ date, periodStarts: ['2026-08-04', '2026-09-01'], flowDates, prediction, eligibility })
  return phaseFor('cycle', phase.cycleDay, daysBetween(date, prediction.ovulationDate), prediction.uncertaintyDays, false, phase)
}

describe('Today phase hero', () => {
  it('shows the follicular phase on day four after a three-day flow run', () => {
    expect(heroFor('2026-09-04', ['2026-09-01', '2026-09-02', '2026-09-03'])).toMatchObject({
      tone: 'cycle', eyebrow: 'Follicular phase (estimate)', title: 'Cycle day 4',
    })
  })

  it('keeps the period hero on day six of a longer flow run', () => {
    expect(heroFor('2026-09-06', Array.from({ length: 6 }, (_, index) => addDays('2026-09-01', index)))).toMatchObject({
      tone: 'period', eyebrow: 'Period:', title: 'Day 6',
    })
  })

  it('counts period days within the logged run instead of from the cycle start', () => {
    expect(heroFor('2026-09-07', ['2026-09-01', '2026-09-06', '2026-09-07'])).toMatchObject({
      tone: 'period', title: 'Day 2',
    })
  })

  it('retains the fertile and ovulation heroes', () => {
    expect(heroFor('2026-09-12', [])).toMatchObject({ tone: 'fertile', title: 'Ovulation in 3 days' })
    expect(heroFor('2026-09-15', [])).toMatchObject({ tone: 'ovulation', title: 'Ovulation may be today' })
  })
})
