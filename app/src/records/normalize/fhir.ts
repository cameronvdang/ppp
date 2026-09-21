import { isRecordCategory, recordId } from '../categories'
import type { MedicalRecord, NormalizeResult, RecordCategory, RecordCoding, RecordsMode } from '../types'
import { array, date, extraArrayItems, number, object, string } from './fields'

export function fhirCodings(codeable: unknown): RecordCoding[] {
  return array(object(codeable).coding).map(object).map(c => ({ system: string(c.system), code: string(c.code), display: string(c.display) }))
    .filter(c => c.system !== null || c.code !== null || c.display !== null)
}
export function fhirText(codeable: unknown): string | null {
  return string(object(codeable).text) ?? fhirCodings(codeable).find(c => c.display)?.display ?? null
}
function first(value: unknown) { return object(array(value)[0]) }
function status(value: unknown) { return fhirCodings(value)[0]?.code ?? null }
export function fhirDate(resource: unknown): string | null {
  const r = object(resource)
  switch (r.resourceType) {
    case 'Patient': return date(r.birthDate)
    case 'MedicationRequest': case 'MedicationStatement': return date(r.authoredOn) ?? date(object(r.effectivePeriod).start) ?? date(r.effectiveDateTime)
    case 'Condition': return date(r.onsetDateTime) ?? date(object(r.onsetPeriod).start) ?? date(r.recordedDate)
    case 'AllergyIntolerance': return date(r.recordedDate)
    case 'Immunization': return date(r.occurrenceDateTime)
    default: return date(r.effectiveDateTime) ?? date(object(r.effectivePeriod).start) ?? date(r.issued)
  }
}
function rangeText(value: unknown): string | null {
  const r = first(value)
  if (string(r.text)) return string(r.text)
  const lo = object(r.low), hi = object(r.high)
  const low = number(lo.value), high = number(hi.value)
  const unit = string(lo.unit) ?? string(hi.unit)
  const bounds = low !== null && high !== null ? `${low}–${high}` : low !== null ? `≥ ${low}` : high !== null ? `≤ ${high}` : null
  return bounds === null ? null : [bounds, unit].filter(Boolean).join(' ')
}
function observationValue(r: Record<string, unknown>): { value: string | number | null; unit: string | null } {
  const components = array(r.component).map(object)
  const quantity = object(r.valueQuantity)
  if (!components.length) return { value: number(quantity.value) ?? string(r.valueString) ?? fhirText(r.valueCodeableConcept), unit: string(quantity.unit) }
  const byLoinc = (code: string) => components.find(c => fhirCodings(c.code).some(v => v.system === 'http://loinc.org' && v.code === code))
  const sys = object(byLoinc('8480-6')?.valueQuantity), dia = object(byLoinc('8462-4')?.valueQuantity)
  const pressureUnit = (q: Record<string, unknown>) => ['mmHg', 'mm[Hg]'].includes(String(q.unit)) || (q.system === 'http://unitsofmeasure.org' && q.code === 'mm[Hg]')
  if (components.length === 2 && number(sys.value) !== null && number(dia.value) !== null && pressureUnit(sys) && pressureUnit(dia)) {
    return { value: `${sys.value}/${dia.value}`, unit: 'mmHg' }
  }
  return {
    value: components.map(c => {
      const q = object(c.valueQuantity)
      return `${fhirText(c.code) ?? 'Measurement'}: ${[number(q.value) ?? string(c.valueString) ?? fhirText(c.valueCodeableConcept) ?? 'Not supplied', string(q.unit)].filter(v => v !== null).join(' ')}`
    }).join(', '),
    // Component units are already attached to their labeled values.
    unit: null,
  }
}
type Options = { mode: RecordsMode; syncedAt: string; synthetic: boolean; sourceName: string | null; categories: readonly RecordCategory[] }
function normalize(resource: unknown, opts: Options): MedicalRecord | null {
  const r = object(resource)
  const id = string(r.id)
  if (!id || (opts.mode === 'live' && !/^rec_[a-f0-9]{24}$/.test(id))) return null
  const base = { sourceRecordId: id, sourceName: string(object(r.meta).source) ?? opts.sourceName, date: fhirDate(r), syncedAt: opts.syncedAt, synthetic: opts.synthetic }
  const common = <C extends RecordCategory>(category: C, codeable: unknown) => ({ ...base, id: recordId(opts.mode, category, id), category, codes: fhirCodings(codeable) })
  const name = fhirText(r.code)
  switch (r.resourceType) {
    case 'Patient': {
      const names = array(r.name).map(object)
      const n = names.find(n => n.use === 'official') ?? names[0] ?? {}
      const name = [...array(n.given).map(string).filter(Boolean), string(n.family)].filter(Boolean).join(' ') || string(n.text)
      if (!name) return null
      const a = first(r.address), telecom = array(r.telecom).map(object)
      return { ...common('demographics', null), name, birthDate: date(r.birthDate), gender: string(r.gender), address: [string(a.city), [string(a.state), string(a.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null, phone: string(telecom.find(t => t.system === 'phone')?.value), email: string(telecom.find(t => t.system === 'email')?.value) }
    }
    case 'MedicationRequest': case 'MedicationStatement': {
      const name = fhirText(r.medicationCodeableConcept)
      if (!name) return null
      return { ...common('medications', r.medicationCodeableConcept), name, dosage: string(first(r.dosageInstruction).text) ?? string(first(r.dosage).text), frequency: null, status: string(r.status), startDate: fhirDate(r), endDate: date(object(r.effectivePeriod).end), prescriber: string(object(r.requester).display), reason: fhirText(array(r.reasonCode)[0]) }
    }
    case 'Condition': return name ? { ...common('conditions', r.code), name, status: status(r.clinicalStatus), verificationStatus: status(r.verificationStatus), severity: fhirText(r.severity), onsetDate: date(r.onsetDateTime) ?? date(object(r.onsetPeriod).start), recordedDate: date(r.recordedDate) } : null
    case 'AllergyIntolerance': return name ? { ...common('allergies', r.code), substance: name, reaction: fhirText(array(first(r.reaction).manifestation)[0]), severity: string(first(r.reaction).severity) ?? string(r.criticality), status: status(r.clinicalStatus), verificationStatus: status(r.verificationStatus), recordedDate: date(r.recordedDate) } : null
    case 'Observation': {
      const cats = array(r.category).flatMap(fhirCodings).map(c => c.code)
      const category = cats.includes('laboratory') ? 'labs' : cats.includes('vital-signs') ? 'vitals' : null
      return name && category ? { ...common(category, r.code), name, ...observationValue(r), status: string(r.status), referenceRange: rangeText(r.referenceRange), interpretation: fhirText(array(r.interpretation)[0]) } : null
    }
    case 'DiagnosticReport': return name ? { ...common('labs', r.code), name, value: string(r.conclusion), unit: null, status: string(r.status), referenceRange: null, interpretation: null } : null
    case 'Immunization': {
      const name = fhirText(r.vaccineCode)
      return name ? { ...common('immunizations', r.vaccineCode), name, code: fhirCodings(r.vaccineCode)[0]?.code ?? null, status: string(r.status), manufacturer: string(object(r.manufacturer).display), lotNumber: string(r.lotNumber) } : null
    }
    default: return null
  }
}
export function normalizeFhirRecordMap(recordMap: Record<string, unknown[]>, opts: Options): NormalizeResult {
  const records = new Map<string, MedicalRecord>()
  let skipped = 0, additionalItems = 0
  for (const [category, values] of Object.entries(object(recordMap))) {
    if (!isRecordCategory(category)) { additionalItems += extraArrayItems(values); continue }
    if (!opts.categories.includes(category)) continue
    if (!Array.isArray(values)) { if (values != null) skipped++; continue }
    for (const value of values) {
      const r = normalize(value, opts)
      if (!r) skipped++
      else if (opts.categories.includes(r.category)) records.set(r.id, r)
    }
  }
  return { records: [...records.values()], skipped, additionalItems }
}
