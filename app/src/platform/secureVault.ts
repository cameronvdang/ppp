import { open, seal, type SealedBlob } from '../crypto/sealed'
import { withSealingKey, withVaultLifecycle, destroyVaultStorage } from './keyStore'

export interface SecureVaultStatus {
  available: true
  persistence: 'indexeddb-webcrypto'
  hardwareBacked: false
  platform: 'web'
}

export const SECURE_SECRET_KEYS = {
  openAiApiKey: 'openai-api-key',
  anthropicApiKey: 'anthropic-api-key',
  recordsRelayToken: 'records-relay-token',
} as const

const DB_NAME = 'lunara-secrets'
const STORE = 'secrets'

function assertValidKey(key: string): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(key)) {
    throw new Error('Secret keys may only contain letters, numbers, dots, dashes, and underscores.')
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close()
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function secureVaultStatus(): Promise<SecureVaultStatus> {
  return { available: true, persistence: 'indexeddb-webcrypto', hardwareBacked: false, platform: 'web' }
}

export async function setSecureSecret(key: string, value: string, beforeWrite?: () => Promise<void>): Promise<void> {
  assertValidKey(key)
  if (typeof value !== 'string') throw new Error('Secret value must be a string.')
  await withSealingKey(async (sealingKey) => {
    await beforeWrite?.()
    const blob = await seal(sealingKey, value)
    await withStore('readwrite', (store) => store.put(blob, key))
  })
}

export async function getSecureSecret(key: string): Promise<string | null> {
  assertValidKey(key)
  return withSealingKey(async (sealingKey) => {
    const blob = await withStore<SealedBlob | undefined>('readonly', (store) => store.get(key))
    if (!blob) return null
    try { return await open<string>(sealingKey, blob) }
    catch { return null }
  })
}

export async function deleteSecureSecret(key: string): Promise<void> {
  assertValidKey(key)
  await withVaultLifecycle('shared', () => withStore('readwrite', (store) => store.delete(key)))
}

export async function clearSecureSecrets(): Promise<void> {
  await withVaultLifecycle('shared', () => withStore('readwrite', (store) => store.clear()))
}

/** Full wipe used by "Delete all data": secrets and the key that seals them. */
export async function destroySecureVault(clearAppData: () => Promise<void> = async () => {}): Promise<void> {
  await destroyVaultStorage(async () => {
    await clearAppData()
    await withStore('readwrite', (store) => store.clear())
  })
}

export function currentVaultPlatform(): SecureVaultStatus['platform'] {
  return 'web'
}
