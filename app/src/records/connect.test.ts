// app/src/records/connect.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSetting, SK, PppDB } from '../db/schema'
import { setSecureSecret, SECURE_SECRET_KEYS } from '../platform/secureVault'
import { cancelConnection, completePendingConnection, disconnectAndDelete, grantRecordsConsent, hasRecordsConsent, providerFor, startConnection, syncSnapshot } from './connect'
import { getConnection, listRecords } from './store'
import type { RecordsProvider, RecordsSnapshot, ConnectSessionState } from './providers/types'
import { OfflineError } from '../platform/offline'

const id = 'cs_0123456789abcdef0123'
const subject = 'u_0123456789abcdef'
const ret = { isReturn: true, sessionId: null, invalidSession: false }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((r, fail) => { resolve = r; reject = fail })
  return { promise, resolve, reject }
}
const snapshot: RecordsSnapshot = {
  records: [{ id: 'live:labs:rec_000000000000000000000001', category: 'labs', sourceRecordId: 'lab-source', sourceName: 'Clinic', date: '2026-09-10', codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: false, name: 'A1c', value: 6, unit: '%', status: 'final', referenceRange: null, interpretation: null }],
  skipped: 0, additionalItems: 0, sources: [], warnings: [], syncStatus: 'complete', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, consentReceiptIds: [], synthetic: false,
}
const completed: ConnectSessionState = { id, status: 'completed', subject, sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [], expiresAt: null }
function provider(states: ConnectSessionState[] = [completed]): RecordsProvider {
  let index = 0
  return {
    mode: 'live',
    startConnect: vi.fn(async () => ({ sessionId: id, redirectUrl: 'https://connect.test/s', expiresAt: null, completed: false, subject: null })),
    getSession: vi.fn(async () => states[Math.min(index++, states.length - 1)]),
    fetchSnapshot: vi.fn(async () => snapshot),
  }
}
let elapsed = 0
const deps = { now: () => '2026-09-11T00:00:00Z', randomId: () => 'abcdefghijklmnop', navigate: vi.fn(), monotonicNow: () => elapsed, sleep: async (ms: number) => { elapsed += ms } }

beforeEach(async () => {
  installLifecycleLocks()
  for (const table of db.tables) await table.clear()
  elapsed = 0
  vi.clearAllMocks()
  vi.stubGlobal('location', { origin: 'https://app.test' })
  await setSetting(SK.recordsRelayUrl, 'https://relay.test')
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok' }))
  await grantRecordsConsent()
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each(['start', 'refresh', 'complete'] as const)('rejects offline %s as a promise before changing saved connection state or calling a provider', async action => {
  const p = provider()
  if (action !== 'start') await startConnection(['labs'], { ...deps, provider: p })
  if (action === 'refresh') await completePendingConnection(ret, { ...deps, provider: p })
  const before = await getConnection(), rows = await db.medicalRecords.toArray()
  vi.clearAllMocks()
  vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: false })
  let promise!: Promise<unknown>
  expect(() => {
    promise = action === 'start' ? startConnection(['labs'], { ...deps, provider: p })
      : action === 'refresh' ? syncSnapshot({ ...deps, provider: p })
      : completePendingConnection(ret, { ...deps, provider: p })
  }).not.toThrow()
  await expect(promise).rejects.toThrow(OfflineError)
  expect(await getConnection()).toEqual(before)
  expect(await db.medicalRecords.toArray()).toEqual(rows)
  expect(p.startConnect).not.toHaveBeenCalled()
  expect(p.getSession).not.toHaveBeenCalled()
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
})

