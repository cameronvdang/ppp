/** All endpoint edits, imports and token saves share this lock across tabs. */
export async function withRelaySettings<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  return locks ? await locks.request('ppp-relay-settings', { mode: 'exclusive' }, run) : run()
}

import { getSetting, SK } from '../db/schema'
import { getSecureSecret, SECURE_SECRET_KEYS } from '../platform/secureVault'
import { canonicalizeRelayUrl } from './providers/relay'
import { object } from './normalize/fields'
export interface RelaySettings { baseUrl: string | null; token: string | null; tokenRelayBaseUrl: string | null }
export async function loadRelaySettings(): Promise<RelaySettings> {
  const saved = await getSetting(SK.recordsRelayUrl)
  const baseUrl = saved ? canonicalizeRelayUrl(saved) : null
  let token: string | null = null, tokenRelayBaseUrl: string | null = null
  try {
    const envelope = object(JSON.parse(await getSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken) ?? 'null'))
    if (typeof envelope.token === 'string' && envelope.token.trim() && envelope.relayBaseUrl === baseUrl) {
      token = envelope.token; tokenRelayBaseUrl = baseUrl
    }
  } catch { /* Unreadable or invalid bindings are not live credentials. */ }
  if ((await getSetting(SK.recordsRelayUrl)) !== saved) return { baseUrl: null, token: null, tokenRelayBaseUrl: null }
  return { baseUrl, token, tokenRelayBaseUrl }
}

import { db } from '../db/schema'
import { deleteSecureSecret, setSecureSecret } from '../platform/secureVault'
import { abortRecordsWork, getConnection, recordsTransaction, transitionConnection } from './store'
export async function saveRelayUrl(input: string): Promise<string | null> {
  const next = input.trim() ? canonicalizeRelayUrl(input.trim()) : null
  return withRelaySettings(async () => {
    let changed = false, invalidated = false
    await recordsTransaction(async () => {
      const saved = await getSetting(SK.recordsRelayUrl)
      const old = saved ? canonicalizeRelayUrl(saved) : null
      changed = old !== next
      if (next) await db.settings.put({ key: SK.recordsRelayUrl, value: next })
      else await db.settings.delete(SK.recordsRelayUrl)
      if (changed && (await getConnection()).mode === 'live') {
        await transitionConnection(c => {
          const { pendingSession: _, creationAttempt: __, ...rest } = c
          return { ...rest, status: 'disconnected', lastError: undefined, recoveryAction: undefined }
        })
        invalidated = true
      }
    })
    if (invalidated) abortRecordsWork()
    if (changed) {
      try { await deleteSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken) }
      catch { throw new Error('The relay URL changed, but the old token could not be removed. Your live connection is disabled. Save a new token for this URL before connecting.') }
    }
    return next
  })
}
export async function saveRelayToken(expectedUrl: string, token: string): Promise<void> {
  const baseUrl = canonicalizeRelayUrl(expectedUrl)
  if (!token.trim()) throw new Error('Enter the required relay token.')
  await withRelaySettings(async () => {
    await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: baseUrl, token: token.trim() }), async () => {
      // Runs after the shared lifecycle lock is acquired, so a queued wipe cannot
      // clear the endpoint between validation and this credential write.
      const saved = await getSetting(SK.recordsRelayUrl)
      if (!saved || canonicalizeRelayUrl(saved) !== baseUrl) throw new Error('The relay URL changed in another tab. Review the saved URL before saving its token.')
    })
  })
}
