import { requireCategories } from '../categories'
import { normalizeFhirRecordMap } from '../normalize/fhir'
import { object, string } from '../normalize/fields'
import type { RecordCategory } from '../types'
import { requestJson, type HttpDeps } from './http'
import { RecordsHttpError, type RecordsProvider } from './types'
export const DEMO_BASE_URL = 'https://api.finchnode.com/demo/v1'
export const DEMO_PATIENT_ID = 'patient-demo-001'
export const DEMO_BUSY = "FinchNode's sample API is busy, try again in a minute"
export function createDemoProvider(deps: HttpDeps = {}): RecordsProvider {
  let categories: RecordCategory[] = []
  let sessionId = ''
  const json = async (path: string, init?: RequestInit) => {
    try { return object(await requestJson<unknown>(`${DEMO_BASE_URL}${path}`, { ...deps, ...init })) }
    catch (error) {
      if (error instanceof RecordsHttpError && error.status === 429) throw new RecordsHttpError(DEMO_BUSY, 429, error.retryAfterSeconds, error.code)
      throw error
    }
  }
  return {
    mode: 'demo',
    withRequest: options => createDemoProvider({ ...deps, ...options }),
    async startConnect(input) {
      categories = [...requireCategories(input.categories)]
      const r = await json('/connect/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ external_user_id: input.externalId, categories }) })
      // The demo contract deliberately leaves the response open; patient identity is fixed.
      sessionId = string(r.id) ?? 'demo-completed'
      return { sessionId, redirectUrl: null, expiresAt: null, completed: true, subject: DEMO_PATIENT_ID }
    },
    async getSession(id) {
      if (!sessionId || id !== sessionId) throw new Error('Invalid sample connection.')
      return { id, status: 'completed', subject: DEMO_PATIENT_ID, expiresAt: null, sync: { status: 'complete' }, grantedCategories: categories, availableCategories: categories, missingCategories: [], failure: null, warnings: [] }
    },
    async fetchSnapshot(subject, selected) {
      const categories = [...requireCategories(selected)]
      if (subject !== DEMO_PATIENT_ID) throw new Error('Invalid sample patient.')
      const r = await json(`/patients/${subject}/records?categories=${categories.join(',')}`)
      if (r.record === null || typeof r.record !== 'object' || Array.isArray(r.record)) throw new Error('The records service returned an invalid snapshot.')
      const syncedAt = new Date().toISOString()
      const normalized = normalizeFhirRecordMap(r.record as Record<string, unknown[]>, { mode: 'demo', syncedAt, synthetic: true, sourceName: 'Northstar Health', categories })
      return { ...normalized, records: normalized.records.filter(r => categories.includes(r.category)), synthetic: true, sources: [{ system: 'northstar-health', organization: 'Northstar Health', lastSyncedAt: syncedAt }], warnings: [], consentReceiptIds: [], syncStatus: 'complete', sync: { status: 'complete' }, grantedCategories: categories, availableCategories: categories, missingCategories: [], failure: null }
    },
  }
}