describe('connection orchestration', () => {
  it('stores the pending session before navigation with a fixed return URL', async () => {
    const p = provider()
    expect(await startConnection(['labs'], { ...deps, provider: p })).toBe('redirected')
    expect(p.startConnect).toHaveBeenCalledWith({ categories: ['labs'], returnUrl: 'https://app.test/?records=return', externalId: 'abcdefghijklmnop' })
    expect(await getConnection()).toMatchObject({ mode: 'live', relayBaseUrl: 'https://relay.test', pendingSession: { id }, generation: expect.any(Number) })
  })

  it('waits through queued sync and narrows to the granted categories', async () => {
    const p = provider([{ ...completed, sync: { status: 'queued' } }, completed])
    await startConnection(['labs', 'vitals'], { ...deps, provider: p })
    const done = await completePendingConnection(ret, { ...deps, provider: p })
    expect(p.getSession).toHaveBeenCalledTimes(2)
    expect(p.fetchSnapshot).toHaveBeenCalledWith(subject, ['labs'])
    expect(done.status).toBe('connected')
    expect(done.pendingSession).toBeUndefined()
    expect(await listRecords()).toEqual(snapshot.records)
  })

  it('rejects unsolicited, mismatched, malformed and replayed sessions without polling', async () => {
    const p = provider()
    await expect(completePendingConnection(ret, { ...deps, provider: p })).rejects.toThrow('This link does not match a connection you started.')
    expect(p.getSession).not.toHaveBeenCalled()
    await startConnection(['labs'], { ...deps, provider: p })
    for (const params of [{ ...ret, sessionId: 'cs_ffffffffffffffffffff' }, { ...ret, invalidSession: true }]) {
      await expect(completePendingConnection(params, { ...deps, provider: p })).rejects.toThrow(/does not match/)
    }
    expect(p.getSession).not.toHaveBeenCalled()
    await completePendingConnection(ret, { ...deps, provider: p })
    vi.mocked(p.getSession).mockClear()
    await expect(completePendingConnection({ ...ret, sessionId: id }, { ...deps, provider: p })).rejects.toThrow(/does not match/)
    expect(p.getSession).not.toHaveBeenCalled()
  })

  it('does not recreate rows or errors when disconnected during a fetch', async () => {
    const p = provider()
    await startConnection(['labs'], { ...deps, provider: p })
    await completePendingConnection(ret, { ...deps, provider: p })
    let release!: (s: RecordsSnapshot) => void
    let started!: () => void
    const fetching = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(p.fetchSnapshot).mockImplementationOnce(() => { started(); return new Promise((resolve) => { release = resolve }) })
    const refresh = syncSnapshot({ ...deps, provider: p })
    await fetching
    const generation = (await getConnection()).generation
    await disconnectAndDelete()
    release(snapshot)
    await refresh
    expect(await listRecords()).toEqual([])
    expect(await getConnection()).toMatchObject({ status: 'disconnected', generation: generation + 1 })
    expect((await getConnection()).lastError).toBeUndefined()
    await expect(completePendingConnection(ret, { ...deps, provider: p })).rejects.toThrow(/does not match/)
  })
})
import { RecordsHttpError } from './providers/types'
import { wipeLocalData } from '../lib/dataWipe'
import * as sealing from '../crypto/sealed'
import { createDemoProvider } from './providers/demo'
import demoFixture from './__fixtures__/demo-records.json'
import { applyImport, collectExport } from '../db/transfer'
import { RECORD_CATEGORIES } from './categories'
const demoSnapshot = { ...snapshot, records: snapshot.records.map(r => ({ ...r, id: 'demo:labs:sample-lab', synthetic: true })), synthetic: true }
const ready = async (p = provider()) => {
  await startConnection(['labs', 'medications'], { ...deps, provider: p })
  await completePendingConnection(ret, { ...deps, provider: p })
  return p
}
it.each([true, false])('initializes demo before requesting a snapshot; success=%s', async success => {
  const p: RecordsProvider = { mode: 'demo', startConnect: vi.fn(async () => ({ completed: true, subject: 'patient-demo-001', sessionId: 'demo-1', expiresAt: null, redirectUrl: null })), getSession: vi.fn(), fetchSnapshot: vi.fn(async () => {
    expect(await getConnection()).toMatchObject({ mode: 'demo', subject: 'patient-demo-001', categories: ['labs'], grantedCategories: ['labs'], generation: expect.any(Number) })
    if (!success) throw new Error('PRIVATE response body')
    return demoSnapshot
  }) }
  expect(await startConnection(['labs'], { ...deps, provider: p })).toBe(success ? 'connected' : 'error')
  expect((await getConnection()).status).toBe(success ? 'connected' : 'error')
  expect((await getConnection()).lastError ?? '').not.toContain('PRIVATE')
})
it('runs demo orchestration through the actual provider against the captured contract', async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/connect/sessions') ? { id: 'demo-1', status: 'completed' } : demoFixture)))
  const p = createDemoProvider({ fetch })
  expect(await startConnection(['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'], { ...deps, provider: p })).toBe('connected')
  expect(await listRecords()).toHaveLength(12)
  expect(fetch).toHaveBeenCalledTimes(2)
})
it('clears every demo backup row before live creation, including missing categories in a partial snapshot', async () => {
  const fetch = vi.fn(async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url).endsWith('/connect/sessions') ? { id: 'demo-1', status: 'completed' } : demoFixture)))
  await startConnection([...RECORD_CATEGORIES], { ...deps, provider: createDemoProvider({ fetch }) })
  await applyImport(await collectExport())
  expect((await listRecords()).some(r => r.id.startsWith('demo:medications:'))).toBe(true)
  const p = provider([{ ...completed, grantedCategories: ['labs', 'medications'] }])
  vi.mocked(p.startConnect).mockImplementationOnce(async () => {
    expect((await getConnection()).mode).toBe('live')
    expect(await db.medicalRecords.count()).toBe(0)
    return { sessionId: id, redirectUrl: 'https://connect.test/s', completed: false, subject: null, expiresAt: null }
  })
  vi.mocked(p.fetchSnapshot).mockResolvedValue({ ...snapshot, syncStatus: 'partial', sync: { status: 'partial' }, grantedCategories: ['labs', 'medications'], missingCategories: ['medications'] })
  await startConnection(['labs', 'medications'], { ...deps, provider: p })
  await completePendingConnection(ret, { ...deps, provider: p })
  expect((await listRecords()).some(r => r.id.startsWith('demo:'))).toBe(false)
  expect(await listRecords('medications')).toEqual([])
  expect(await listRecords('labs')).toEqual(snapshot.records)
})
it('clears live cached rows even when the new demo connection fails', async () => {
  await ready()
  expect(await db.medicalRecords.count()).toBeGreaterThan(0)
  const p: RecordsProvider = { mode: 'demo', startConnect: vi.fn(async () => { throw new Error('Unavailable') }), getSession: vi.fn(), fetchSnapshot: vi.fn() }
  expect(await startConnection(['labs', 'medications'], { ...deps, provider: p })).toBe('error')
  expect(await getConnection()).toMatchObject({ mode: 'demo', status: 'error' })
  expect(await listRecords()).toEqual([])
})
it('makes no requests without consent or a nonempty category selection', async () => {
  const p = provider()
  expect(await startConnection([], { ...deps, provider: p })).toBe('error')
  await disconnectAndDelete()
  expect(await hasRecordsConsent()).toBe(false)
  expect(await startConnection(['labs'], { ...deps, provider: p })).toBe('error')
  await syncSnapshot({ ...deps, provider: p })
  expect(p.startConnect).not.toHaveBeenCalled()
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
  expect((await getConnection()).lastError).toBeUndefined()
})
it.each([
  { baseUrl: 'https://relay.test', token: null, tokenRelayBaseUrl: 'https://relay.test' },
  { baseUrl: 'https://relay.test', token: 'tok', tokenRelayBaseUrl: 'https://relay.test.evil' },
  { baseUrl: 'https://new-relay.test', token: 'tok', tokenRelayBaseUrl: 'https://new-relay.test' },
])('rejects stale or missing live credentials: %j', async relay => {
  const p = await ready()
  expect(() => providerFor({ ...awaitableConnection, relayBaseUrl: 'https://relay.test' }, relay)).toThrow()
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: relay.tokenRelayBaseUrl, token: relay.token }))
  if (relay.baseUrl) await setSetting(SK.recordsRelayUrl, relay.baseUrl)
  vi.mocked(p.fetchSnapshot).mockClear()
  await syncSnapshot({ ...deps, provider: p })
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
})
// Only used by the pure provider binding test above.
import { defaultConnection } from './store'
const awaitableConnection = { ...defaultConnection(), mode: 'live' as const }
it('partial refresh keeps missing medications byte-for-byte and complete empty clears labs', async () => {
  const med = { ...snapshot.records[0], id: 'live:medications:rec_000000000000000000000002', category: 'medications' as const, name: 'Med', dosage: null, frequency: null, status: 'active', startDate: null, endDate: null, prescriber: null, reason: null }
  const p = provider([{ ...completed, grantedCategories: ['labs', 'medications'] }])
  vi.mocked(p.fetchSnapshot).mockResolvedValue({ ...snapshot, records: [...snapshot.records, med], grantedCategories: ['labs', 'medications'], availableCategories: ['labs', 'medications'] })
  await ready(p)
  const old = await db.medicalRecords.get(med.id)
  vi.mocked(p.fetchSnapshot).mockResolvedValue({ ...snapshot, syncStatus: 'partial', sync: { status: 'partial' }, grantedCategories: ['labs', 'medications'], missingCategories: ['medications'] })
  await syncSnapshot({ ...deps, provider: p })
  expect(await db.medicalRecords.get(med.id)).toEqual(old)
  expect((await getConnection()).missingCategories).toEqual(['medications'])
  vi.mocked(p.fetchSnapshot).mockResolvedValue({ ...snapshot, records: [] })
  await syncSnapshot({ ...deps, provider: p })
  expect(await listRecords('labs')).toEqual([])
  expect(await db.medicalRecords.get(med.id)).toEqual(old)
})
it('not-started snapshots preserve rows and successful timestamps', async () => {
  const p = await ready()
  const before = await getConnection(), rows = await db.medicalRecords.toArray()
  vi.mocked(p.fetchSnapshot).mockResolvedValue({ ...snapshot, records: [], syncStatus: 'not_started', sync: { status: 'not_started' }, availableCategories: [], missingCategories: ['labs'] })
  const done = await syncSnapshot({ ...deps, provider: p })
  expect(await db.medicalRecords.toArray()).toEqual(rows)
  expect(done.lastSyncAt).toBe(before.lastSyncAt)
  expect(done.connectedAt).toBe(before.connectedAt)
  expect(done.syncStatus).toBe('not_started')
})
it('an empty narrowed grant never requests a snapshot', async () => {
  const p = provider([{ ...completed, grantedCategories: [] }])
  await startConnection(['labs'], { ...deps, provider: p })
  await completePendingConnection(ret, { ...deps, provider: p })
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
  expect((await getConnection()).recoveryAction).toBe('start-again')
})
it.each(['queued', 'syncing'] as const)('continues a completed session while sync is %s', async status => {
  const p = provider([{ ...completed, sync: { status } }, completed])
  await startConnection(['labs'], { ...deps, provider: p })
  await completePendingConnection(ret, { ...deps, provider: p })
  expect(p.getSession).toHaveBeenCalledTimes(2)
  expect(elapsed).toBe(2000)
})
it.each(['failed', 'reauthorization_required'] as const)('persists safe sync failure metadata for %s', async status => {
  const p = provider([{ ...completed, sync: { status }, failure: { code: 'PRIVATE CODE', message: 'PRIVATE BODY', retryable: false } }])
  await startConnection(['labs'], { ...deps, provider: p })
  const done = await completePendingConnection(ret, { ...deps, provider: p })
  expect(done.status).toBe('error')
  expect(done.recoveryAction).toBe('start-again')
  expect(done.pendingSession).toBeUndefined()
  expect(JSON.stringify(done)).not.toContain('PRIVATE')
  if (status === 'reauthorization_required') expect(done.lastError).toBe('Your provider needs you to sign in again. Start again to reconnect.')
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
})
it.each(['expired', 'canceled', 'failed', 'abandoned'] as const)('clears terminal %s sessions and starts a fresh attempt', async status => {
  const p = provider([{ ...completed, status }])
  await startConnection(['labs'], { ...deps, provider: p })
  const done = await completePendingConnection(ret, { ...deps, provider: p })
  expect(done.pendingSession).toBeUndefined()
  expect(done.creationAttempt).toBeUndefined()
  expect(done.recoveryAction).toBe('start-again')
  await startConnection(['labs'], { ...deps, provider: p, randomId: () => 'freshabcdefghijklmnop' })
  expect(vi.mocked(p.startConnect).mock.calls[1][0].externalId).toBe('freshabcdefghijklmnop')
})
it('honors successful and failed Retry-After within a bounded timeout and retains the pending session', async () => {
  const p = provider([{ ...completed, status: 'pending', retryAfterSeconds: 25 }])
  await startConnection(['labs'], { ...deps, provider: p })
  vi.mocked(p.getSession).mockRejectedValueOnce(new RecordsHttpError('PRIVATE', 429, 10, 'rate_limited'))
  const times: number[] = []
  const get = p.getSession
  p.getSession = vi.fn(async id => { times.push(elapsed); return get(id) })
  const done = await completePendingConnection(ret, { ...deps, provider: p })
  expect(times).toEqual([0, 10000, 35000])
  expect(elapsed).toBeLessThanOrEqual(60000)
  expect(done.pendingSession?.id).toBe(id)
  expect(done.recoveryAction).toBe('check-again')
  expect(p.fetchSnapshot).not.toHaveBeenCalled()
})
it('honors Retry-After before fetching a ready snapshot', async () => {
  const p = provider([{ ...completed, retryAfterSeconds: 5 }])
  await startConnection(['labs'], { ...deps, provider: p })
  vi.mocked(p.fetchSnapshot).mockImplementation(async () => { expect(elapsed).toBe(5000); return snapshot })
  await completePendingConnection(ret, { ...deps, provider: p })
})
it('does not adopt a replacement generation while an old completed return waits through Retry-After', async () => {
  const p = provider([{ ...completed, retryAfterSeconds: 5 }])
  await startConnection(['labs'], { ...deps, provider: p })
  const paused = deferred<void>(), release = deferred<void>()
  const old = completePendingConnection(ret, { ...deps, provider: p, sleep: () => { paused.resolve(); return release.promise } })
  await paused.promise
  vi.resetModules()
  const other = await import('./connect'), otherDb = (await import('../db/schema')).db
  const replacementId = 'cs_ffffffffffffffffffff'
  const replacement = provider([{ ...completed, id: replacementId, subject: 'u_fedcba9876543210', sync: { status: 'queued' } }])
  vi.mocked(replacement.startConnect).mockResolvedValue({ sessionId: replacementId, redirectUrl: 'https://connect.test/new', completed: false, subject: null, expiresAt: null })
  const queued = deferred<void>(), resumeQueued = deferred<void>()
  let pending: Promise<unknown> | undefined
  try {
    await other.cancelConnection()
    await other.startConnection(['labs'], { ...deps, provider: replacement, randomId: () => 'replacementabcdefghijklmnop' })
    pending = other.completePendingConnection(ret, { ...deps, provider: replacement, sleep: () => { queued.resolve(); return resumeQueued.promise } })
    await queued.promise
    const before = await getConnection()
    expect(before).toMatchObject({ status: 'pending', pendingSession: { id: replacementId }, subject: 'u_fedcba9876543210', sync: { status: 'queued' } })
    release.resolve()
    await old
    expect(p.fetchSnapshot).not.toHaveBeenCalled()
    expect(replacement.fetchSnapshot).not.toHaveBeenCalled()
    expect(await getConnection()).toEqual(before)
    expect(await listRecords()).toEqual([])
  } finally {
    release.resolve()
    await other.cancelConnection()
    resumeQueued.resolve()
    await Promise.all([old, pending])
    otherDb.close()
  }
})
it.each(['terminal failure', 'sync failure', 'network error', 'expired error', 'completed', 'queued'] as const)(
  'ignores a second tab’s delayed %s after the pending session is consumed', async outcome => {
    const p = provider()
    await startConnection(['labs'], { ...deps, provider: p })
    vi.resetModules()
    const other = await import('./connect'), otherDb = (await import('../db/schema')).db
    const delayed = provider(), entered = deferred<void>(), response = deferred<ConnectSessionState>()
    vi.mocked(delayed.getSession).mockImplementationOnce(() => { entered.resolve(); return response.promise })
    const late = other.completePendingConnection(ret, { ...deps, provider: delayed })
    try {
      await entered.promise
      await completePendingConnection(ret, { ...deps, provider: p })
      const before = await getConnection(), rows = await db.medicalRecords.toArray()
      expect(before.status).toBe('connected')
      expect(before.pendingSession).toBeUndefined()
      if (outcome === 'network error') response.reject(new Error('Delayed failure'))
      else if (outcome === 'expired error') response.reject(new RecordsHttpError('Expired', 410, null, 'expired'))
      else response.resolve({ ...completed,
        status: outcome === 'terminal failure' ? 'failed' : 'completed',
        sync: { status: outcome === 'sync failure' ? 'failed' : outcome === 'queued' ? 'queued' : 'complete' },
      })
      await late
      expect(await getConnection()).toEqual(before)
      expect(await db.medicalRecords.toArray()).toEqual(rows)
      expect(delayed.fetchSnapshot).not.toHaveBeenCalled()
    } finally {
      response.resolve(completed)
      await late
      otherDb.close()
    }
  },
)
it('retains cached subject and records on a snapshot failure with only safe copy', async () => {
  const p = await ready(), before = await db.medicalRecords.toArray()
  vi.mocked(p.fetchSnapshot).mockRejectedValue(new Error('PRIVATE STACK'))
  const done = await syncSnapshot({ ...deps, provider: p })
  expect(done).toMatchObject({ status: 'error', subject, recoveryAction: 'refresh' })
  expect(done.lastError).not.toContain('PRIVATE')
  expect(await db.medicalRecords.toArray()).toEqual(before)
})
it('sanitizes polling errors while preserving pending recovery', async () => {
  const p = provider()
  await startConnection(['labs'], { ...deps, provider: p })
  vi.mocked(p.getSession).mockRejectedValue(new Error('PRIVATE BODY'))
  const done = await completePendingConnection(ret, { ...deps, provider: p })
  expect(done).toMatchObject({ status: 'error', recoveryAction: 'check-again' })
  expect(done.pendingSession?.id).toBe(id)
  expect(done.lastError).not.toContain('PRIVATE')
})
it('retries ambiguous creation with exactly the same body and changes the attempt for new categories', async () => {
  const p = provider()
  vi.mocked(p.startConnect).mockRejectedValue(new Error('PRIVATE creation body'))
  await startConnection(['labs'], { ...deps, provider: p })
  const first = vi.mocked(p.startConnect).mock.calls[0][0]
  expect((await getConnection()).lastError ?? '').not.toContain('PRIVATE')
  await startConnection(['labs'], { ...deps, provider: p, randomId: () => 'newabcdefghijklmnop' })
  expect(vi.mocked(p.startConnect).mock.calls[1][0]).toEqual(first)
  await startConnection(['vitals'], { ...deps, provider: p, randomId: () => 'changedabcdefghijklmnop' })
  expect(vi.mocked(p.startConnect).mock.calls[2][0].externalId).toBe('changedabcdefghijklmnop')
  await setSetting(SK.recordsRelayUrl, 'https://relay-b.test')
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay-b.test', token: 'tok-B' }))
  await startConnection(['vitals'], { ...deps, provider: p, randomId: () => 'endpointabcdefghijklmnop' })
  expect(vi.mocked(p.startConnect).mock.calls[3][0].externalId).toBe('endpointabcdefghijklmnop')
})
it('deduplicates concurrent same-page refresh promises and requests', async () => {
  const p = await ready()
  vi.mocked(p.fetchSnapshot).mockClear()
  const first = syncSnapshot({ ...deps, provider: p }), second = syncSnapshot({ ...deps, provider: p })
  expect(first).toBe(second)
  await Promise.all([first, second])
  expect(p.fetchSnapshot).toHaveBeenCalledOnce()
})
for (const action of ['cancel', 'disconnect', 'wipe', 'revoke', 'relay-change'] as const) {
  it(`rejects a late fetch error after independent ${action}`, async () => {
    const p = await ready()
    let reject!: (e: Error) => void, entered!: () => void
    const waiting = new Promise<void>(r => { entered = r })
    vi.mocked(p.fetchSnapshot).mockImplementationOnce(() => { entered(); return new Promise((_, r) => { reject = r }) })
    const running = syncSnapshot({ ...deps, provider: p })
    await waiting
    const other = new PppDB()
    try {
      if (action === 'cancel') await cancelConnection()
      else if (action === 'disconnect') await disconnectAndDelete()
      else if (action === 'wipe') await wipeLocalData(() => {})
      else if (action === 'revoke') {
        const profile = (await other.healthProfiles.get('primary'))!
        await other.healthProfiles.put({ ...profile, privacy: { ...profile.privacy, consentLedger: [{ purpose: 'medical-records', state: 'declined', version: 1, decidedAt: '2026-09-12T00:00:00Z' }] } })
      } else await other.settings.put({ key: SK.recordsRelayUrl, value: 'https://new-relay.test' })
      const before = await getConnection()
      reject(new Error('PRIVATE late body'))
      await running
      expect(await getConnection()).toEqual(before)
      expect((await getConnection()).lastError).toBeUndefined()
      if (action === 'wipe' || action === 'disconnect') expect(await listRecords()).toEqual([])
    } finally { other.close() }
  })
}
it('wipe invalidates suspended sealing before waiting for the exclusive vault lock', async () => {
  const p = await ready()
  let release!: () => void, entered!: () => void
  const waiting = new Promise<void>(r => { entered = r }), held = new Promise<void>(r => { release = r })
  const seal = sealing.seal
  vi.spyOn(sealing, 'seal').mockImplementationOnce(async (...args) => { entered(); await held; return seal(...args) })
  const running = syncSnapshot({ ...deps, provider: p })
  await waiting
  const generation = (await getConnection()).generation
  const wiping = wipeLocalData(() => {})
  await vi.waitFor(async () => expect((await getConnection()).generation).toBeGreaterThan(generation))
  release()
  await Promise.all([running, wiping])
  expect(await listRecords()).toEqual([])
  expect((await getConnection()).lastError).toBeUndefined()
})
it('serializes independent-tab refreshes and skips work queued before a newer commit', async () => {
  const p = await ready()
  vi.mocked(p.fetchSnapshot).mockClear()
  let release!: (s: RecordsSnapshot) => void, entered!: () => void
  const waiting = new Promise<void>(r => { entered = r })
  vi.mocked(p.fetchSnapshot).mockImplementationOnce(() => { entered(); return new Promise(r => { release = r }) })
  const first = syncSnapshot({ ...deps, provider: p })
  await waiting
  vi.resetModules()
  const other = await import('./connect'), otherDb = await import('../db/schema')
  const p2 = provider()
  const second = other.syncSnapshot({ ...deps, provider: p2 })
  // Wait until the other client actually queues its generation lock.
  await new Promise(r => setTimeout(r, 30))
  release({ ...snapshot, records: snapshot.records.map(r => ({ ...r, name: 'Newer result' })) })
  try {
    await Promise.all([first, second])
    expect(p2.fetchSnapshot).not.toHaveBeenCalled()
    expect((await listRecords())[0]).toMatchObject({ name: 'Newer result' })
  } finally { otherDb.db.close() }
})
it('clips provider polling timeouts to the remaining overall budget', async () => {
  const p = provider([{ ...completed, status: 'pending', retryAfterSeconds: 59 }])
  const contexts: number[] = []
  p.withRequest = vi.fn(options => { contexts.push(options.timeoutMs!); return p })
  await startConnection(['labs'], { ...deps, provider: p })
  // A first pending response waits 59 seconds; only 1 second remains on the next poll.
  await completePendingConnection(ret, { ...deps, provider: p })
  expect(contexts).toContain(1000)
  expect((await getConnection()).recoveryAction).toBe('check-again')
})
it('times out an unresponsive poll with asynchronous fake timer advancement', async () => {
  const p = provider()
  await startConnection(['labs'], { ...deps, provider: p })
  let entered!: () => void
  const waiting = new Promise<void>(r => { entered = r })
  vi.mocked(p.getSession).mockImplementation(() => { entered(); return new Promise(() => {}) })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })
  const running = completePendingConnection(ret, { ...deps, provider: p, monotonicNow: () => Date.now() })
  await waiting
  await vi.advanceTimersByTimeAsync(10_000)
  const done = await running
  expect(done.recoveryAction).toBe('check-again')
  expect(done.pendingSession?.id).toBe(id)
  expect(vi.getTimerCount()).toBe(0)
})
