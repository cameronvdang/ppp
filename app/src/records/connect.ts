import { db, getHealthProfile, getSetting, SK } from '../db/schema'
import { normalizeCategories, requireCategories } from './categories'
import { createDemoProvider, DEMO_BUSY, DEMO_PATIENT_ID } from './providers/demo'
import { friendlyStatus } from './providers/http'
import { canonicalizeRelayUrl, createRelayProvider, SESSION_ID, SUBJECT_ID, validateHostedConnectUrl } from './providers/relay'
import { RecordsHttpError, type ConnectSessionState, type RecordsProvider } from './providers/types'
import { loadRelaySettings, type RelaySettings } from './relaySettings'
import type { ReturnParams } from './returnHandler'
import { abortRecordsWork, defaultConnection, getConnection, putConnection, putSnapshot, recordsConsentGranted, recordsTransaction, registerRecordsWork, transitionConnection, type ConnectionPatch } from './store'
import type { RecordCategory, RecordsConnection, SyncFailure } from './types'

export interface ConnectDeps {
  provider: RecordsProvider
  now?: () => string
  randomId?: () => string
  navigate?: (url: string) => void
  sleep?: (ms: number) => Promise<void>
  monotonicNow?: () => number
}
export class InvalidReturnError extends Error { constructor() { super('This link does not match a connection you started.') } }
class StaleOperation extends Error {}
class PollTimeout extends Error {}
const REAUTHORIZE = 'Your provider needs you to sign in again. Start again to reconnect.'
const POLL_TIMEOUT = 'Your connection is taking longer than expected. Check again.'
const refreshes = new Map<number, Promise<RecordsConnection>>()
const completions = new Map<number, Promise<RecordsConnection>>()
let refreshRequest: Promise<RecordsConnection> | null = null
const now = (deps: ConnectDeps) => deps.now?.() ?? new Date().toISOString()
const mono = (deps: ConnectDeps) => deps.monotonicNow?.() ?? performance.now()
const intersection = (a: readonly RecordCategory[], b: readonly RecordCategory[]) => normalizeCategories(a).filter(c => b.includes(c))
function randomId(): string { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
export async function hasRecordsConsent(): Promise<boolean> { return recordsConsentGranted(await getHealthProfile()) }
export async function grantRecordsConsent(): Promise<void> {
  await recordsTransaction(async () => {
    const p = await getHealthProfile()
    await db.healthProfiles.put({ ...p, privacy: { ...p.privacy, consentLedger: [...p.privacy.consentLedger.filter(d => d.purpose !== 'medical-records'), { purpose: 'medical-records', state: 'granted', version: 1, decidedAt: new Date().toISOString() }] } })
  })
}
export function providerFor(connection: RecordsConnection, relay: RelaySettings): RecordsProvider {
  if (connection.mode === 'demo') return createDemoProvider()
  const baseUrl = relay.baseUrl ? canonicalizeRelayUrl(relay.baseUrl) : null
  if (!baseUrl || baseUrl !== connection.relayBaseUrl || relay.tokenRelayBaseUrl !== baseUrl || !relay.token?.trim()) throw new Error('Save a relay URL and its required token in Settings to connect your provider.')
  return createRelayProvider({ baseUrl, token: relay.token })
}
async function currentFor(captured: RecordsConnection, deps: ConnectDeps): Promise<RecordsConnection> {
  const current = await getConnection()
  if (current.generation !== captured.generation || current.status === 'disconnected' || current.mode !== deps.provider.mode || !await hasRecordsConsent()) throw new StaleOperation()
  if (current.mode === 'live') {
    const relay = await loadRelaySettings()
    providerFor(current, relay)
    if (current.relayBaseUrl !== captured.relayBaseUrl || (deps.provider.relayBaseUrl && deps.provider.relayBaseUrl !== current.relayBaseUrl)) throw new StaleOperation()
  }
  // Settings/key reads can yield to another tab. The commit guard repeats these checks too.
  const latest = await getConnection()
  if (latest.generation !== captured.generation || latest.status === 'disconnected' || !await hasRecordsConsent()) throw new StaleOperation()
  return latest
}
function stopOldWork(): void { refreshRequest = null; abortRecordsWork() }
async function operation<T>(run: (controller: AbortController) => Promise<T>): Promise<T> {
  const controller = new AbortController(), unregister = registerRecordsWork(controller)
  try { return await run(controller) } finally { unregister() }
}
/** Also bounds injected providers and releases cancellation listeners on completion. */
async function bounded<T>(run: () => Promise<T>, controller: AbortController, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort = () => {}
  const interrupted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new StaleOperation())
    controller.signal.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => reject(new PollTimeout()), Math.max(1, timeoutMs))
  })
  try {
    if (controller.signal.aborted) throw new StaleOperation()
    return await Promise.race([run(), interrupted])
  } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort) }
}
async function network<T>(c: RecordsConnection, deps: ConnectDeps, controller: AbortController, run: (provider: RecordsProvider) => Promise<T>, deadline?: number): Promise<T> {
  await currentFor(c, deps)
  const remaining = deadline === undefined ? 10_000 : Math.min(10_000, deadline - mono(deps))
  if (remaining <= 0) throw new PollTimeout()
  return bounded(() => run(deps.provider.withRequest?.({ signal: controller.signal, timeoutMs: remaining }) ?? deps.provider), controller, remaining)
}
async function pause(ms: number, deadline: number, deps: ConnectDeps, controller: AbortController): Promise<void> {
  const remaining = deadline - mono(deps)
  if (ms >= remaining) throw new PollTimeout()
  if (deps.sleep) await bounded(() => deps.sleep!(ms), controller, remaining)
  else await new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new StaleOperation()) }
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve() }, ms)
    controller.signal.addEventListener('abort', abort, { once: true })
    if (controller.signal.aborted) { controller.signal.removeEventListener('abort', abort); abort() }
  })
}
function safeFailure(failure: SyncFailure | null | undefined, reauthorize = false): SyncFailure | null {
  return failure ? { code: reauthorize ? 'reauthorization_required' : 'sync_failed', message: reauthorize ? REAUTHORIZE : 'Your provider could not finish sharing records.', retryable: failure.retryable === true } : null
}
async function persistError(c: RecordsConnection, error: unknown, recoveryAction: RecordsConnection['recoveryAction'], patch: Partial<ConnectionPatch> = {}, message?: string): Promise<RecordsConnection> {
  if (!(error instanceof StaleOperation)) {
    const lastError = message ?? (error instanceof PollTimeout || (error instanceof DOMException && error.name === 'TimeoutError') ? recoveryAction === 'check-again' ? POLL_TIMEOUT : 'The records service did not respond in time. Try again.'
      : error instanceof RecordsHttpError ? error.status === 429 && c.mode === 'demo' ? DEMO_BUSY : friendlyStatus(error.status)
      : 'The records service is unavailable right now.')
    await putConnection({ ...patch, expectedGeneration: c.generation, status: 'error', lastError, recoveryAction })
  }
  return getConnection()
}
function syncPatch(s: ConnectSessionState): Partial<ConnectionPatch> {
  return { sync: s.sync, grantedCategories: s.grantedCategories, availableCategories: s.availableCategories, missingCategories: s.missingCategories, failure: safeFailure(s.failure, s.sync.status === 'reauthorization_required'), warnings: s.warnings }
}
function completedTime(deps: ConnectDeps, c: RecordsConnection): string {
  const value = now(deps)
  return c.lastSyncAt && Date.parse(value) <= Date.parse(c.lastSyncAt) ? new Date(Date.parse(c.lastSyncAt) + 1).toISOString() : value
}
async function fetchAndCommit(c: RecordsConnection, deps: ConnectDeps, controller: AbortController): Promise<RecordsConnection> {
  try {
    const current = await currentFor(c, deps)
    const effective = intersection(current.categories, current.grantedCategories)
    if (!current.subject || !effective.length) return persistError(c, new Error(), 'start-again', { pendingSession: undefined, creationAttempt: undefined }, 'No chosen categories were shared from your provider. Start again to choose categories.')
    const snapshot = await network(c, deps, controller, p => p.fetchSnapshot(current.subject!, effective))
    const scope = intersection(effective, snapshot.grantedCategories)
    const patch: ConnectionPatch = { expectedGeneration: c.generation, sources: snapshot.sources, warnings: snapshot.warnings, sync: snapshot.sync, syncStatus: snapshot.syncStatus, grantedCategories: scope,
      availableCategories: intersection(scope, snapshot.availableCategories), missingCategories: intersection(scope, snapshot.missingCategories), failure: safeFailure(snapshot.failure), consentReceiptIds: snapshot.consentReceiptIds, skipped: snapshot.skipped, additionalItems: snapshot.additionalItems }
    if (snapshot.syncStatus === 'not_started') return persistError(c, new Error(), current.pendingSession ? 'check-again' : 'refresh', patch, 'Your records have not been refreshed yet. Check again shortly.')
    if (!scope.length) return persistError(c, new Error(), 'start-again', { ...patch, pendingSession: undefined, creationAttempt: undefined }, 'No chosen categories were shared from your provider. Start again to choose categories.')
    const replace = snapshot.syncStatus === 'partial' ? intersection(scope, snapshot.availableCategories) : scope
    const timestamp = completedTime(deps, current)
    await putSnapshot(snapshot.records.filter(r => replace.includes(r.category)), replace, { ...patch, status: 'connected', lastSyncAt: timestamp, connectedAt: current.connectedAt ?? timestamp, pendingSession: undefined, creationAttempt: undefined, lastError: undefined, recoveryAction: undefined })
  } catch (error) {
    if (error instanceof RecordsHttpError && error.status === 410) return persistError(c, error, 'start-again', { pendingSession: undefined, creationAttempt: undefined, sync: { status: 'reauthorization_required' } }, REAUTHORIZE)
    return persistError(c, error, 'refresh')
  }
  return getConnection()
}
async function refresh(deps: ConnectDeps, captured?: RecordsConnection): Promise<RecordsConnection> {
  const c = captured ?? await getConnection()
  const existing = refreshes.get(c.generation)
  if (existing) return existing
  const run = () => operation(async controller => {
    const locked = async () => {
      try {
        const latest = await currentFor(c, deps)
        if (latest.lastSyncAt !== c.lastSyncAt) return latest
        return fetchAndCommit(c, deps, controller)
      } catch (error) { return persistError(c, error, 'refresh') }
    }
    const locks = globalThis.navigator?.locks
    return locks ? await locks.request(`lunara-records-refresh:${c.generation}`, { mode: 'exclusive' }, locked) : locked()
  })
  const promise = run()
  refreshes.set(c.generation, promise)
  try { return await promise } finally { if (refreshes.get(c.generation) === promise) refreshes.delete(c.generation) }
}
export function syncSnapshot(deps: ConnectDeps): Promise<RecordsConnection> {
  if (refreshRequest) return refreshRequest
  const promise = refresh(deps)
  refreshRequest = promise
  void promise.finally(() => { if (refreshRequest === promise) refreshRequest = null }).catch(() => {})
  return promise
}
export async function startConnection(input: RecordCategory[], deps: ConnectDeps): Promise<'connected' | 'redirected' | 'error'> {
  let c: RecordsConnection | undefined
  try {
    const categories = normalizeCategories(requireCategories(input))
    if (!await hasRecordsConsent()) return 'error'
    const relay = deps.provider.mode === 'live' ? await loadRelaySettings() : null
    if (relay) {
      providerFor({ ...defaultConnection(), mode: 'live', relayBaseUrl: relay.baseUrl }, relay)
      if (deps.provider.relayBaseUrl && deps.provider.relayBaseUrl !== relay.baseUrl) return 'error'
    }
    c = await recordsTransaction(async () => {
      if (relay && canonicalizeRelayUrl(await getSetting(SK.recordsRelayUrl) ?? '') !== relay.baseUrl) throw new StaleOperation()
      return transitionConnection(current => {
        const reuse = current.mode === deps.provider.mode && current.relayBaseUrl === (relay?.baseUrl ?? null) && !current.pendingSession && JSON.stringify(current.creationAttempt?.categories) === JSON.stringify(categories)
        const creationAttempt = reuse ? current.creationAttempt! : { externalId: deps.randomId?.() ?? randomId(), categories, returnUrl: `${location.origin}/?records=return` }
        return { ...current, mode: deps.provider.mode, status: 'pending', categories, relayBaseUrl: relay?.baseUrl ?? null, subject: deps.provider.mode === 'demo' ? DEMO_PATIENT_ID : undefined,
          grantedCategories: deps.provider.mode === 'demo' ? categories : [], availableCategories: [], missingCategories: [], sync: { status: 'not_started' }, pendingSession: undefined, creationAttempt, failure: null, lastError: undefined, recoveryAction: undefined }
      }, { requireConsent: true })
    })
    stopOldWork()
    const captured = c
    return await operation(async controller => {
      try {
        const result = await network(captured, deps, controller, p => p.startConnect(captured.creationAttempt!))
        if (captured.mode === 'demo') {
          const done = await refresh(deps, captured)
          return done.generation === captured.generation && done.status === 'connected' ? 'connected' : 'error'
        }
        if (!SESSION_ID.test(result.sessionId) || !result.redirectUrl) throw new Error('Invalid connection.')
        const redirect = validateHostedConnectUrl(result.redirectUrl)
        const committed = await putConnection({ expectedGeneration: captured.generation, pendingSession: { id: result.sessionId, externalId: captured.creationAttempt!.externalId, categories, startedAt: now(deps) } })
        if (!committed) return 'error'
        await currentFor(captured, deps)
        if (controller.signal.aborted) return 'error'
        ;(deps.navigate ?? (url => location.assign(url)))(redirect)
        return 'redirected'
      } catch (error) {
        const definitive = error instanceof RecordsHttpError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)
        await persistError(captured, error, 'start-again', definitive ? { creationAttempt: undefined, pendingSession: undefined } : {})
        return 'error'
      }
    })
  } catch (error) { if (c) await persistError(c, error, 'start-again'); return 'error' }
}
/** Read-only validation also used before joining StrictMode's shared return promise. */
export async function validatePendingReturn(params: ReturnParams, deps?: ConnectDeps): Promise<RecordsConnection> {
  if (!params.isReturn || params.invalidSession) throw new InvalidReturnError()
  const c = await getConnection()
  if (c.mode !== 'live' || c.status === 'disconnected' || !c.pendingSession || !SESSION_ID.test(c.pendingSession.id) || (params.sessionId !== null && params.sessionId !== c.pendingSession.id) || !await hasRecordsConsent()) throw new InvalidReturnError()
  try {
    const relay = await loadRelaySettings()
    providerFor(c, relay)
    if (deps && (deps.provider.mode !== 'live' || (deps.provider.relayBaseUrl && deps.provider.relayBaseUrl !== c.relayBaseUrl))) throw new InvalidReturnError()
    const latest = await getConnection()
    if (latest.generation !== c.generation || latest.pendingSession?.id !== c.pendingSession.id || !await hasRecordsConsent()) throw new InvalidReturnError()
  } catch { throw new InvalidReturnError() }
  return c
}
async function poll(c: RecordsConnection, deps: ConnectDeps, controller: AbortController): Promise<RecordsConnection> {
  const deadline = mono(deps) + 60_000
  while (mono(deps) < deadline) {
    try {
      const s = await network(c, deps, controller, p => p.getSession(c.pendingSession!.id), deadline)
      if (s.id !== c.pendingSession!.id) throw new Error('Invalid session.')
      const meta = syncPatch(s)
      const terminal = ['abandoned', 'canceled', 'expired', 'failed'].includes(s.status)
      if (terminal || ['failed', 'reauthorization_required'].includes(s.sync.status)) {
        return persistError(c, new Error(), 'start-again', { ...meta, pendingSession: undefined, creationAttempt: undefined }, s.sync.status === 'reauthorization_required' ? REAUTHORIZE : 'This connection could not finish. Start again to reconnect.')
      }
      const patch = { ...meta, expectedGeneration: c.generation, ...(s.subject && SUBJECT_ID.test(s.subject) ? { subject: s.subject } : {}) }
      if (!await putConnection(patch)) return getConnection()
      if (s.status === 'completed' && ['complete', 'partial'].includes(s.sync.status) && s.subject) {
        if (s.retryAfterSeconds) await pause(s.retryAfterSeconds * 1000, deadline, deps, controller)
        // Keep the poll's generation and session through Retry-After and snapshot commit.
        return refresh(deps, c)
      }
      await pause(Math.max(2000, (s.retryAfterSeconds ?? 0) * 1000), deadline, deps, controller)
    } catch (error) {
      if (error instanceof RecordsHttpError && error.status === 429) {
        try { await pause(Math.max(2000, (error.retryAfterSeconds ?? 2) * 1000), deadline, deps, controller); continue } catch (e) { error = e }
      }
      const expired = error instanceof RecordsHttpError && error.status === 410
      return persistError(c, error, expired ? 'start-again' : 'check-again', expired ? { pendingSession: undefined, creationAttempt: undefined } : {})
    }
  }
  return persistError(c, new PollTimeout(), 'check-again')
}
export async function completePendingConnection(params: ReturnParams, deps: ConnectDeps): Promise<RecordsConnection> {
  const c = await validatePendingReturn(params, deps)
  const existing = completions.get(c.generation)
  if (existing) return existing
  const promise = operation(controller => poll(c, deps, controller))
  completions.set(c.generation, promise)
  try { return await promise } finally { if (completions.get(c.generation) === promise) completions.delete(c.generation) }
}
export async function cancelConnection(): Promise<void> {
  await transitionConnection(c => { const { pendingSession: _, creationAttempt: __, ...rest } = c; return { ...rest, status: 'disconnected', lastError: undefined, recoveryAction: undefined } })
  stopOldWork()
}
export async function disconnectAndDelete(): Promise<void> {
  await transitionConnection(defaultConnection, { clear: true, consent: 'declined' })
  stopOldWork()
}
