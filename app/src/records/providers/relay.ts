import { normalizeCategories, requireCategories } from '../categories'
import { normalizeFinchnodeHealthRecord, readWarnings } from '../normalize/finchnode'
import { array, date, object, string } from '../normalize/fields'
import type { SyncStatus } from '../types'
import { parseRetryAfter, requestJson, type HttpDeps } from './http'
import type { RecordsProvider, SessionStatus } from './types'
export const SESSION_ID = /^cs_[a-f0-9]{20}$/
export const SUBJECT_ID = /^u_[a-f0-9]{16}$/
export function canonicalizeRelayUrl(value: string): string {
  const u = new URL(value)
  if (!(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) throw new Error('Use an https:// address. On this device, http://localhost or http://127.0.0.1 also works.')
  if (u.username || u.password || u.search || u.hash || value.includes('?') || value.includes('#')) throw new Error('The connector address cannot include a username, password, ? or #.')
  return u.href.replace(/\/+$/, '')
}
export function validateHostedConnectUrl(value: string): string {
  const u = new URL(value)
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('The records service returned an unsafe connection link.')
  return u.href
}
const SESSION_STATUSES: SessionStatus[] = ['pending', 'collect-consented', 'system-selected', 'completed', 'abandoned', 'canceled', 'expired', 'failed']
const SYNC_STATUSES: SyncStatus[] = ['not_started', 'queued', 'syncing', 'complete', 'partial', 'failed', 'reauthorization_required']
export function createRelayProvider(config: { baseUrl: string; token: string }, deps: HttpDeps = {}): RecordsProvider {
  const baseUrl = canonicalizeRelayUrl(config.baseUrl)
  if (!config.token.trim()) throw new Error('Save the required connector key first.')
  const json = (path: string, init: RequestInit = {}, onResponse?: (h: Headers) => void) => requestJson<unknown>(`${baseUrl}${path}`, { ...deps, ...init, onResponse: h => { deps.onResponse?.(h); onResponse?.(h) }, headers: { 'x-ppp-relay-token': config.token, 'content-type': 'application/json' } })
  return {
    mode: 'live', relayBaseUrl: baseUrl,
    withRequest: options => createRelayProvider(config, { ...deps, ...options }),
    async startConnect(input) {
      const categories = requireCategories(input.categories)
      const r = object(await json('/v1/connect/sessions', { method: 'POST', body: JSON.stringify({ categories, returnUrl: input.returnUrl, externalId: input.externalId }) }))
      if (!SESSION_ID.test(String(r.id)) || !string(r.url)) throw new Error('The records service returned an invalid connection.')
      return { sessionId: String(r.id), redirectUrl: validateHostedConnectUrl(String(r.url)), expiresAt: date(r.expiresAt), completed: false, subject: null }
    },
    async getSession(id) {
      if (!SESSION_ID.test(id)) throw new Error('Invalid connection code.')
      let retryAfterSeconds: number | null = null
      const r = object(await json(`/v1/connect/sessions/${id}`, {}, h => { retryAfterSeconds = parseRetryAfter(h.get('retry-after')) }))
      const sync = object(r.sync), failure = object(sync.failure)
      if (r.id !== id || !SESSION_STATUSES.includes(r.status as SessionStatus) || !SYNC_STATUSES.includes(sync.status as SyncStatus)) throw new Error('Could not read the connection status.')
      return { id, status: r.status as SessionStatus, subject: SUBJECT_ID.test(String(r.subject)) ? String(r.subject) : null, expiresAt: date(r.expiresAt),
        sync: { status: sync.status as SyncStatus }, grantedCategories: normalizeCategories(array(sync.grantedCategories)), availableCategories: normalizeCategories(array(sync.availableCategories)), missingCategories: normalizeCategories(array(sync.missingCategories)),
        failure: string(failure.code) && string(failure.message) && typeof failure.retryable === 'boolean' ? { code: String(failure.code), message: String(failure.message), retryable: failure.retryable } : null,
        warnings: readWarnings(sync.warnings), retryAfterSeconds }
    },
    async fetchSnapshot(subject, input) {
      const categories = requireCategories(input)
      if (!SUBJECT_ID.test(subject)) throw new Error('Invalid record code.')
      const r = object(await json(`/v1/users/${subject}/records?categories=${categories.join(',')}`))
      if (r.id !== subject) throw new Error('The records service returned a different record code.')
      return { ...normalizeFinchnodeHealthRecord(r, { syncedAt: new Date().toISOString(), categories }), synthetic: false }
    },
  }
}
