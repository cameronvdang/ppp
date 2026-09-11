import 'fake-indexeddb/auto'
import { installLifecycleLocks } from './__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, type SealedBlob } from '../crypto/sealed'
import * as keyStore from './keyStore'
import {
  SECURE_SECRET_KEYS,
  clearSecureSecrets,
  currentVaultPlatform,
  deleteSecureSecret,
  destroySecureVault,
  getSecureSecret,
  secureVaultStatus,
  setSecureSecret,
} from './secureVault'

const clients = new Set([keyStore])

async function independentClients() {
  vi.resetModules()
  const firstKeys = await import('./keyStore')
  const firstVault = await import('./secureVault')
  clients.add(firstKeys)
  vi.resetModules()
  const secondKeys = await import('./keyStore')
  const secondVault = await import('./secureVault')
  clients.add(secondKeys)
  return [
    { keys: firstKeys, vault: firstVault },
    { keys: secondKeys, vault: secondVault },
  ] as const
}

function readStoredSecret(key: string): Promise<SealedBlob | undefined> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ppp-secrets', 1)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('secrets')
      const get = tx.objectStore('secrets').get(key)
      tx.oncomplete = () => { db.close(); resolve(get.result) }
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  })
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('web secure vault', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await destroySecureVault()
  })

  it('reports browser-managed persistence honestly', async () => {
    expect(await secureVaultStatus()).toEqual({
      available: true,
      persistence: 'indexeddb-webcrypto',
      hardwareBacked: false,
      platform: 'web',
    })
    expect(currentVaultPlatform()).toBe('web')
    expect(SECURE_SECRET_KEYS).toEqual({
      openAiApiKey: 'openai-api-key',
      anthropicApiKey: 'anthropic-api-key',
      recordsRelayToken: 'records-relay-token',
    })
  })

  it('stores, reads, deletes and clears secrets', async () => {
    await setSecureSecret('openai-api-key', 'sk-test')
    expect(await getSecureSecret('openai-api-key')).toBe('sk-test')
    await deleteSecureSecret('openai-api-key')
    expect(await getSecureSecret('openai-api-key')).toBeNull()
    await setSecureSecret('a', '1')
    await setSecureSecret('b', '2')
    await clearSecureSecrets()
    expect(await getSecureSecret('a')).toBeNull()
    expect(await getSecureSecret('b')).toBeNull()
  })

  it('rejects malformed keys', async () => {
    for (const key of ['bad key!', '', 'a'.repeat(129)]) {
      await expect(setSecureSecret(key, 'x')).rejects.toThrow(/letters, numbers/)
      await expect(getSecureSecret(key)).rejects.toThrow(/letters, numbers/)
      await expect(deleteSecureSecret(key)).rejects.toThrow(/letters, numbers/)
    }
  })

  it('rejects non-string values', async () => {
    await expect(setSecureSecret('a', 42 as unknown as string)).rejects.toThrow('Secret value must be a string.')
  })

  it('does not store plaintext in IndexedDB', async () => {
    await setSecureSecret('anthropic-api-key', 'sk-ant-visible')
    const raw = await readStoredSecret('anthropic-api-key')
    expect(raw).toEqual({ v: 1, iv: expect.any(String), data: expect.any(String) })
    expect(JSON.stringify(raw)).not.toContain('sk-ant-visible')
  })

  it('waits for an independent client sealing a write, then clears its ciphertext and both key memos', async () => {
    const [first, second] = await independentClients()
    expect(first.keys).not.toBe(second.keys)
    expect(first.vault).not.toBe(second.vault)
    const oldKeys = await Promise.all([
      first.keys.withSealingKey(async (key) => key),
      second.keys.withSealingKey(async (key) => key),
    ])
    await first.vault.setSecureSecret('existing', 'before destruction')
    const oldBlob = (await readStoredSecret('existing'))!
    expect(await second.vault.getSecureSecret('existing')).toBe('before destruction')

    const sealingStarted = deferred()
    const resumeSealing = deferred()
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle)
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      sealingStarted.resolve()
      await resumeSealing.promise
      return encrypt(...args)
    })
    const writing = first.vault.setSecureSecret('pending', 'suspended write')
    await sealingStarted.promise

    const clearAppData = vi.fn(async () => {
      const pending = (await readStoredSecret('pending'))!
      expect(await open(oldKeys[0], pending)).toBe('suspended write')
    })
    const requests = vi.spyOn(navigator.locks, 'request')
    const destroyed = vi.fn()
    const destroying = second.vault.destroySecureVault(clearAppData)
    void destroying.then(destroyed, () => {})

    try {
      expect(requests).toHaveBeenCalledWith(
        'ppp-vault-lifecycle', { mode: 'exclusive' }, expect.any(Function),
      )
      // Drain the microtask queue while the shared encryption is suspended.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(clearAppData).not.toHaveBeenCalled()
      expect(destroyed).not.toHaveBeenCalled()
      expect(await readStoredSecret('pending')).toBeUndefined()
    } finally {
      resumeSealing.resolve()
      await Promise.all([writing, destroying])
    }

    expect(clearAppData).toHaveBeenCalledOnce()
    expect(destroyed).toHaveBeenCalledOnce()
    expect(await readStoredSecret('existing')).toBeUndefined()
    expect(await readStoredSecret('pending')).toBeUndefined()
    // Do not reset either memo: destruction must invalidate them across clients.
    const newKeys = await Promise.all([
      first.keys.withSealingKey(async (key) => key),
      second.keys.withSealingKey(async (key) => key),
    ])
    for (const [index, key] of newKeys.entries()) {
      expect(key).not.toBe(oldKeys[index])
      await expect(open(key, oldBlob)).rejects.toThrow()
    }
    await first.vault.setSecureSecret('fresh', 'after destruction')
    expect(await second.vault.getSecureSecret('fresh')).toBe('after destruction')
  })
})

afterEach(() => {
  for (const client of clients) client.__resetMemoForTests()
  clients.clear()
  clients.add(keyStore)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
