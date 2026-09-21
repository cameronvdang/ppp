// app/src/records/categories.ts
import type { RecordCategory } from './types'
export const RECORD_CATEGORIES: readonly RecordCategory[] = ['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'] as const
export const CATEGORY_LABELS: Record<RecordCategory, string> = { demographics: 'About you', medications: 'Medications', conditions: 'Conditions', allergies: 'Allergies', labs: 'Lab results', vitals: 'Vital signs', immunizations: 'Immunizations' }
export function isRecordCategory(value: unknown): value is RecordCategory { return typeof value === 'string' && (RECORD_CATEGORIES as readonly string[]).includes(value) }
export function normalizeCategories(input: readonly unknown[]): RecordCategory[] { return RECORD_CATEGORIES.filter((c) => input.includes(c)) }
/** Use normalization only for trusted category intersections, never relay input validation. */
export function requireCategories(input: unknown): RecordCategory[] {
  if (!Array.isArray(input) || input.length === 0 || !input.every(isRecordCategory) || new Set(input).size !== input.length) {
    throw new Error('Choose at least one supported category without duplicates.')
  }
  return input
}
export function recordId(mode: 'demo' | 'live', category: RecordCategory, upstreamId: string): string {
  if (!upstreamId || (mode === 'live' && !/^rec_[a-f0-9]{24}$/.test(upstreamId))) throw new Error('Invalid stable record ID.')
  return `${mode}:${category}:${upstreamId}`
}
