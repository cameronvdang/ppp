# PPP Offline-Ready PWA Plan (addendum, Tasks 18–19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user adds PPP to their home screen, everything except the explicitly online features (provider records, the AI assistant, backup upload, email reminders) works with no network at all, the app says so, and the browser is asked not to evict the data.

**Architecture:** The service worker already precaches the whole shell (all JS/CSS chunks, fonts, icons, splash images) and serves navigations from it; tracking data lives in IndexedDB. This plan adds: persistent-storage protection, an online-state module that the network features consult, an "Offline" status group in Settings that shows readiness, a precache-completeness test, and copy for offline states. **Spec:** section 14 of `docs/superpowers/specs/2026-09-11-ppp-rename-mobile-calendar-design.md`.

## Global Constraints

- Same constraints as the earlier PPP plans (scratch-clone commits with the trailer, no regressions, copy guard green, no jargon: never say "service worker", "cache", "IndexedDB" or "PWA" in UI text; say "downloaded", "works offline", "kept on this device").
- The worker must keep every network-only rule (FinchNode, relay, AI, backup, `/api`, `/v1`); nothing personal is ever cached.
- No new network destinations.

---

### Task 18: Persistent storage, online state, and offline-aware features

**Files:**
- Create: `app/src/platform/offline.ts`, `app/src/platform/offline.test.ts`
- Modify: `app/src/platform/runtime.ts`, `app/src/screens/Settings.tsx`, `app/src/screens/RecordsScreen.tsx`, `app/src/components/AssistantScreen.tsx`, `app/src/components/InstallCard.tsx`, `app/src/records/connect.ts` (precheck only), `app/src/lib/backup.ts` (precheck only), `app/src/styles/mobile.css`, `app/src/copyGuard.test.ts` (ban list gains `service worker`, `cache`, `precache` if not already present)

**Interfaces:**

```ts
// app/src/platform/offline.ts
export interface OfflineReadiness {
  /** The app can open with no network: a worker controls the page and the shell is stored. */
  ready: boolean
  /** The browser promised not to evict PPP's data; null when the API is unavailable. */
  persisted: boolean | null
  online: boolean
}
export function isOnline(): boolean                                  // navigator.onLine, true when undefined
export function subscribeOnline(listener: (online: boolean) => void): () => void   // window online/offline events
export async function requestPersistentStorage(): Promise<boolean | null>          // navigator.storage.persist(); null when unavailable
export async function storagePersisted(): Promise<boolean | null>
export async function offlineReadiness(): Promise<OfflineReadiness>
//   ready = !!navigator.serviceWorker?.controller && (await caches.keys()).some((k) => k.includes('precache'))
export class OfflineError extends Error { constructor() { super('You are offline. This needs a connection.') } }
export function requireOnline(): void                                // throws OfflineError when !isOnline()
```

Behaviour:
- `initializeRuntime()` calls `requestPersistentStorage()` once the profile is onboarded (read `SK.onboarded`); it is idempotent and never prompts on browsers that grant silently (Chrome grants installed apps; Safari has no API and returns null).
- Records connect/refresh, the AI send button, and backup upload call `requireOnline()` first and show "You are offline. This needs a connection." instead of a generic failure. The Records screen and the assistant show a one-line offline notice at the top while offline (`subscribeOnline`), and re-enable when back online.
- The InstallCard body becomes "Opens full screen and works offline. Everything stays on this phone."
- Settings gains an **Offline** group with two rows: "Works offline" → "Ready" / "Downloading" (readiness re-checked on mount and every 5 s until ready) and "Kept on this device" → "Yes" / "Not guaranteed" with a "Protect" button when persisted is false and the API exists; copy under the group: "Once downloaded, PPP opens without a connection. Only provider records, the assistant and backups need one."

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/platform/offline.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOnline, offlineReadiness, OfflineError, requestPersistentStorage, requireOnline, storagePersisted, subscribeOnline } from './offline'

afterEach(() => vi.unstubAllGlobals())

