// app/src/records/categories.test.ts
import { describe, expect, it } from 'vitest'
import { isRecordCategory, normalizeCategories, requireCategories, RECORD_CATEGORIES, recordId } from './categories'

describe('categories', () => {
  it('lists the seven v1 categories in display order', () => {
    expect(RECORD_CATEGORIES).toEqual(['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'])
  })
  it('filters unknown values and preserves canonical order', () => {
    expect(normalizeCategories(['labs', 'encounters', 'medications', 42])).toEqual(['medications', 'labs'])
    expect(isRecordCategory('claims')).toBe(false)
  })
  it.each([undefined, [], ['labs', 'labs'], ['claims']].map(input => [input]))('rejects invalid outbound categories: %j', (input) => {
    expect(() => requireCategories(input)).toThrow()
  })
  it('requires stable live IDs and keeps demo FHIR IDs', () => {
    expect(recordId('demo', 'labs', 'obs-1')).toBe('demo:labs:obs-1')
    expect(recordId('live', 'labs', 'rec_000000000000000000000001')).toBe('live:labs:rec_000000000000000000000001')
    expect(() => recordId('live', 'labs', '')).toThrow(/stable/)
  })
})
