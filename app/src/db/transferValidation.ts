import { isRecordCategory } from '../records/categories'
import { canonicalizeRelayUrl } from '../records/providers/relay'
import { object } from '../records/normalize/fields'
import type { MedicalRecord, RecordsConnection } from '../records/types'

type Check = (value: unknown) => boolean
const str: Check = v => typeof v === 'string'
const nonempty: Check = v => typeof v === 'string' && v.trim().length > 0
const num: Check = v => typeof v === 'number' && Number.isFinite(v)
const bool: Check = v => typeof v === 'boolean'
const one = (...values: unknown[]): Check => v => values.includes(v)
const nullable = (check: Check): Check => v => v === null || check(v)
const optional = (check: Check): Check => v => v === undefined || check(v)
const arr = (check: Check): Check => v => Array.isArray(v) && v.every(check)
const strings = arr(str)
const shape = (fields: Record<string, Check>): Check => value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(fields).every(([key, check]) => check(object(value)[key]))
const date: Check = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(v) && Number.isFinite(Date.parse(v))
const cats: Check = v => Array.isArray(v) && v.every(isRecordCategory) && new Set(v).size === v.length
const json: Check = v => v === null || str(v) || bool(v) || num(v) || (Array.isArray(v) ? v.every(json) : v !== undefined && typeof v === 'object' && Object.values(object(v)).every(x => x === undefined || json(x)))
const fields = (keys: string[], check: Check) => Object.fromEntries(keys.map(k => [k, check]))
export function assertValid(value: unknown, check: Check, name: string): void { if (!check(value)) throw new Error(`Invalid ${name} in PPP export.`) }
export function validateRows(value: unknown, check: Check, name: string): void { assertValid(value, arr(v => json(v) && check(v)), name) }
export const settingCheck = shape({ key: nonempty, value: str })
export const bookmarkCheck = shape({ slug: nonempty, savedAt: date })
export const dailyLogCheck = shape({ date,
  ...fields(['flow', 'discharge', 'sex', 'pregnancyTest', 'opk', 'notes'], optional(str)),
  ...fields(['symptoms', 'moods', 'events', 'intimacyEvents', 'digestion', 'activities', 'lifestyle'], optional(strings)),
  ...fields(['bbt', 'weightKg', 'waterMl', 'sleepMinutes', 'steps'], optional(num)),
  checkInComplete: optional(bool), periodStart: optional(bool),
  symptomRatings: optional(v => Object.values(object(v)).every(shape({ severity: optional(one('mild', 'moderate', 'severe')), impairment: optional(one('none', 'noticeable', 'limited-routine')) }))),
  healthImports: optional(v => v !== null && typeof v === 'object' && Object.values(object(v)).every(shape({ provider: one('apple-health', 'health-connect'), sampleIds: strings, sourceNames: optional(strings), menstrualCycleStart: optional(bool), importedAt: date }))),
})
const goals = one('cycle', 'ttc', 'pregnancy', 'peri')
const contraception = one('none', 'combined-pill-patch-ring', 'progestin-only-pill', 'injection', 'implant', 'hormonal-iud', 'copper-iud', 'barrier', 'sterilization', 'other', 'unknown', 'prefer-not-to-say')
export const profileCheck = shape({ id: one('primary'), schemaVersion: one(2), createdAt: date, updatedAt: date, displayName: optional(str), birthYear: optional(num), goals: arr(goals), primaryGoal: goals,
  cycle: shape({ regularity: one('regular', 'irregular', 'unsure'), lastPeriodStart: optional(date), typicalCycleLength: optional(num), typicalPeriodLength: optional(num), dateConfidence: one('known', 'approximate', 'unknown'), abnormalities: strings, baselineSymptoms: strings, hormonalSignals: strings }),
  reproductive: shape({ contraception, pregnancyLmp: optional(date), numberOfBabies: optional(num), tryingSince: optional(v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v)), pregnancyDating: optional(shape({ method: str, inputDate: date, estimatedDueDate: date, gestationalStart: date, authority: str, provisional: bool, updatedAt: date })) }),
  conditions: strings,
  wellbeing: shape({ ...fields(['sleepImpact', 'skinImpact', 'activityImpact'], optional(one('yes', 'no', 'unsure', 'prefer-not-to-say'))), sleepGoals: strings, activityLevel: str, wearable: str, mentalHealthSignals: strings, sexualWellnessGoals: strings }),
  biometrics: shape({ heightCm: optional(num), weightKg: optional(num) }),
  permissions: shape(fields(['motionFitness', 'healthData', 'notifications'], one('not-requested', 'requested', 'granted', 'denied'))),
  privacy: shape({ ageBand: one('unknown', '13-15', '16-17', 'adult'), minimumAgeConfirmed: bool, localOnly: bool, onboardingVersion: one(2), consentLedger: arr(shape({ purpose: one('local-health-storage', 'assistant-sharing', 'health-import', 'notifications', 'medical-records'), state: one('granted', 'declined', 'not-requested'), version: one(1), decidedAt: date })) }),
})
const cycleCheck = shape({ wearDays: num, ringFreeDays: num })
const configCheck: Check = v => {
  const r = object(v)
  const checks: Record<string, Check> = {
    pill: shape({ activePillsPerPack: num, placeboPillsPerPack: num, schedule: one('standard', 'continuous', 'extended', 'flexible'), currentPackStart: optional(date) }),
    patch: shape({ cycle: cycleCheck, currentPatchStart: optional(date) }), ring: shape({ cycle: cycleCheck, currentRingStart: optional(date) }),
    injection: shape({ intervalDays: num, lastInjectionDate: optional(date) }), implant: shape({ insertedDate: optional(date), plannedRemovalDate: optional(date) }),
    iud: shape({ hormonal: bool, insertedDate: optional(date), plannedReplacementDate: optional(date) }), barrier: shape({}), other: shape({ description: optional(str) }),
  }
  return typeof r.kind === 'string' && !!checks[r.kind]?.(v)
}
export const regimenCheck = shape({ id: nonempty, method: v => contraception(v) && !['none', 'unknown', 'prefer-not-to-say', 'sterilization'].includes(String(v)), startDate: date, endDate: optional(date), createdAt: date, updatedAt: date, ...fields(['product', 'dose', 'stopReason', 'notes'], optional(str)), config: optional(configCheck) })
export const missedCheck = shape({ id: nonempty, regimenId: nonempty, date, kind: one('late', 'skipped'), hoursLate: optional(num), notes: optional(str), recordedAt: date })
const coding = shape(fields(['system', 'code', 'display'], nullable(str)))
const base = { id: nonempty, category: isRecordCategory, sourceRecordId: nullable(str), sourceName: nullable(str), date: nullable(date), codes: arr(coding), syncedAt: date, synthetic: bool }
const recordFields: Record<string, Record<string, Check>> = {
  demographics: { name: nonempty, birthDate: nullable(date), ...fields(['gender', 'address', 'phone', 'email'], nullable(str)) },
  medications: { name: nonempty, ...fields(['dosage', 'frequency', 'status', 'prescriber', 'reason'], nullable(str)), ...fields(['startDate', 'endDate'], nullable(date)) },
  conditions: { name: nonempty, ...fields(['status', 'verificationStatus', 'severity'], nullable(str)), ...fields(['onsetDate', 'recordedDate'], nullable(date)) },
  allergies: { substance: nonempty, ...fields(['reaction', 'severity', 'status', 'verificationStatus'], nullable(str)), recordedDate: nullable(date) },
  immunizations: { name: nonempty, ...fields(['code', 'status', 'manufacturer', 'lotNumber'], nullable(str)) },
}
recordFields.labs = recordFields.vitals = { name: nonempty, value: nullable(v => str(v) || num(v)), ...fields(['unit', 'status', 'referenceRange', 'interpretation'], nullable(str)) }
export function validateMedicalRecord(value: unknown): MedicalRecord {
  const r = object(value), schema = { ...base, ...recordFields[String(r.category)] }
  assertValid(r, v => shape(schema)(v) && (r.synthetic ? new RegExp(`^demo:${r.category}:.+$`).test(String(r.id)) : new RegExp(`^live:${r.category}:rec_[a-f0-9]{24}$`).test(String(r.id))), 'medical record')
  return Object.fromEntries(Object.keys(schema).map(key => [key, r[key]])) as unknown as MedicalRecord
}
const source = shape({ system: str, organization: nullable(str), lastSyncedAt: nullable(date) })
const warning = shape({ code: str, message: str, category: optional(nullable(isRecordCategory)) })
const sync = shape({ status: one('not_started', 'queued', 'syncing', 'complete', 'partial', 'failed', 'reauthorization_required') })
const failure = nullable(shape({ code: str, message: str, retryable: bool }))
const connectionFields = { id: one('primary'), mode: one('demo', 'live'), status: one('disconnected', 'pending', 'connected', 'error'), generation: v => num(v) && Number.isSafeInteger(v) && Number(v) >= 0,
  relayBaseUrl: nullable(str), categories: cats, grantedCategories: cats, availableCategories: cats, missingCategories: cats, sources: arr(source), warnings: arr(warning), consentReceiptIds: strings,
  additionalItems: v => num(v) && Number.isSafeInteger(v) && Number(v) >= 0, skipped: optional(v => num(v) && Number.isSafeInteger(v) && Number(v) >= 0),
  ...fields(['importedAt', 'connectedAt', 'lastSyncAt'], optional(date)), subject: optional(nonempty), sync: optional(sync), failure: optional(failure), syncStatus: optional(one('complete', 'partial', 'not_started')), lastError: optional(str), recoveryAction: optional(one('start-again', 'check-again', 'refresh')),
} satisfies Record<string, Check>
export function validateConnection(value: unknown): Omit<RecordsConnection, 'pendingSession' | 'creationAttempt'> | null {
  if (value === null) return null
  assertValid(value, shape(connectionFields), 'records connection')
  const r = object(value)
  if (r.subject !== undefined && !(r.mode === 'demo' ? r.subject === 'patient-demo-001' : /^u_[a-f0-9]{16}$/.test(String(r.subject)))) throw new Error('Invalid records subject in PPP export.')
  const connection = Object.fromEntries(Object.keys(connectionFields).filter(k => r[k] !== undefined).map(key => [key, r[key]])) as unknown as RecordsConnection
  if (connection.relayBaseUrl !== null) connection.relayBaseUrl = canonicalizeRelayUrl(connection.relayBaseUrl)
  return connection
}
