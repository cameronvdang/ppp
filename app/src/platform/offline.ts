export interface OfflineReadiness {
  ready: boolean
  persisted: boolean | null
  online: boolean
}

export function isOnline(): boolean {
  return globalThis.navigator?.onLine ?? true
}

export function subscribeOnline(listener: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const online = () => listener(true)
  const offline = () => listener(false)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
  }
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try { return await globalThis.navigator?.storage?.persist?.() ?? null }
  catch { return null }
}

export async function storagePersisted(): Promise<boolean | null> {
  try { return await globalThis.navigator?.storage?.persisted?.() ?? null }
  catch { return null }
}

export async function offlineReadiness(): Promise<OfflineReadiness> {
  let ready = false
  try {
    ready = !!globalThis.navigator?.serviceWorker?.controller &&
      (await globalThis.caches?.keys() ?? []).some(key => key.includes('precache'))
  } catch { /* Storage may be unavailable in this browser. */ }
  return { ready, persisted: await storagePersisted(), online: isOnline() }
}

export class OfflineError extends Error {
  constructor() { super('You are offline. This needs a connection.') }
}

export function requireOnline(): void {
  if (!isOnline()) throw new OfflineError()
}
