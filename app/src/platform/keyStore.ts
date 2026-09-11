import { generateSealingKey } from '../crypto/sealed'

export const KEY_DB_NAME = 'lunara-keys'
const STORE = 'keys'
const MAIN_KEY = 'sealing-v1'

let memo: Promise<CryptoKey> | null = null
const handles = new Set<IDBDatabase>()

export async function withVaultLifecycle<T>(mode: 'shared' | 'exclusive', run: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks) return run() // older Safari: uncoordinated but functional
  return locks.request('lunara-vault-lifecycle', { mode }, run)
}

export function withSealingKey<T>(run: (key: CryptoKey) => Promise<T>): Promise<T> {
  return withVaultLifecycle('shared', async () => run(await getSealingKey()))
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => {
      const db = req.result
      db.onversionchange = () => { memo = null; db.close(); handles.delete(db) }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

async function loadOrCreate(): Promise<CryptoKey> {
  // Candidate creation must not suspend an IndexedDB transaction.
  const candidate = await generateSealingKey()
  const db = await openDb()
  // Keep the memo's handle open so another tab's destruction invalidates it.
  handles.add(db)
  return new Promise<CryptoKey>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const read = store.get(MAIN_KEY)
    let winner: CryptoKey
    read.onsuccess = () => {
      winner = read.result ?? candidate
      if (!read.result) store.add(candidate, MAIN_KEY)
    }
    tx.oncomplete = () => resolve(winner)
    tx.onerror = tx.onabort = () => { db.close(); handles.delete(db); reject(tx.error) }
  })
}

/** The browser-managed sealing key. Never leaves IndexedDB as bytes. */
export function getSealingKey(): Promise<CryptoKey> {
  memo ??= loadOrCreate().catch((error) => {
    memo = null
    throw error
  })
  return memo
}

export function destroyVaultStorage(beforeDelete: () => Promise<void>): Promise<void> {
  return withVaultLifecycle('exclusive', async () => {
    memo = null
    for (const db of handles) db.close()
    handles.clear()
    // Other clients close and drop their memo on versionchange.
    await beforeDelete()
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(KEY_DB_NAME)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
      req.addEventListener('blocked', () => reject(new Error('Close other Lunara tabs and try again.')))
    })
  })
}

export function deleteKeyStore(): Promise<void> {
  return destroyVaultStorage(async () => {})
}

/** Test-only: forget the memoized key without touching IndexedDB. */
export function __resetMemoForTests(): void {
  memo = null
  for (const db of handles) db.close()
  handles.clear()
}
