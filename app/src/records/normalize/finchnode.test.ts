// app/src/records/normalize/finchnode.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/finchnode-health-record.json'
import { normalizeFinchnodeHealthRecord } from './finchnode'
import { RECORD_CATEGORIES } from '../categories'

describe('normalizeFinchnodeHealthRecord', () => {
  const out = normalizeFinchnodeHealthRecord(fixture as any, { syncedAt: '2026-09-11T00:00:00Z', categories: RECORD_CATEGORIES })

  it('validates normalized records with stable live ids and no synthetic flag', () => {
    expect(out.records).toHaveLength(6)
    expect(out.records.some((r) => r.category === 'immunizations')).toBe(false)
    expect(out.additionalItems).toBe(4)
    expect(out.records.every((r) => r.id.startsWith('live:') && r.synthetic === false)).toBe(true)
    const med = out.records.find((r) => r.category === 'medications') as any
    expect(med.name).toBeTruthy()
    expect(med.date).toBe(med.startDate)
  })

  it('surfaces sources, consent receipts, sync status and warnings', () => {
    expect(out.sources[0]).toMatchObject({ system: 'epic', organization: 'Example Medical Center' })
    expect(out.consentReceiptIds).toEqual(['rcpt_ABC123'])
    expect(out.syncStatus).toBe('partial')
    expect(out.warnings[0]).toMatchObject({ code: 'category_unavailable', category: 'immunizations' })
  })

  it('handles explicit null, object-only and duplicate nested demographics', () => {
    const person = fixture.data.demographics
    const normalize = (demographics: unknown) => normalizeFinchnodeHealthRecord(
      { ...fixture, data: { demographics } } as any,
      { syncedAt: '2026-09-11T00:00:00Z', categories: ['demographics'] },
    ).records
    expect(normalize(null)).toEqual([])
    expect(normalize(person)).toHaveLength(1)
    const nested = normalize({ ...person, records: [person, { ...person, id: 'rec_ffffffffffffffffffffffff' }] })
    expect(nested).toHaveLength(2)
    expect(nested.every((r) => !('records' in r))).toBe(true)
  })

  it('converts object observations and skips unstable IDs', () => {
    const lab = fixture.data.labs[0]
    const result = normalizeFinchnodeHealthRecord({ ...fixture, data: { labs: [
      { ...lab, value: { amount: 3, qualifier: 'estimated' } },
      { ...lab, id: null }, { ...lab, id: 'not-stable' },
    ] } } as any, { syncedAt: 'now', categories: ['labs'] })
    expect(result.records).toHaveLength(1)
    expect((result.records[0] as any).value).toBe('{"amount":3,"qualifier":"estimated"}')
    expect(result.skipped).toBe(2)
    expect(result.records[0].sourceRecordId).toBe(lab.sourceRecordId)
  })

  it('tolerates missing arrays and skips nameless records', () => {
    const r = normalizeFinchnodeHealthRecord({ ...fixture, data: { medications: [{ id: 'rec_000000000000000000000000' }] } } as any, { syncedAt: 'now', categories: RECORD_CATEGORIES })
    expect(r.records).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })
})

it('does not allow upstream categories or malformed fields to broaden selection', () => {
  const out = normalizeFinchnodeHealthRecord({ ...fixture, data: { ...fixture.data, labs: [{ ...fixture.data.labs[0], sourceName: {}, source: 42, codes: [null, { system: {}, code: 'ok', display: 4 }], unit: {}, date: 'bad' }], claims: { coverages: [{}, {}], explanationsOfBenefit: [{}] } } }, { syncedAt: 'now', categories: ['labs'] })
  expect(out.records).toHaveLength(1)
  expect(out.records[0]).toMatchObject({ category: 'labs', sourceName: null, date: null, codes: [{ system: null, code: 'ok', display: null }] })
  expect(out.additionalItems).toBe(7)
  expect(out.skipped).toBe(0)
})
it('prefers nested demographics on duplicates and retains no nested array', () => {
  const person = fixture.data.demographics
  const out = normalizeFinchnodeHealthRecord({ ...fixture, data: { demographics: { ...person, records: [{ ...person, name: 'Nested name' }] } } }, { syncedAt: 'now', categories: ['demographics'] })
  expect(out.records).toHaveLength(1)
  expect(out.records[0]).toMatchObject({ name: 'Nested name' })
  expect(out.records[0]).not.toHaveProperty('records')
})
it.each([Infinity, NaN, true, ['a', 2], null])('normalizes JSON observation value %j', (value) => {
  const out = normalizeFinchnodeHealthRecord({ ...fixture, data: { labs: [{ ...fixture.data.labs[0], value }] } }, { syncedAt: 'now', categories: ['labs'] })
  expect((out.records[0] as any).value).toEqual(typeof value === 'number' || value === null ? null : JSON.stringify(value))
})
it('rejects a malformed snapshot envelope instead of treating it as a complete empty refresh', () => {
  expect(() => normalizeFinchnodeHealthRecord({}, { syncedAt: 'now', categories: ['labs'] })).toThrow(/invalid snapshot/)
})
