import 'fake-indexeddb/auto'
import { installLifecycleLocks } from './__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, seal } from '../crypto/sealed'
import * as keyStore from './keyStore'
import { deleteKeyStore, getSealingKey } from './keyStore'

const clients = new Set([keyStore])

async function independentClients() {
  vi.resetModules()
  const first = await import('./keyStore')
  clients.add(first)
  vi.resetModules()
  const second = await import('./keyStore')
  clients.add(second)
  return [first, second] as const
}

describe('keyStore', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await deleteKeyStore()
  })

  it('creates one non-extractable key and returns the same key afterwards', async () => {
    const first = await getSealingKey()
    const second = await getSealingKey()
    expect(first.extractable).toBe(false)
    expect(second).toBe(first)
    const blob = await seal(first, 'v')
    expect(await open(second, blob)).toBe('v')
  })

  it('persists the key across module memo reset', async () => {
    const key = await getSealingKey()
    const blob = await seal(key, 'persist')
    // Simulate a reload: clear the in-memory memo but keep IndexedDB.
    const mod = await import('./keyStore')
    clients.add(mod)
    mod.__resetMemoForTests()
    const again = await mod.getSealingKey()
    expect(again.extractable).toBe(false)
    expect(await open(again, blob)).toBe('persist')
  })

  it('deleteKeyStore makes old blobs unreadable', async () => {
    const blob = await seal(await getSealingKey(), 'gone')
    await deleteKeyStore()
    await expect(open(await getSealingKey(), blob)).rejects.toThrow()
  })

  it('uses the persisted winner when independent clients create a key concurrently', async () => {
    const [first, second] = await independentClients()
    expect(first).not.toBe(second)
    const [firstKey, secondKey] = await Promise.all([
      first.getSealingKey(),
      second.getSealingKey(),
    ])
    const blobs = await Promise.all([
      seal(firstKey, 'first client'),
      seal(secondKey, 'second client'),
    ])

    first.__resetMemoForTests()
    second.__resetMemoForTests()
    const persistedKeys = await Promise.all([first.getSealingKey(), second.getSealingKey()])
    for (const key of persistedKeys) {
      expect(key.extractable).toBe(false)
      expect(await open(key, blobs[0])).toBe('first client')
      expect(await open(key, blobs[1])).toBe('second client')
    }
  })

  it('rejects blocked deletion across independent clients without ever reporting success', async () => {
    const [first, second] = await independentClients()
    await first.getSealingKey()
    await second.getSealingKey()
    const raw = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(first.KEY_DB_NAME)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    // This deliberately uncooperative tab keeps deletion blocked.
    raw.onversionchange = () => {}
    const originalDelete = indexedDB.deleteDatabase.bind(indexedDB)
    let deletionCompleted: Promise<void> | undefined
    vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name) => {
      const req = originalDelete(name)
      deletionCompleted = new Promise<void>((resolve, reject) => {
        req.addEventListener('success', () => resolve())
        req.addEventListener('error', () => reject(req.error))
      })
      return req
    })
    const reportedSuccess = vi.fn()

    try {
      const deleting = second.deleteKeyStore()
      void deleting.then(reportedSuccess, () => {})
      await expect(deleting).rejects.toThrow('Close other PPP tabs and try again.')
      expect(reportedSuccess).not.toHaveBeenCalled()
      expect(deletionCompleted).toBeDefined()
    } finally {
      raw.close()
      // A rejected blocked request still completes after the raw handle closes.
      await deletionCompleted
    }
    expect(reportedSuccess).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  for (const client of clients) client.__resetMemoForTests()
  clients.clear()
  clients.add(keyStore)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
