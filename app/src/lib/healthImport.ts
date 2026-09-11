import {
  db,
  type DailyLog,
  type HealthImportField,
  type HealthImportProvider,
  type HealthImportProvenance,
} from '../db/schema'
export const SUPPORTED_HEALTH_DATA_TYPES = [
  'menstrualFlow',
  'basalBodyTemperature',
  'ovulationTest',
  'weight',
  'sleep',
  'steps',
] as const

export type HealthDataType = (typeof SUPPORTED_HEALTH_DATA_TYPES)[number]
export interface HealthSample {
  id: string
  type: HealthDataType
  startDate: string
  endDate: string
  /** Local-calendar date supplied by the source. */
  localDate?: string
  value: string | number
  unit: string
  source?: string
  sourceBundleIdentifier?: string
  metadata?: {
    menstrualCycleStart?: boolean
    wasUserEntered?: boolean
  }
}

type ImportedValue = DailyLog[HealthImportField]

export interface GroupedHealthDay {
  values: Partial<Pick<DailyLog, HealthImportField>>
  provenance: Partial<Record<HealthImportField, Omit<HealthImportProvenance, 'importedAt'>>>
}

export interface HealthImportApplyResult {
  samplesReceived: number
  uniqueSamples: number
  daysConsidered: number
  daysChanged: number
  fieldsChanged: number
  fieldsSkippedForUserData: number
}

const TYPE_FIELD: Record<HealthSample['type'], HealthImportField> = {
  menstrualFlow: 'flow',
  basalBodyTemperature: 'bbt',
  ovulationTest: 'opk',
  weight: 'weightKg',
  sleep: 'sleepMinutes',
  steps: 'steps',
}

const FLOW_WEIGHT: NonNullable<Record<NonNullable<DailyLog['flow']>, number>> = {
  light: 1,
  medium: 2,
  heavy: 3,
  clots: 4,
}

function sampleDate(sample: HealthSample): string | null {
  const candidate = sample.localDate ?? sample.startDate.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null
}

function normalizedFlow(value: HealthSample['value']): DailyLog['flow'] | undefined {
  if (value === 'light' || value === 'medium' || value === 'heavy') return value
  return undefined
}

function stableSampleKey(sample: HealthSample): string {
  if (sample.id.trim()) return `${sample.type}:${sample.id}`
  return [
    sample.type,
    sample.startDate,
    sample.endDate,
    String(sample.value),
    sample.sourceBundleIdentifier ?? sample.source ?? '',
  ].join(':')
}

function addProvenance(
  day: GroupedHealthDay,
  field: HealthImportField,
  sample: HealthSample,
  provider: HealthImportProvider,
) {
  const current = day.provenance[field]
  const sampleIds = new Set(current?.sampleIds ?? [])
  sampleIds.add(sample.id || stableSampleKey(sample))
  const sourceNames = new Set(current?.sourceNames ?? [])
  if (sample.source?.trim()) sourceNames.add(sample.source.trim())
  day.provenance[field] = {
    provider,
    sampleIds: [...sampleIds].sort(),
    sourceNames: sourceNames.size ? [...sourceNames].sort() : undefined,
    menstrualCycleStart:
      field === 'flow'
        ? Boolean(current?.menstrualCycleStart || sample.metadata?.menstrualCycleStart)
        : undefined,
  }
}

export function groupHealthSamplesWithProvenance(
  samples: HealthSample[],
  provider: HealthImportProvider,
): { days: Map<string, GroupedHealthDay>; uniqueSamples: number } {
  const days = new Map<string, GroupedHealthDay>()
  const seen = new Set<string>()

  for (const sample of samples) {
    const sampleKey = stableSampleKey(sample)
    if (seen.has(sampleKey)) continue
    seen.add(sampleKey)

    const date = sampleDate(sample)
    if (!date) continue
    const field = TYPE_FIELD[sample.type]
    const day = days.get(date) ?? { values: {}, provenance: {} }
    const numeric = typeof sample.value === 'number' ? sample.value : Number.NaN

    switch (sample.type) {
      case 'menstrualFlow': {
        const flow = normalizedFlow(sample.value)
        if (!flow) continue
        const current = day.values.flow
        if (!current || FLOW_WEIGHT[flow] > FLOW_WEIGHT[current]) day.values.flow = flow
        break
      }
      case 'basalBodyTemperature':
        if (!Number.isFinite(numeric)) continue
        day.values.bbt = Math.round(numeric * 100)
        break
      case 'ovulationTest':
        if (sample.value !== 'positive' && sample.value !== 'negative') continue
        // A positive result is the more informative value if multiple samples
        // were recorded on the same local-calendar day.
        if (sample.value === 'positive' || day.values.opk === undefined) {
          day.values.opk = sample.value
        }
        break
      case 'weight':
        if (!Number.isFinite(numeric)) continue
        day.values.weightKg = Math.round(numeric * 10) / 10
        break
      case 'sleep':
        if (!Number.isFinite(numeric)) continue
        day.values.sleepMinutes = (day.values.sleepMinutes ?? 0) + Math.round(numeric)
        break
      case 'steps':
        if (!Number.isFinite(numeric)) continue
        day.values.steps = (day.values.steps ?? 0) + Math.round(numeric)
        break
    }

    addProvenance(day, field, sample, provider)
    days.set(date, day)
  }

  return { days, uniqueSamples: seen.size }
}

