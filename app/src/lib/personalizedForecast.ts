import { db, getHealthProfile, getOvulations, getPeriodStarts, type HealthProfile } from '../db/schema'
import { addDays, type ISODate, type Prediction } from '../engine/cycle'
import { buildCycleForecast, type CycleForecastDiagnostics } from '../engine/cycleForecast'
import { applyPredictionContext, type PersonalizedPrediction } from '../engine/predictionContext'

export interface PersonalizedForecastResult {
  prediction: Prediction
  predictionContext: PersonalizedPrediction
  forecastDiagnostics: CycleForecastDiagnostics
  profile: HealthProfile
  periodStarts: ISODate[]
  flowDates: ISODate[]
}

/** The same selected-date forecast used by Today and local calendar exports. */
export async function computePersonalizedForecast(date: ISODate): Promise<PersonalizedForecastResult> {
  const [allStarts, allOvulations, profile, recentLogs, flowDates] = await Promise.all([
    getPeriodStarts(), getOvulations(), getHealthProfile(),
    db.dailyLogs.where('date').between(addDays(date, -27), date, true, true).toArray(),
    db.dailyLogs.filter(log => log.flow !== undefined).primaryKeys(),
  ])
  const periodStarts = allStarts.filter(value => value <= date)
  const ovulations = allOvulations.filter(value => value <= date)
  const forecast = buildCycleForecast(
    {
      periodStarts: periodStarts,
      ovulations: ovulations,
      today: date,
    },
    {
      baselineCycleLength: profile.cycle.typicalCycleLength,
      positiveOpkDates: recentLogs
        .filter((log) => log.opk === 'positive' && log.date <= date)
        .map((log) => log.date),
      bbtShiftDates: ovulations,
    },
  )
  const rawPrediction = forecast.prediction
  const personalized = applyPredictionContext(rawPrediction, profile, {
    completedCycles: forecast.diagnostics.completedCycleCount,
    bbtShiftEstimateCount: ovulations.length,
    positiveOpkThisCycle: forecast.diagnostics.evidence.some(
      (item) => item.kind === 'opk-suggestive',
    ),
  })
  return { prediction: personalized.prediction, predictionContext: personalized, forecastDiagnostics: forecast.diagnostics, profile, periodStarts: allStarts, flowDates }
}
