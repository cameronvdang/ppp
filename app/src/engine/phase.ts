import { addDays, daysBetween, type ISODate, type Prediction } from './cycle'
import type { PersonalizedPrediction } from './predictionContext'

export type CyclePhase = 'period' | 'follicular' | 'fertile' | 'ovulation' | 'luteal' | 'cycle' | 'unknown'

export interface PhaseInput {
  date: ISODate
  /** Sorted logged period-start dates (from getPeriodStarts). */
  periodStarts: ISODate[]
  /** Dates with logged flow (to bound the period run). */
  flowDates: ISODate[]
  prediction: Prediction
  eligibility: PersonalizedPrediction['eligibility']
}

export interface PhaseResult {
  phase: CyclePhase
  cycleDay: number | null
  label: string
  detail: string
}

export function cyclePhaseFor({ date, periodStarts, flowDates, prediction, eligibility }: PhaseInput): PhaseResult {
  const start = periodStarts.filter(value => value <= date).at(-1)
  const elapsed = start ? daysBetween(start, date) : null
  const cycleDay = elapsed !== null && elapsed <= 90 ? elapsed + 1 : null
  const result = (phase: CyclePhase, label: string, detail: string): PhaseResult => ({ phase, cycleDay, label, detail })
  const flow = new Set(flowDates)
  if (flow.has(date)) {
    let runStart = date
    while (flow.has(addDays(runStart, -1))) runStart = addDays(runStart, -1)
    return result('period', 'Period', `Day ${daysBetween(runStart, date) + 1} of your period`)
  }
  // A forecast alone cannot place a day in a cycle with no recent logged start.
  if (cycleDay === null) return result('unknown', 'No cycle data yet', 'Log a period start to begin.')
  if (!eligibility.fertileWindow && !eligibility.ovulationForecast) {
    return result('cycle', `Cycle day ${cycleDay}`, eligibility.periodForecast
      ? 'Phase estimates are off while on hormonal contraception.'
      : 'Phase estimates are off during pregnancy.')
  }
  const fertileStart = prediction.fertileWindow?.start
  const laterCycle = start !== undefined && fertileStart !== undefined &&
    periodStarts.some(value => value > start && value <= fertileStart)
  if (!laterCycle && eligibility.ovulationForecast && prediction.ovulationDate === date) {
    return result('ovulation', 'Ovulation (estimate)', 'Estimated from your cycle history.')
  }
  const fertile = !laterCycle && eligibility.fertileWindow ? prediction.fertileWindow : null
  if (fertile && date >= fertile.start && date <= fertile.end) {
    return result('fertile', 'Fertile window (estimate)', 'Estimated from your cycle history.')
  }
  if (fertile && date > fertile.end && (prediction.nextPeriodStart === null || date < prediction.nextPeriodStart)) {
    return result('luteal', 'Luteal phase', 'After the estimated fertile window, before your next period.')
  }
  if (fertile && date < fertile.start) {
    return result('follicular', 'Follicular phase', 'Phase estimate. From the end of your period until the fertile window.')
  }
  return result('cycle', `Cycle day ${cycleDay}`, periodStarts.length < 2
    ? 'Log two period starts to see phase estimates.'
    : 'No phase estimate for this day.')
}