describe('online state', () => {
  it('treats a missing navigator.onLine as online and throws OfflineError when offline', () => {
    vi.stubGlobal('navigator', {})
    expect(isOnline()).toBe(true)
    expect(() => requireOnline()).not.toThrow()
    vi.stubGlobal('navigator', { onLine: false })
    expect(isOnline()).toBe(false)
    expect(() => requireOnline()).toThrow(OfflineError)
  })
  it('notifies subscribers on online and offline events and unsubscribes', () => {
    const handlers: Record<string, () => void> = {}
    vi.stubGlobal('window', { addEventListener: (n: string, f: () => void) => { handlers[n] = f }, removeEventListener: vi.fn() })
    vi.stubGlobal('navigator', { onLine: true })
    const seen: boolean[] = []
    const stop = subscribeOnline((o) => seen.push(o))
    handlers.offline(); handlers.online()
    expect(seen).toEqual([false, true])
    stop()
    expect((window as any).removeEventListener).toHaveBeenCalledTimes(2)
  })
})

describe('persistent storage', () => {
  it('returns null without the API and the browser answer with it', async () => {
    vi.stubGlobal('navigator', {})
    expect(await requestPersistentStorage()).toBeNull()
    expect(await storagePersisted()).toBeNull()
    vi.stubGlobal('navigator', { storage: { persist: vi.fn(async () => true), persisted: vi.fn(async () => true) } })
    expect(await requestPersistentStorage()).toBe(true)
    expect(await storagePersisted()).toBe(true)
  })
})

describe('offlineReadiness', () => {
  it('is ready only when a worker controls the page and the shell is stored', async () => {
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {} }, storage: { persisted: async () => false } })
    vi.stubGlobal('caches', { keys: async () => ['workbox-precache-v2-http://x/'] })
    expect(await offlineReadiness()).toEqual({ ready: true, persisted: false, online: true })
    vi.stubGlobal('navigator', { onLine: false, serviceWorker: { controller: null } })
    expect(await offlineReadiness()).toMatchObject({ ready: false, online: false, persisted: null })
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement `offline.ts`, wire the callers, run to verify it passes**

Run: `cd app && npx vitest run src/platform/offline.test.ts && npx tsc --noEmit && npx vitest run`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Protect stored data and make network features offline-aware"
```

### Task 19: Worker completeness and an offline build check

**Files:**
- Modify: `app/pwa.config.ts` (`globPatterns` adds `woff`; explicit `navigateFallback: 'index.html'`, `cleanupOutdatedCaches: true`, `clientsClaim: true`, `skipWaiting: true`; `maximumFileSizeToCacheInBytes: 3 * 1024 * 1024`), `app/pwa.config.test.ts`
- Also in `pwa.config.ts`: remove the `includeAssets` entries that the glob already covers (`icons/*.png`, `splash/*.png`), because the current manifest lists those ten files twice (43 entries for 33 unique URLs); `check-offline.mjs` compares unique URLs and fails on duplicates.
- Create: `app/scripts/check-offline.mjs`, `app/package.json` script `"check:offline": "node scripts/check-offline.mjs"`; call it from the build verification alongside `check:chunks`
- Modify: `README.md` ("Works offline" subsection under "Add to your home screen"), `docs/WEB_CAPABILITY_BOUNDARY.md`

`check-offline.mjs`: read `dist/sw.js`, extract the precache URLs, walk `dist/` and fail if any file other than `sw.js`, `workbox-*.js`, `_headers`, `*.map` is missing from the precache; fail if `index.html` is not the navigation fallback (`createHandlerBoundToURL`), if `NetworkOnly` is absent, or if `api.finchnode.com` is absent; print the counts on success.

- [ ] **Step 1: Extend `pwa.config.test.ts`**

```ts
it('precaches the whole shell and falls back to it for navigations', () => {
  expect(pwaOptions.workbox?.globPatterns?.[0]).toMatch(/woff2?/)
  expect(pwaOptions.workbox?.navigateFallback).toBe('index.html')
  expect(pwaOptions.workbox?.cleanupOutdatedCaches).toBe(true)
  expect(pwaOptions.workbox?.clientsClaim).toBe(true)
  expect(pwaOptions.workbox?.skipWaiting).toBe(true)
})
```

- [ ] **Step 2: Implement, build, run the check**

Run: `cd app && npx vitest run pwa.config.test.ts && npx vite build && node scripts/check-chunks.mjs && node scripts/check-offline.mjs` → "precache complete: N files".

- [ ] **Step 3: Docs and commit**

README: "Works offline. After the first visit, PPP opens with no connection. Your logs, phases, calendar files and reports all work offline. Provider records, the assistant and backups need a connection and say so."

```bash
git add -A
git commit -m "Precache the complete shell and verify offline readiness at build time"
```
