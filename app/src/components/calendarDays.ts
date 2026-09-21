import type { DailyLog } from '../db/schema'
import { daysBetween, type ISODate, type Prediction } from '../engine/cycle'
import { cyclePhaseFor, type CyclePhase } from '../engine/phase'
import type { PersonalizedPrediction } from '../engine/predictionContext'

export interface CalendarDayMarks { classes: string[]; hasSymptoms: boolean; phase: CyclePhase }

export function calendarDayMarks(date: ISODate, ctx: {
  periodStarts: ISODate[]
  flowDates: ISODate[]
  logsByDate: Map<ISODate, DailyLog>
  prediction: Prediction
  eligibility: PersonalizedPrediction['eligibility']
  /** Explicit clock input keeps the today marker deterministic. */
  today?: ISODate
}): CalendarDayMarks {
  const { phase } = cyclePhaseFor({ date, ...ctx })
  const log = ctx.logsByDate.get(date)
  const hasSymptoms = Boolean(log?.symptoms?.length || log?.digestion?.length || log?.moods?.length)
  const classes = ['cal-day']
  const daysAfterEstimate = ctx.prediction.nextPeriodStart === null ? null : daysBetween(ctx.prediction.nextPeriodStart, date)
  if (phase === 'period') classes.push('period')
  else if (ctx.eligibility.periodForecast && daysAfterEstimate !== null && daysAfterEstimate >= 0 && daysAfterEstimate < 5) {
    classes.push('predicted')
  } else if (phase === 'fertile' || phase === 'ovulation') classes.push(phase)
  else if (phase === 'follicular' || phase === 'luteal') classes.push(`phase-${phase}`)
  if (date === ctx.today) classes.push('today-mark')
  if (hasSymptoms) classes.push('has-symptoms')
  return { classes, hasSymptoms, phase }
}
