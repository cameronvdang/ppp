import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, setSetting, SK } from '../db/schema'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { SECURE_SECRET_KEYS, setSecureSecret } from '../platform/secureVault'
import { grantRecordsConsent, startConnection } from '../records/connect'
import { handleRecordsReturn, subscribeRecordsReturn } from './RecordsReturnHandler'
import { getConnection, listRecords } from '../records/store'
import type { ConnectSessionState, RecordsProvider, RecordsSnapshot } from '../records/providers/types'
const id = 'cs_0123456789abcdef0123'
const params = { isReturn: true, sessionId: null, invalidSession: false }
const snapshot: RecordsSnapshot = { records: [], skipped: 0, additionalItems: 0, synthetic: false, sync: { status: 'complete' }, syncStatus: 'complete', grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], sources: [], warnings: [], failure: null, consentReceiptIds: [] }
const completed: ConnectSessionState = { id, status: 'completed', subject: 'u_0123456789abcdef', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [], expiresAt: null }
beforeEach(async () => {
  installLifecycleLocks()
  for (const table of db.tables) await table.clear()
  vi.stubGlobal('location', { origin: 'https://app.test' })
  await setSetting(SK.recordsRelayUrl, 'https://relay.test')
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok' }))
  await grantRecordsConsent()
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('shares suspended completion across StrictMode cleanup/remount and rejects a later replay', async () => {
  let release!: (state: ConnectSessionState) => void, entered!: () => void
  const waiting = new Promise<void>(r => { entered = r })
  const provider: RecordsProvider = { mode: 'live', startConnect: vi.fn(async () => ({ sessionId: id, redirectUrl: 'https://connect.test/s', completed: false, expiresAt: null, subject: null })), getSession: vi.fn(() => { entered(); return new Promise<ConnectSessionState>(r => { release = r }) }), fetchSnapshot: vi.fn(async () => snapshot) }
  const deps = { provider, navigate: vi.fn() }
  await startConnection(['labs'], deps)
  let commits = 0
  const updated = (changes: any) => { if (changes.status === 'connected') commits++ }
  db.recordsConnection.hook('updating', updated)
  const oldView = vi.fn(), newView = vi.fn()
  try {
    const cleanup = subscribeRecordsReturn(params, oldView, deps)
    await waiting
    cleanup()
    const cleanupNew = subscribeRecordsReturn(params, newView, deps)
    const direct = handleRecordsReturn(params, deps)
    // Allow read-only validation to finish before the suspended poll resolves.
    await new Promise(r => setTimeout(r, 20))
    release(completed)
    await direct
    await vi.waitFor(() => expect(newView).toHaveBeenCalledWith(null))
    expect(oldView).not.toHaveBeenCalled()
    expect(provider.getSession).toHaveBeenCalledOnce()
    expect(provider.fetchSnapshot).toHaveBeenCalledOnce()
    expect(commits).toBe(1)
    expect(await listRecords()).toEqual([])
    expect((await getConnection()).status).toBe('connected')
    cleanupNew()
    await expect(handleRecordsReturn(params, deps)).rejects.toThrow('This link does not match a connection you started.')
    expect(provider.getSession).toHaveBeenCalledOnce()
  } finally { db.recordsConnection.hook('updating').unsubscribe(updated) }
})
it('invalid returns never invoke provider methods or write connection state', async () => {
  const provider: RecordsProvider = { mode: 'live', startConnect: vi.fn(), getSession: vi.fn(), fetchSnapshot: vi.fn() }
  const before = await getConnection()
  for (const invalid of [params, { ...params, invalidSession: true }, { ...params, sessionId: 'cs_ffffffffffffffffffff' }]) await expect(handleRecordsReturn(invalid, { provider })).rejects.toThrow(/does not match/)
  expect(await getConnection()).toEqual(before)
  expect(provider.getSession).not.toHaveBeenCalled()
  expect(provider.fetchSnapshot).not.toHaveBeenCalled()
})
