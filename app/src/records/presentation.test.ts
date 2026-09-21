import { expect, it } from 'vitest'
import { categoryAvailability, recordDetail } from './presentation'
import { defaultConnection } from './store'
it('distinguishes unselected, missing, unavailable and refreshed empty categories', () => {
  const c = { ...defaultConnection(), categories: ['labs'] as ['labs'], grantedCategories: ['labs'] as ['labs'], availableCategories: ['labs'] as ['labs'] }
  expect(categoryAvailability(c, 'vitals')).toBe('Not selected')
  expect(categoryAvailability({ ...c, missingCategories: ['labs'] }, 'labs')).toBe('Not refreshed')
  expect(categoryAvailability({ ...c, syncStatus: 'not_started' }, 'labs')).toBe('Not refreshed')
  expect(categoryAvailability({ ...c, availableCategories: [] }, 'labs')).toBe('Not available')
  expect(categoryAvailability(c, 'labs')).toBe('Available')
})
it('displays zero observation values as text', () => {
  const record = { id: 'demo:labs:1', category: 'labs' as const, date: null, sourceName: null, sourceRecordId: '1', codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: true, name: 'Zero', value: 0, unit: 'u', status: null, referenceRange: null, interpretation: null }
  expect(recordDetail(record)).toBe('0 u · Date not supplied')
  expect(recordDetail({ ...record, date: '2026-07-18T15:30:00Z' })).toBe('0 u · Jul 18, 2026')
})
