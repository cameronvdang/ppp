// app/src/records/normalize/fhir.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/demo-records.json'
import { normalizeFhirRecordMap } from './fhir'
import { RECORD_CATEGORIES } from '../categories'

const opts = { mode: 'demo' as const, syncedAt: '2026-09-11T00:00:00Z', synthetic: true, sourceName: 'Northstar Health', categories: RECORD_CATEGORIES }

describe('normalizeFhirRecordMap', () => {
  const { records, skipped } = normalizeFhirRecordMap(fixture.record as Record<string, unknown[]>, opts)

  it('normalizes every category in the demo fixture', () => {
    const byCat = Object.groupBy(records, (r) => r.category)
    expect(byCat.demographics).toHaveLength(1)
    expect(byCat.medications).toHaveLength(2)
    expect(byCat.conditions).toHaveLength(2)
    expect(byCat.allergies).toHaveLength(1)
    expect(byCat.labs).toHaveLength(3)
    expect(byCat.vitals).toHaveLength(1)
    expect(byCat.immunizations).toHaveLength(2)
    expect(skipped).toBe(0)
    expect(records.every((r) => r.synthetic && r.syncedAt === opts.syncedAt)).toBe(true)
  })

  it('maps the patient', () => {
    const p = records.find((r) => r.category === 'demographics')!
    expect(p).toMatchObject({ id: 'demo:demographics:patient-demo-001', name: 'Morgan Rivera', birthDate: '1988-04-17', gender: 'female' })
    expect((p as any).address).toContain('Demo City')
  })

  it('maps a medication with dosage text and RxNorm coding', () => {
    const m = records.find((r) => r.id === 'demo:medications:medication-demo-001')!
    expect(m).toMatchObject({ name: 'Metformin 500 mg tablet', status: 'active', startDate: '2026-07-18' })
    expect((m as any).dosage).toMatch(/twice daily/)
    expect(m.codes[0]).toMatchObject({ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '861007' })
  })

  it('routes observations to labs or vitals and flattens blood pressure', () => {
    const a1c = records.find((r) => r.id === 'demo:labs:observation-demo-a1c')!
    expect(a1c).toMatchObject({ category: 'labs', name: 'Hemoglobin A1c', value: 6.4, unit: '%', date: '2026-07-18T15:30:00Z' })
    const bp = records.find((r) => r.category === 'vitals')!
    expect((bp as any).value).toBe('124/78')
    expect((bp as any).unit).toBe('mmHg')
  })

  it('identifies BP by LOINC after component order is reversed', () => {
    const reversed = structuredClone(fixture.record) as any
    reversed.vitals[0].component.reverse()
    expect(normalizeFhirRecordMap(reversed, opts).records.find((r) => r.category === 'vitals')).toMatchObject({ value: '124/78', unit: 'mmHg' })
  })

  it('keeps unrelated components labeled and one-sided ranges readable', () => {
    const observation = { resourceType: 'Observation', id: 'other', code: { text: 'Other measurements' }, category: [{ coding: [{ code: 'laboratory' }] }], component: [
      { code: { text: 'A', coding: [{ system: 'http://loinc.org', code: '1111-1' }] }, valueQuantity: { value: 2, unit: 'u' } },
      { code: { text: 'B', coding: [{ system: 'http://loinc.org', code: '2222-2' }] }, valueQuantity: { value: 3, unit: 'u' } },
    ] }
    for (const [range, expected] of [[{ low: { value: 1, unit: 'u' } }, '≥ 1 u'], [{ high: { value: 4, unit: 'u' } }, '≤ 4 u']] as const) {
      const record = normalizeFhirRecordMap({ labs: [{ ...observation, referenceRange: [range] }] }, opts).records[0] as any
      expect(record.value).toBe('A: 2 u, B: 3 u')
      expect(record.referenceRange).toBe(expected)
      expect(record.date).toBeNull()
    }
    expect(normalizeFhirRecordMap({ labs: [null, {}, 42] }, opts).records).toEqual([])
  })

  it('skips unknown resource types and observations without a category', () => {
    const { records: r, skipped: s } = normalizeFhirRecordMap(
      { labs: [{ resourceType: 'Procedure', id: 'p1' }, { resourceType: 'Observation', id: 'o1', code: { text: 'X' } }] },
      opts,
    )
    expect(r).toHaveLength(0)
    expect(s).toBe(2)
  })
})

it('does not format incompatible units as blood pressure', () => {
  const input = structuredClone(fixture.record)
  input.vitals[0].component[1].valueQuantity.unit = 'kPa'
  const result = normalizeFhirRecordMap(input, opts).records.find(r => r.category === 'vitals') as any
  expect(result.value).toBe('Systolic blood pressure: 124 mmHg, Diastolic blood pressure: 78 kPa')
})
it('enforces selection and counts unsupported arrays separately', () => {
  const result = normalizeFhirRecordMap({ ...fixture.record, encounters: [{}, {}] }, { ...opts, categories: ['labs'] })
  expect(result.records).toHaveLength(3)
  expect(result.records.every(r => r.category === 'labs')).toBe(true)
  expect(result.additionalItems).toBe(2)
  expect(result.skipped).toBe(0)
})
it('counts malformed names and IDs while preserving valid missing dates', () => {
  const result = normalizeFhirRecordMap({ labs: [null, 42, {}, { ...fixture.record.labs[0], id: '' }, { ...fixture.record.labs[0], code: {} }, { ...fixture.record.labs[0], effectiveDateTime: 'bad' }] }, opts)
  expect(result.skipped).toBe(5)
  expect(result.records[0].date).toBeNull()
})
