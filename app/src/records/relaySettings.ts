/** All endpoint edits, imports and token saves share this lock across tabs. */
export async function withRelaySettings<T>(run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  return locks ? await locks.request('lunara-relay-settings', { mode: 'exclusive' }, run) : run()
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
