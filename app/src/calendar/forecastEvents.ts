import { addDays, type Prediction } from '../engine/cycle'
import type { CycleForecastDiagnostics } from '../engine/cycleForecast'
import type { PersonalizedPrediction } from '../engine/predictionContext'
import type { IcsAllDayEvent } from './ics'

export interface ForecastEventOptions { cycles: number; discreet: boolean; sequence?: number }
export function forecastCalendarEvents(f: {
  prediction: Prediction
  eligibility: PersonalizedPrediction['eligibility']
  diagnostics: CycleForecastDiagnostics
}, opts: ForecastEventOptions): IcsAllDayEvent[] {
  const { prediction: p, eligibility } = f
  if (!eligibility.periodForecast || p.nextPeriodStart === null || p.averageCycleLength < 15) return []
  const cycles = Math.max(1, Math.min(6, Number.isFinite(opts.cycles) ? Math.trunc(opts.cycles) : 3))
  const fertile = p.fertileWindow
  const ovulation = p.ovulationDate
  const events: IcsAllDayEvent[] = []
  for (let n = 0; n < cycles; n++) {
    const shift = n * p.averageCycleLength
    const uncertainty = (n + 1) * p.uncertaintyDays
    const event = (code: string, kind: string, summary: string, start: string, end: string, description: string): IcsAllDayEvent => ({
      uid: `ppp-${code}-${n}@ppp.local`, summary, start, end,
      description: description + (opts.discreet ? '' : ' Not for contraception.'),
      ...(opts.discreet ? {} : { kind }),
      sequence: opts.sequence,
    })
    events.push(event('a', 'period', opts.discreet ? 'PPP' : 'Period expected',
      addDays(p.nextPeriodStart, shift - uncertainty), addDays(p.nextPeriodStart, shift + uncertainty),
      `Estimate from PPP, ±${uncertainty} days.`))
    if (eligibility.fertileWindow && fertile) events.push(event('b', 'fertile', opts.discreet ? 'PPP +' : 'Fertile window (estimate)',
      addDays(fertile.start, shift), addDays(fertile.end, shift), `Estimate from PPP, ±${p.uncertaintyDays} days.`))
    if (eligibility.ovulationForecast && ovulation) events.push(event('c', 'ovulation', opts.discreet ? 'PPP ○' : 'Ovulation (estimate)',
      addDays(ovulation, shift), addDays(ovulation, shift), `Estimate from PPP, ±${p.uncertaintyDays} days.`))
  }
  return events
}