/** Pure value grouping retained for UI previews and unit tests. */
export function groupHealthSamples(
  samples: HealthSample[],
): Map<string, Partial<Pick<DailyLog, HealthImportField>>> {
  const { days } = groupHealthSamplesWithProvenance(samples, 'apple-health')
  return new Map([...days].map(([date, day]) => [date, day.values]))
}

function readField(log: DailyLog, field: HealthImportField): ImportedValue {
  return log[field]
}

function writeField(log: DailyLog, field: HealthImportField, value: ImportedValue) {
  switch (field) {
    case 'flow':
      log.flow = value as DailyLog['flow']
      break
    case 'bbt':
      log.bbt = value as number
      break
    case 'opk':
      log.opk = value as DailyLog['opk']
      break
    case 'weightKg':
      log.weightKg = value as number
      break
    case 'sleepMinutes':
      log.sleepMinutes = value as number
      break
    case 'steps':
      log.steps = value as number
      break
  }
}

function sameStrings(left?: string[], right?: string[]): boolean {
  const a = left ?? []
  const b = right ?? []
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function sameProvenance(
  existing: HealthImportProvenance | undefined,
  incoming: Omit<HealthImportProvenance, 'importedAt'>,
): boolean {
  return Boolean(
    existing &&
      existing.provider === incoming.provider &&
      sameStrings(existing.sampleIds, incoming.sampleIds) &&
      sameStrings(existing.sourceNames, incoming.sourceNames) &&
      existing.menstrualCycleStart === incoming.menstrualCycleStart,
  )
}

/**
 * Copy health samples into local logs without replacing user-entered values.
 *
 * The same provider/sample UUID set and value is a no-op, so repeat imports do
 * not inflate aggregates or rewrite the database.
 */
export async function applyHealthSamples(
  samples: HealthSample[],
  provider: HealthImportProvider,
  importedAt = new Date().toISOString(),
): Promise<HealthImportApplyResult> {
  const { days, uniqueSamples } = groupHealthSamplesWithProvenance(samples, provider)
  let daysChanged = 0
  let fieldsChanged = 0
  let fieldsSkippedForUserData = 0

  await db.transaction('rw', db.dailyLogs, async () => {
    for (const [date, day] of days) {
      const stored = await db.dailyLogs.get(date)
      const next: DailyLog = { ...(stored ?? { date }), date }
      const nextImports = { ...(stored?.healthImports ?? {}) }
      let changed = false

      for (const field of Object.keys(day.values) as HealthImportField[]) {
        const value = day.values[field] as ImportedValue
        if (value === undefined) continue
        const currentProvenance = stored?.healthImports?.[field]
        const currentValue = stored ? readField(stored, field) : undefined

        // A value without import provenance was entered or confirmed by the
        // user. Health imports never silently replace it.
        if (currentValue !== undefined && !currentProvenance) {
          fieldsSkippedForUserData += 1
          continue
        }

        const incomingProvenance = day.provenance[field]
        if (!incomingProvenance) continue
        const valueChanged = currentValue !== value
        const provenanceChanged = !sameProvenance(currentProvenance, incomingProvenance)
        if (!valueChanged && !provenanceChanged) continue

        writeField(next, field, value)
        nextImports[field] = {
          ...incomingProvenance,
          importedAt,
        }
        if (field === 'flow') {
          next.periodStart = incomingProvenance.menstrualCycleStart || undefined
        }
        changed = true
        fieldsChanged += 1
      }

      if (!changed) continue
      next.healthImports = nextImports
      await db.dailyLogs.put(next)
      daysChanged += 1
    }
  })

  return {
    samplesReceived: samples.length,
    uniqueSamples,
    daysConsidered: days.size,
    daysChanged,
    fieldsChanged,
    fieldsSkippedForUserData,
  }
}

