import { afterEach, expect, it, vi } from 'vitest'
import { isOnline, OfflineError, offlineReadiness, requestPersistentStorage, requireOnline, storagePersisted, subscribeOnline } from './offline'

afterEach(() => vi.unstubAllGlobals())

it('assumes a connection when the browser does not expose its status', () => {
  vi.stubGlobal('navigator', {})
  expect(isOnline()).toBe(true)
  expect(() => requireOnline()).not.toThrow()
})

it('rejects offline work with the exact user-facing error', () => {
  vi.stubGlobal('navigator', { onLine: false })
  expect(isOnline()).toBe(false)
  expect(() => requireOnline()).toThrow(OfflineError)
  expect(() => requireOnline()).toThrow('You are offline. This needs a connection.')
})

it('reports both connectivity events and removes both listeners', () => {
  const handlers: Record<string, () => void> = {}
  const removeEventListener = vi.fn()
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('window', { addEventListener: (name: string, handler: () => void) => { handlers[name] = handler }, removeEventListener })
  const seen: boolean[] = []
  const unsubscribe = subscribeOnline(online => seen.push(online))
  handlers.offline()
  handlers.online()
  expect(seen).toEqual([false, true])
  unsubscribe()
  expect(removeEventListener.mock.calls).toEqual([['online', handlers.online], ['offline', handlers.offline]])
})

it('returns unknown when persistent storage is unsupported', async () => {
  vi.stubGlobal('navigator', {})
  expect(await requestPersistentStorage()).toBeNull()
  expect(await storagePersisted()).toBeNull()
})

it('requests and reads browser persistence with the proper receiver', async () => {
  const storage = { persist: async function () { expect(this).toBe(storage); return true }, persisted: async function () { expect(this).toBe(storage); return true } }
  vi.stubGlobal('navigator', { storage })
  expect(await requestPersistentStorage()).toBe(true)
  expect(await storagePersisted()).toBe(true)
})

it('reports ready only when controlled and downloaded', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} }, storage: { persisted: async () => false } })
  vi.stubGlobal('caches', { keys: async () => ['workbox-precache-v2-http://x/'] })
  expect(await offlineReadiness()).toEqual({ ready: true, persisted: false, online: true })
  vi.stubGlobal('navigator', { serviceWorker: { controller: null }, onLine: false })
  expect(await offlineReadiness()).toEqual({ ready: false, persisted: null, online: false })
})

it('keeps readiness false for unrelated downloads', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} } })
  vi.stubGlobal('caches', { keys: async () => ['other-downloads'] })
  expect((await offlineReadiness()).ready).toBe(false)
})

it('handles unavailable and rejected browser storage without failing startup', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} }, storage: { persist: async () => { throw new Error('denied') }, persisted: async () => { throw new Error('denied') } } })
  vi.stubGlobal('caches', { keys: async () => { throw new Error('denied') } })
  expect(await requestPersistentStorage()).toBeNull()
  expect(await storagePersisted()).toBeNull()
  expect(await offlineReadiness()).toEqual({ ready: false, persisted: null, online: true })
  vi.stubGlobal('navigator', undefined)
  vi.stubGlobal('caches', undefined)
  expect(await offlineReadiness()).toEqual({ ready: false, persisted: null, online: true })
})
