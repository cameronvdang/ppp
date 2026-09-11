# Lunara Web + FinchNode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Lunara fork into a browser-first, privacy-first web app with Aileron + baby pink/red styling and FinchNode medical-records import.

**Architecture:** The React/Vite/Dexie product layer stays. `src/native/*` (Capacitor bridges) is replaced by `src/platform/*` web adapters with the same exported names. A new `src/records/*` module talks to FinchNode's demo API directly or to a self-hosted relay Worker, normalizes records into one model, and stores them sealed in Dexie. A PWA service worker precaches the shell only.

**Tech Stack:** React 18, Vite 6, TypeScript 5.9.3, Dexie 4, zustand 5, vitest 2, `@fontsource/aileron`, `vite-plugin-pwa` ^1.3, `fake-indexeddb` ^6.2 (tests), Cloudflare Workers (wrangler 3) for the relay.

**Spec:** `docs/superpowers/specs/2026-09-10-lunara-web-finchnode-design.md`

## Global Constraints

- Node 24 / pnpm 9 workspace. Run app commands as `pnpm --filter @lunara/app <script>` from the repo root, or from `app/`.
- Baseline must never regress: `pnpm --filter @lunara/app test` (existing behavior tests pass; estimate audit at zero violations), `npx tsc --noEmit` in `app/`, `npx vite build` in `app/`.
- Vitest runs in `environment: 'node'`; tests that need IndexedDB import `'fake-indexeddb/auto'` at the top; tests that need `window`/`navigator` use `vi.stubGlobal` and restore with `vi.unstubAllGlobals()` in `afterEach`; advance asynchronous timer paths with `await vi.advanceTimersByTimeAsync(...)`.
- Exported function names in `src/platform/*` must match the old `src/native/*` names listed in spec A1 so call sites change only their import path.
- No new network destinations beyond spec section 8. No analytics, no CDN scripts, no cookies.
- Never cache FinchNode, relay, AI, backup or same-origin API traffic in the service worker; test the emitted worker as well as serialized callbacks.
- Live v1 is single-owner with a dedicated FinchNode application and a required high-entropy relay token. Secrets go in Wrangler secrets, never vars. Missing config → 503; missing/wrong token → 401 before upstream calls.
- Canonical relay URL bindings, nonempty category boundaries, consent and a persisted connection generation guard every network operation and asynchronous commit. Generation checks happen inside the same Dexie transaction as writes and cover all tabs; do not add BroadcastChannel.
- Medical-record bodies and vault secrets are sealed; indexes, connection metadata, existing logs and profiles remain plaintext. Exports contain opened records and canonical profile/regimen/adherence tables, with all security settings excluded.
- FinchNode API keys never appear in browser code, tests, or docs (use `ck_test_placeholder` in examples).
- Copy style: plain sentences, no exclamation marks, no medical claims. Records copy always says "from your provider", never "diagnosis".
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Baby pink = `#F4C2C2` family, baby red = `#F08080` family, exact scales in spec B2.

---

## File structure

```
app/
  package.json                      remove @capacitor/*, native scripts; add @fontsource/aileron, vite-plugin-pwa, fake-indexeddb
  vite.config.ts                    add VitePWA(pwaOptions)
  pwa.config.ts                     NEW exported pwaOptions (testable)
  index.html                        theme-color, manifest link handled by plugin
  public/_headers                   NEW CSP + privacy headers
  src/main.tsx                      font imports, initializeRuntime, records return handoff
  src/App.tsx                       drop Capacitor listeners; add Records tab + return handler
  src/crypto/sealed.ts              NEW key-based AES-GCM seal/open
  src/platform/keyStore.ts          NEW non-extractable CryptoKey in IndexedDB `lunara-keys`
  src/platform/secureVault.ts       NEW (replaces native/secureVault.ts)
  src/platform/deviceUnlock.ts      NEW (replaces native/biometrics.ts)
  src/platform/notifications.ts     NEW in-session reminders (replaces native/notifications.ts)
  src/platform/runtime.ts           NEW (replaces native/runtime.ts)
  src/platform/reportExport.ts      MOVED from native/, tests moved too
  src/lib/healthImport.ts           MOVED pure functions from native/healthImport.ts
  src/records/types.ts              NEW model
  src/records/categories.ts         NEW constants + labels
  src/records/normalize/fhir.ts     NEW
  src/records/normalize/finchnode.ts NEW
  src/records/providers/types.ts    NEW RecordsProvider interface
  src/records/providers/demo.ts     NEW
  src/records/providers/relay.ts    NEW
  src/records/store.ts              NEW Dexie access, sealing
  src/records/connect.ts            NEW orchestration
  src/records/returnHandler.ts      NEW URL param handling
  src/records/__fixtures__/         NEW demo-records.json, finchnode-health-record.json
  src/screens/RecordsScreen.tsx     NEW
  src/components/RecordsCategoryList.tsx NEW
  src/components/PrivacyTable.tsx   NEW shared by Settings + PRIVACY.md content
  src/styles/tokens.css             palette + fonts rewrite
  src/styles/tokens.test.ts         NEW contrast test
  src/styles/desktop.css            NEW ≥900px layout
  src/styles/records.css            NEW
workers/records-relay/              NEW Worker (src/index.js, src/index.test.js, wrangler.toml, README.md, package.json)
PRIVACY.md                          NEW
README.md                           rewritten for web
docs/WEB_CAPABILITY_BOUNDARY.md     NEW replaces LOCAL_CAPABILITY_BOUNDARY.md
```

---

# Phase 1: Web-first platform

### Task 1: Key-based sealing primitive

**Files:**
- Create: `app/src/crypto/sealed.ts`
- Test: `app/src/crypto/sealed.test.ts`

**Interfaces:**
- Produces: `interface SealedBlob { v: 1; iv: string; data: string }`, `seal(key: CryptoKey, payload: unknown): Promise<SealedBlob>`, `open<T>(key: CryptoKey, blob: SealedBlob): Promise<T>`, `generateSealingKey(): Promise<CryptoKey>` (AES-GCM 256, non-extractable).

- [ ] **Step 1: Write the failing test**

```ts
// app/src/crypto/sealed.test.ts
import { describe, expect, it } from 'vitest'
import { generateSealingKey, open, seal } from './sealed'

describe('sealed', () => {
  it('round-trips JSON under a non-extractable AES-GCM key', async () => {
    const key = await generateSealingKey()
    expect(key.extractable).toBe(false)
    const blob = await seal(key, { hello: 'world', n: 2 })
    expect(blob.v).toBe(1)
    expect(blob.iv).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(blob.data).not.toContain('hello')
    expect(await open(key, blob)).toEqual({ hello: 'world', n: 2 })
  })

  it('uses a fresh IV per call', async () => {
    const key = await generateSealingKey()
    const a = await seal(key, 'x')
    const b = await seal(key, 'x')
    expect(a.iv).not.toBe(b.iv)
  })

  it('rejects a blob sealed under another key', async () => {
    const blob = await seal(await generateSealingKey(), 'secret')
    await expect(open(await generateSealingKey(), blob)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/crypto/sealed.test.ts`
Expected: FAIL, cannot resolve `./sealed`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/crypto/sealed.ts
/**
 * Key-based AES-256-GCM sealing for data at rest. The sibling of the
 * passphrase-based encryptJSON in vault.ts: no KDF, because the key is a
 * non-extractable CryptoKey managed by platform/keyStore.ts.
 */
export interface SealedBlob {
  v: 1
  iv: string // base64
  data: string // base64 ciphertext
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export function generateSealingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function seal(key: CryptoKey, payload: unknown): Promise<SealedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(payload))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { v: 1, iv: toB64(iv), data: toB64(data) }
}

export async function open<T>(key: CryptoKey, blob: SealedBlob): Promise<T> {
  if (blob.v !== 1) throw new Error('Unsupported sealed blob version.')
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource },
    key,
    fromB64(blob.data) as BufferSource,
  )
  return JSON.parse(new TextDecoder().decode(plain)) as T
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/crypto/sealed.test.ts`
Expected: all stated behaviors pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/crypto/sealed.ts app/src/crypto/sealed.test.ts
git commit -m "Add key-based AES-GCM sealing primitive"
```

### Task 2: Browser key store

**Files:**
- Create: `app/src/platform/keyStore.ts`
- Test: `app/src/platform/keyStore.test.ts`
- Create: `app/src/platform/__tests__/lifecycleLocks.ts` (test-only shared LockManager)
- Modify: `app/package.json` (devDependency `fake-indexeddb: ^6.2.5`)

**Interfaces:**
- Consumes: `generateSealingKey` from Task 1.
- Produces: `getSealingKey(): Promise<CryptoKey>` (creates on first call, memoized per page), `deleteKeyStore(): Promise<void>` (deletes the whole `lunara-keys` database and clears the memo), `KEY_DB_NAME = 'lunara-keys'`, `withVaultLifecycle<T>(mode: 'shared' | 'exclusive', run: () => Promise<T>): Promise<T>`, `withSealingKey<T>(run: (key: CryptoKey) => Promise<T>): Promise<T>`, `destroyVaultStorage(beforeDelete: () => Promise<void>): Promise<void>`. Shared/exclusive Web Locks named `lunara-vault-lifecycle` serialize destruction against all vault/record sealing and commits across tabs. Tests install a shared in-memory LockManager using `vi.stubGlobal('navigator', { locks })`; independent clients must share it. If `navigator.locks` is unavailable (older Safari), `withVaultLifecycle` runs `run()` uncoordinated: the insert-if-absent transaction still prevents duplicate keys, and only destruction-during-seal loses coordination.

- [ ] **Step 1: Add fake-indexeddb**

Run: `cd app && pnpm add -D fake-indexeddb@^6.2.5`

- [ ] **Step 2: Write the failing test**

First create the shared test lock helper. All independent module clients in a test use the same manager; it allows parallel shared holders but waits for them before an exclusive request. Restore globals after each test.

```ts
// app/src/platform/__tests__/lifecycleLocks.ts
import { vi } from 'vitest'

export function installLifecycleLocks(): void {
  type Job = { mode: 'shared' | 'exclusive'; start(): void }
  const names = new Map<string, { active: number; exclusive: boolean; jobs: Job[] }>()
  const locks = {
    request<T>(name: string, options: { mode: 'shared' | 'exclusive' }, run: () => Promise<T>): Promise<T> {
      const state = names.get(name) ?? { active: 0, exclusive: false, jobs: [] }
      names.set(name, state)
      const pump = () => {
        while (state.jobs.length && !state.exclusive) {
          const next = state.jobs[0]
          if (next.mode === 'exclusive' && state.active > 0) break
          state.jobs.shift()
          state.active += 1
          state.exclusive = next.mode === 'exclusive'
          next.start()
        }
      }
      return new Promise<T>((resolve, reject) => {
        state.jobs.push({ mode: options.mode, start: () => {
          Promise.resolve().then(run).then(resolve, reject).finally(() => {
            state.active -= 1
            state.exclusive = false
            pump()
          })
        } })
        pump()
      })
    },
  }
  vi.stubGlobal('navigator', { ...globalThis.navigator, locks })
}
```

```ts
// app/src/platform/keyStore.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from './__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { open, seal } from '../crypto/sealed'
import { deleteKeyStore, getSealingKey } from './keyStore'

describe('keyStore', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await deleteKeyStore()
  })

  it('creates one non-extractable key and returns the same key afterwards', async () => {
    const first = await getSealingKey()
    const second = await getSealingKey()
    expect(first.extractable).toBe(false)
    const blob = await seal(first, 'v')
    expect(await open(second, blob)).toBe('v')
  })

  it('persists the key across module memo reset', async () => {
    const key = await getSealingKey()
    const blob = await seal(key, 'persist')
    // Simulate a reload: clear the in-memory memo but keep IndexedDB.
    const mod = await import('./keyStore')
    mod.__resetMemoForTests()
    const again = await mod.getSealingKey()
    expect(await open(again, blob)).toBe('persist')
  })

  it('deleteKeyStore makes old blobs unreadable', async () => {
    const blob = await seal(await getSealingKey(), 'gone')
    await deleteKeyStore()
    await expect(open(await getSealingKey(), blob)).rejects.toThrow()
  })
})

afterEach(() => vi.unstubAllGlobals())

```

Add two independent-client tests (use `vi.resetModules()` between dynamic imports, retaining both module references, and the shared test LockManager). Start both `getSealingKey()` calls concurrently, seal with either result, reset both memos and verify both ciphertexts open with the persisted winner. For blocked deletion, keep a raw `indexedDB.open(KEY_DB_NAME)` handle that deliberately ignores versionchange; assert `deleteKeyStore()` rejects with "Close other Lunara tabs and try again." and never reports success. Close that raw handle and await the deletion request's eventual completion before cleanup. Reset module memos and restore globals in `afterEach`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd app && npx vitest run src/platform/keyStore.test.ts`
Expected: FAIL, cannot resolve `./keyStore`.

- [ ] **Step 4: Write minimal implementation**

```ts
// app/src/platform/keyStore.ts
import { generateSealingKey } from '../crypto/sealed'

export const KEY_DB_NAME = 'lunara-keys'
const STORE = 'keys'
const MAIN_KEY = 'sealing-v1'

let memo: Promise<CryptoKey> | null = null
const handles = new Set<IDBDatabase>()

export function withVaultLifecycle<T>(mode: 'shared' | 'exclusive', run: () => Promise<T>): Promise<T> {
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/platform/keyStore.test.ts`
Expected: all stated behaviors pass.

- [ ] **Step 6: Commit**

```bash
git add app/package.json pnpm-lock.yaml app/src/platform/keyStore.ts app/src/platform/keyStore.test.ts app/src/platform/__tests__/lifecycleLocks.ts
git commit -m "Add browser key store backed by a non-extractable CryptoKey"
```

### Task 3: Web secure vault

**Files:**
- Create: `app/src/platform/secureVault.ts`
- Test: `app/src/platform/secureVault.test.ts`

**Interfaces:**
- Consumes: `withSealingKey`, `withVaultLifecycle`, `destroyVaultStorage` (Task 2); `seal`, `open` (Task 1).
- Produces (same names as `native/secureVault.ts`): `SECURE_SECRET_KEYS` (adds `recordsRelayToken: 'records-relay-token'`), `secureVaultStatus(): Promise<SecureVaultStatus>` where `SecureVaultStatus = { available: true; persistence: 'indexeddb-webcrypto'; hardwareBacked: false; platform: 'web' }`, `setSecureSecret(key, value)`, `getSecureSecret(key): Promise<string | null>`, `deleteSecureSecret(key)`, `clearSecureSecrets()`, `destroySecureVault(clearAppData?: () => Promise<void>): Promise<void>`, `currentVaultPlatform(): 'web'`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/platform/secureVault.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from './__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteKeyStore } from './keyStore'
import {
  clearSecureSecrets,
  deleteSecureSecret,
  getSecureSecret,
  secureVaultStatus,
  setSecureSecret,
} from './secureVault'

describe('web secure vault', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await clearSecureSecrets()
    await deleteKeyStore()
  })

  it('reports browser-managed persistence honestly', async () => {
    expect(await secureVaultStatus()).toEqual({
      available: true,
      persistence: 'indexeddb-webcrypto',
      hardwareBacked: false,
      platform: 'web',
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
  })

  it('rejects malformed keys', async () => {
    await expect(setSecureSecret('bad key!', 'x')).rejects.toThrow(/letters, numbers/)
  })

  it('does not store plaintext in IndexedDB', async () => {
    await setSecureSecret('anthropic-api-key', 'sk-ant-visible')
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = indexedDB.open('lunara-secrets', 1)
      req.onsuccess = () => {
        const tx = req.result.transaction('secrets')
        const get = tx.objectStore('secrets').get('anthropic-api-key')
        tx.oncomplete = () => { req.result.close(); resolve(get.result) }
        tx.onerror = tx.onabort = () => { req.result.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
    expect(JSON.stringify(raw)).not.toContain('sk-ant-visible')
  })
})

afterEach(() => vi.unstubAllGlobals())

```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/platform/secureVault.test.ts`
Expected: FAIL, cannot resolve `./secureVault`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/platform/secureVault.ts
import { open, seal, type SealedBlob } from '../crypto/sealed'
import { deleteKeyStore, getSealingKey } from './keyStore'

export interface SecureVaultStatus {
  available: boolean
  persistence: 'indexeddb-webcrypto'
  hardwareBacked: boolean
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

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function secureVaultStatus(): Promise<SecureVaultStatus> {
  return { available: true, persistence: 'indexeddb-webcrypto', hardwareBacked: false, platform: 'web' }
}

export async function setSecureSecret(key: string, value: string): Promise<void> {
  assertValidKey(key)
  if (typeof value !== 'string') throw new Error('Secret value must be a string.')
  await withSealingKey(async (sealingKey) => {
    const blob = await seal(sealingKey, value)
    await withStore('readwrite', (s) => s.put(blob, key))
  })
}

export async function getSecureSecret(key: string): Promise<string | null> {
  assertValidKey(key)
  return withSealingKey(async (sealingKey) => {
    const blob = await withStore<SealedBlob | undefined>('readonly', (s) => s.get(key))
    if (!blob) return null
    try { return await open<string>(sealingKey, blob) }
    catch { return null }
  })
}

export async function deleteSecureSecret(key: string): Promise<void> {
  assertValidKey(key)
  await withVaultLifecycle('shared', () => withStore('readwrite', (s) => s.delete(key)))
}

export async function clearSecureSecrets(): Promise<void> {
  await withVaultLifecycle('shared', () => withStore('readwrite', (s) => s.clear()))
}

/** Full wipe used by "Delete all data": secrets and the key that seals them. */
export async function destroySecureVault(clearAppData: () => Promise<void> = async () => {}): Promise<void> {
  await destroyVaultStorage(async () => {
    await clearAppData()
    await withStore('readwrite', (s) => s.clear())
  })
}

export function currentVaultPlatform(): SecureVaultStatus['platform'] {
  return 'web'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/platform/secureVault.test.ts`
Expected: all stated behaviors pass. Also suspend a vault seal/write, request destruction from an independent client, and verify the exclusive lifecycle waits for that shared operation, then clears it; no old memo or ciphertext can survive. Use Task 2's shared LockManager in this test suite too.

- [ ] **Step 5: Commit**

```bash
git add app/src/platform/secureVault.ts app/src/platform/secureVault.test.ts
git commit -m "Add web secure vault sealed with the browser key store"
```

### Task 4: Device unlock via WebAuthn

**Files:**
- Create: `app/src/platform/deviceUnlock.ts`
- Test: `app/src/platform/deviceUnlock.test.ts`

**Interfaces:**
- Produces (drop-in for `native/biometrics.ts`): `type BiometricKind = 'platform' | 'none'`, `interface BiometricStatus { available: boolean; enrolled: boolean; kind: BiometricKind; state: 'available' | 'not-enrolled' | 'unsupported'; reason?: string }`, `getBiometricStatus(): Promise<BiometricStatus>`, `enrollDeviceUnlock(): Promise<{ credentialId: string }>` (stores id under setting `SK.deviceUnlockCredential`), `authenticateWithBiometrics(reason?: string): Promise<{ authenticated: boolean; kind: BiometricKind; errorCode?: string }>`, `removeDeviceUnlock(): Promise<void>`.
- Consumes: `getSetting/setSetting/removeSetting/SK` from `db/schema.ts`. Add `deviceUnlockCredential: 'deviceUnlockCredential'` to `SK`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/platform/deviceUnlock.test.ts
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getSetting, SK } from '../db/schema'
import { authenticateWithBiometrics, enrollDeviceUnlock, getBiometricStatus, removeDeviceUnlock } from './deviceUnlock'

const fakeCredential = { rawId: new Uint8Array([1, 2, 3, 4]).buffer, id: 'AQIDBA', type: 'public-key' }

function installWebAuthn(opts: { uvpaa: boolean; getResult?: unknown; getError?: Error }) {
  vi.stubGlobal('window', { location: { hostname: 'localhost' } })
  vi.stubGlobal('PublicKeyCredential', {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => opts.uvpaa,
  })
  vi.stubGlobal('navigator', {
    credentials: {
      create: vi.fn(async () => fakeCredential),
      get: vi.fn(async () => {
        if (opts.getError) throw opts.getError
        return 'getResult' in opts ? opts.getResult : fakeCredential
      }),
    },
  })
}

describe('deviceUnlock', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is unsupported without a platform authenticator', async () => {
    installWebAuthn({ uvpaa: false })
    expect(await getBiometricStatus()).toMatchObject({ available: false, enrolled: false, kind: 'none', state: 'unsupported' })
  })

  it('enrolls and reports enrolled', async () => {
    installWebAuthn({ uvpaa: true })
    const { credentialId } = await enrollDeviceUnlock()
    expect(credentialId).toBe('AQIDBA')
    expect(await getSetting(SK.deviceUnlockCredential)).toBe('AQIDBA')
    expect(await getBiometricStatus()).toMatchObject({ available: true, enrolled: true, kind: 'platform', state: 'available' })
  })

  it('authenticates only when the stored credential is asserted', async () => {
    installWebAuthn({ uvpaa: true })
    await enrollDeviceUnlock()
    expect(await authenticateWithBiometrics()).toEqual({ authenticated: true, kind: 'platform' })
    const call = (navigator.credentials.get as any).mock.calls[0][0]
    expect(call.publicKey.userVerification).toBe('required')
    expect(call.publicKey.allowCredentials[0].id).toBeInstanceOf(ArrayBuffer)
  })

  it.each([null, { type: 'password', rawId: fakeCredential.rawId }, { type: 'public-key', rawId: new Uint8Array([9]).buffer }])(
    'rejects a null, wrong-type or wrong-ID assertion: %j', async (getResult) => {
      installWebAuthn({ uvpaa: true, getResult })
      await enrollDeviceUnlock()
      expect((await authenticateWithBiometrics()).authenticated).toBe(false)
    },
  )

  it('maps user cancellation to USER_CANCEL', async () => {
    const err = new Error('cancelled')
    err.name = 'NotAllowedError'
    installWebAuthn({ uvpaa: true, getError: err })
    await enrollDeviceUnlock()
    expect(await authenticateWithBiometrics()).toEqual({ authenticated: false, kind: 'platform', errorCode: 'USER_CANCEL' })
  })

  it('removeDeviceUnlock forgets the credential', async () => {
    installWebAuthn({ uvpaa: true })
    await enrollDeviceUnlock()
    await removeDeviceUnlock()
    expect(await getBiometricStatus()).toMatchObject({ enrolled: false, state: 'not-enrolled' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/platform/deviceUnlock.test.ts`
Expected: FAIL, cannot resolve `./deviceUnlock`.

- [ ] **Step 3: Write minimal implementation**

Add to `SK` in `app/src/db/schema.ts`: `deviceUnlockCredential: 'deviceUnlockCredential',`.

```ts
// app/src/platform/deviceUnlock.ts
import { getSetting, removeSetting, setSetting, SK } from '../db/schema'

export type BiometricKind = 'platform' | 'none'
export type BiometricState = 'available' | 'not-enrolled' | 'unsupported'

export interface BiometricStatus {
  available: boolean
  enrolled: boolean
  kind: BiometricKind
  state: BiometricState
  reason?: string
}

export interface BiometricAuthenticationResult {
  authenticated: boolean
  kind: BiometricKind
  errorCode?: string
}

function b64url(buf: ArrayBuffer): string {
  let s = ''
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)).buffer
}

async function platformAvailable(): Promise<boolean> {
  const pkc = (globalThis as { PublicKeyCredential?: { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> } }).PublicKeyCredential
  if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false
  try {
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  if (!(await platformAvailable())) {
    return { available: false, enrolled: false, kind: 'none', state: 'unsupported', reason: 'This browser has no device unlock (Touch ID, Face ID, or Windows Hello).' }
  }
  const enrolled = Boolean(await getSetting(SK.deviceUnlockCredential))
  return { available: true, enrolled, kind: 'platform', state: enrolled ? 'available' : 'not-enrolled' }
}

export async function enrollDeviceUnlock(): Promise<{ credentialId: string }> {
  if (!(await platformAvailable())) throw new Error('Device unlock is not available in this browser.')
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Lunara', id: window.location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'lunara-local', displayName: 'Lunara on this device' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No credential was created.')
  const credentialId = b64url(cred.rawId)
  await setSetting(SK.deviceUnlockCredential, credentialId)
  return { credentialId }
}

/**
 * A local gate, not proof of identity to a server: the assertion is not
 * signature-verified. It holds the same trust level as the PIN and does not
 * cryptographically protect the stored encryption key.
 */
export async function authenticateWithBiometrics(_reason = 'Unlock your private Lunara data'): Promise<BiometricAuthenticationResult> {
  const stored = await getSetting(SK.deviceUnlockCredential)
  if (!stored || !(await platformAvailable())) return { authenticated: false, kind: 'none', errorCode: 'NOT_ENROLLED' }
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(stored) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    const credential = assertion as PublicKeyCredential | null
    const authenticated = credential?.type === 'public-key'
      && credential.rawId instanceof ArrayBuffer
      && b64url(credential.rawId) === stored
    return { authenticated, kind: 'platform' }
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return { authenticated: false, kind: 'platform', errorCode: name === 'NotAllowedError' ? 'USER_CANCEL' : 'FAILED' }
  }
}

export async function removeDeviceUnlock(): Promise<void> {
  await removeSetting(SK.deviceUnlockCredential)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/platform/deviceUnlock.test.ts`
Expected: all stated behaviors pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/platform/deviceUnlock.ts app/src/platform/deviceUnlock.test.ts app/src/db/schema.ts
git commit -m "Add WebAuthn device unlock as the web biometric gate"
```

### Task 5: In-session reminders

**Files:**
- Create: `app/src/platform/notifications.ts`
- Test: `app/src/platform/notifications.test.ts`

**Interfaces:**
- Consumes: `materializeReminderRequests`, `MaterializedReminderRequest`, `MaterializeReminderOptions`, `ReminderPermission`, `ReminderPlan` from `engine/reminders.ts` (existing).
- Produces (same names as `native/notifications.ts`): `notificationPermission(request?: boolean): Promise<ReminderPermission>`, `scheduleDailyReminder(time: string): Promise<void>`, `cancelDailyReminder(): Promise<void>`, `pendingDailyReminder(): Promise<boolean>`, `syncReminderPlans(plans, options): Promise<MaterializedReminderRequest[]>`, `cancelMaterializedReminders(): Promise<void>`, `listenForReminderActions(listener): Promise<{ remove(): void } | undefined>`, plus pure helper `msUntilNextOccurrence(time: string, now: Date): number` (exported for tests) and `pendingInSessionTimers(): number`.
- Produces also `startReminderScheduler(): Promise<void>`, `refreshReminderScheduler(): Promise<void>`, `stopReminderScheduler(): Promise<void>`. Start is idempotent per page, loads saved preferences without asking permission, materializes the next 24 h (cap 64), repeats every 60 minutes and on visibility becoming visible. Subscribe to persisted preference changes with Dexie liveQuery so other tabs also cancel on disable/wipe. Stable notification `tag = reminderId:occurrenceKey` deduplicates the same occurrence across tabs; daily tags include the occurrence date. Stop removes interval, listener and subscription, invalidates pending delivery, and cancels timers before wipe. Keep the existing public reminder functions.
- Delivery rechecks granted permission, uses `getRegistration()` with a 2-second bounded wait (including a hung lookup), and falls back to `new Notification` if permitted. Never use an unbounded worker-ready promise. Cancel timers on denied/disabled preferences; rescheduling slides the window beyond the first day. Use asynchronous timer advancement in tests.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/platform/notifications.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDailyReminder,
  cancelMaterializedReminders,
  msUntilNextOccurrence,
  notificationPermission,
  pendingDailyReminder,
  pendingInSessionTimers,
  scheduleDailyReminder,
  scheduleMaterializedReminders,
} from './notifications'

describe('in-session reminders', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-11T08:00:00'))
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }))
    vi.stubGlobal('navigator', {})
  })
  afterEach(async () => {
    await cancelDailyReminder()
    await cancelMaterializedReminders()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('computes the delay to the next HH:MM, rolling to tomorrow when passed', () => {
    const now = new Date('2026-09-11T08:00:00')
    expect(msUntilNextOccurrence('09:30', now)).toBe(90 * 60_000)
    expect(msUntilNextOccurrence('07:00', now)).toBe(23 * 60 * 60_000)
  })

  it('reports permission from the Notification API', async () => {
    expect(await notificationPermission()).toBe('granted')
    ;(globalThis as any).Notification.permission = 'default'
    expect(await notificationPermission()).toBe('not-requested')
    expect(await notificationPermission(true)).toBe('granted')
  })

  it('fires the daily reminder at the requested time and re-arms', async () => {
    await scheduleDailyReminder('08:05')
    expect(await pendingDailyReminder()).toBe(true)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect((globalThis as any).Notification).toHaveBeenCalledWith('Lunara', expect.objectContaining({ body: expect.any(String) }))
    expect(await pendingDailyReminder()).toBe(true)
  })

  it('rejects malformed times and unsupported permission', async () => {
    for (const time of ['25:99', '9:00', '09:0', '09:00:00', ' 09:00']) {
      await expect(scheduleDailyReminder(time)).rejects.toThrow(/HH:MM/)
    }
    ;(globalThis as any).Notification.permission = 'denied'
    ;(globalThis as any).Notification.requestPermission = vi.fn(async () => 'denied')
    await expect(scheduleDailyReminder('09:00')).rejects.toThrow(/permission/)
  })

  it('schedules only requests due within 24 hours', async () => {
    const base = Date.now()
    await scheduleMaterializedReminders([
      { id: 1, reminderId: 'r1', occurrenceKey: 'a', kind: 'water', route: 'today', state: 'scheduled', title: 'Lunara', body: 'Sip', fireAt: new Date(base + 60_000).toISOString() } as any,
      { id: 2, reminderId: 'r1', occurrenceKey: 'b', kind: 'water', route: 'today', state: 'scheduled', title: 'Lunara', body: 'Sip', fireAt: new Date(base + 30 * 60 * 60_000).toISOString() } as any,
    ])
    expect(pendingInSessionTimers()).toBe(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect((globalThis as any).Notification).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/platform/notifications.test.ts`
Expected: FAIL, cannot resolve `./notifications`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/src/platform/notifications.ts
import {
  materializeReminderRequests,
  type MaterializedReminderRequest,
  type MaterializeReminderOptions,
  type ReminderPermission,
  type ReminderPlan,
} from '../engine/reminders'
import { liveQuery } from 'dexie'
import { db, getSetting, SK } from '../db/schema'
import { localToday } from '../lib/dates'
import { parseReminderPreferences, REMINDER_SETTINGS_KEY } from '../engine/reminderPreferences'

const DAILY_KEY = 'daily'
const WINDOW_MS = 24 * 60 * 60_000
const MAX_TIMERS = 64
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let dailyTime: string | null = null
let deliveryGeneration = 0

type NotificationCtor = { new (title: string, options?: { body?: string; tag?: string }): unknown; permission: string; requestPermission(): Promise<string> }
function notificationApi(): NotificationCtor | undefined {
  return (globalThis as { Notification?: NotificationCtor }).Notification
}

export function msUntilNextOccurrence(time: string, now: Date): number {
  const [hour, minute] = time.split(':').map(Number)
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

function validTime(time: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)
}

async function showReminder(title: string, body: string, tag: string): Promise<void> {
  const generation = deliveryGeneration
  if ((await notificationPermission(false)) !== 'granted') return
  const sw = globalThis.navigator?.serviceWorker
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const reg = sw ? await Promise.race([
      sw.getRegistration(),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), 2_000) }),
    ]) : undefined
    if (generation !== deliveryGeneration || (await notificationPermission(false)) !== 'granted') return
    if (reg) { await reg.showNotification(title, { body, tag, renotify: false }); return }
  } catch { /* use the permitted fallback */ }
  finally { if (timer !== undefined) clearTimeout(timer) }
  const N = notificationApi()
  if (generation === deliveryGeneration && N?.permission === 'granted') new N(title, { body, tag })
}

export async function notificationPermission(request = false): Promise<ReminderPermission> {
  const N = notificationApi()
  if (!N) return 'denied'
  if (N.permission === 'granted') return 'granted'
  if (!request) return N.permission === 'denied' ? 'denied' : 'not-requested'
  return (await N.requestPermission()) === 'granted' ? 'granted' : 'denied'
}

function armDaily(): void {
  if (!dailyTime) return
  const delay = msUntilNextOccurrence(dailyTime, new Date())
  timers.set(
    DAILY_KEY,
    setTimeout(() => {
      void showReminder('Lunara', 'A gentle moment to check in with yourself.', `lunara-daily:${localToday()}:${dailyTime}`)
      if (notificationApi()?.permission === 'granted') armDaily()
      else void cancelDailyReminder()
    }, delay),
  )
}

export async function scheduleDailyReminder(time: string): Promise<void> {
  if (!validTime(time)) throw new Error('Reminder time must use HH:MM.')
  if ((await notificationPermission(true)) !== 'granted') throw new Error('Notification permission was not granted.')
  await cancelDailyReminder()
  dailyTime = time
  armDaily()
}

export async function cancelDailyReminder(): Promise<void> {
  deliveryGeneration += 1
  const t = timers.get(DAILY_KEY)
  if (t) clearTimeout(t)
  timers.delete(DAILY_KEY)
  dailyTime = null
}

export async function pendingDailyReminder(): Promise<boolean> {
  return timers.has(DAILY_KEY)
}

export async function cancelMaterializedReminders(): Promise<void> {
  deliveryGeneration += 1
  for (const [key, t] of timers) {
    if (key === DAILY_KEY) continue
    clearTimeout(t)
    timers.delete(key)
  }
}

/** In-session only: fires while a Lunara tab is open. Documented in Settings. */
export async function scheduleMaterializedReminders(requests: MaterializedReminderRequest[], stillCurrent: () => boolean = () => true): Promise<void> {
  await cancelMaterializedReminders()
  if (!stillCurrent()) return
  const now = Date.now()
  const due = requests
    .map((r) => ({ r, delay: Date.parse(r.fireAt) - now }))
    .filter(({ delay }) => delay >= 0 && delay <= WINDOW_MS)
    .sort((a, b) => a.delay - b.delay)
    .slice(0, MAX_TIMERS)
  for (const { r, delay } of due) {
    const key = `${r.reminderId}:${r.occurrenceKey}`
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      void showReminder(r.title, r.body, key)
    }, delay))
  }
}

export async function syncReminderPlans(plans: ReminderPlan[], options: MaterializeReminderOptions, stillCurrent: () => boolean = () => true): Promise<MaterializedReminderRequest[]> {
  const requests = materializeReminderRequests(plans, { ...options, limit: Math.min(MAX_TIMERS, options.limit ?? MAX_TIMERS) })
  const permission = await notificationPermission(false)
  if (!stillCurrent()) return []
  if (permission === 'granted') await scheduleMaterializedReminders(requests, stillCurrent)
  else { await cancelDailyReminder(); await cancelMaterializedReminders() }
  return requests
}

let schedulerRunning = false
let schedulerGeneration = 0
let hourly: ReturnType<typeof setInterval> | undefined
let settingsSubscription: { unsubscribe(): void } | undefined
const visible = () => { if (document.visibilityState === 'visible') void refreshReminderScheduler() }

export async function refreshReminderScheduler(): Promise<void> {
  const generation = ++schedulerGeneration
  const [raw, legacyTime, permission] = await Promise.all([
    getSetting(REMINDER_SETTINGS_KEY), getSetting(SK.reminderTime), notificationPermission(false),
  ])
  if (!schedulerRunning || generation !== schedulerGeneration) return
  if ((!raw && !legacyTime) || permission !== 'granted') {
    await cancelDailyReminder(); await cancelMaterializedReminders(); return
  }
  const prefs = parseReminderPreferences(raw, {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    startDate: localToday(), permission, legacyTime,
  })
  // Current browser permission controls delivery; do not prompt at startup.
  const plans = prefs.plans.map((plan) => ({ ...plan, permission }))
  await cancelDailyReminder()
  if (!schedulerRunning || generation !== schedulerGeneration) return
  await syncReminderPlans(plans, { now: new Date(), horizonDays: 1, limit: MAX_TIMERS },
    () => schedulerRunning && generation === schedulerGeneration)
}

export async function startReminderScheduler(): Promise<void> {
  if (schedulerRunning) return
  schedulerRunning = true
  document.addEventListener('visibilitychange', visible)
  hourly = setInterval(() => { void refreshReminderScheduler() }, 60 * 60_000)
  settingsSubscription = liveQuery(() => db.settings.bulkGet([REMINDER_SETTINGS_KEY, SK.reminderTime]))
    .subscribe(() => { void refreshReminderScheduler() })
  await refreshReminderScheduler()
}

export async function stopReminderScheduler(): Promise<void> {
  schedulerRunning = false
  schedulerGeneration += 1
  if (hourly !== undefined) clearInterval(hourly)
  document.removeEventListener('visibilitychange', visible)
  settingsSubscription?.unsubscribe()
  settingsSubscription = undefined
  await cancelDailyReminder()
  await cancelMaterializedReminders()
}

export interface NativeReminderAction { action: 'open' | 'complete' | 'snooze'; reminderId: string; occurrenceKey: string; route: string }
/** Browser notifications have no action buttons without a service-worker click handler; nothing to listen to yet. */
export async function listenForReminderActions(_listener: (action: NativeReminderAction) => void): Promise<{ remove(): void } | undefined> {
  return undefined
}

export function pendingInSessionTimers(): number {
  return [...timers.keys()].filter((k) => k !== DAILY_KEY).length
}
```

- [ ] **Step 4: Run test to verify it passes**

Add fake-indexeddb and a stubbed document to scheduler tests. Persist real preferences using `defaultReminderPreferences`/`serializeReminderPreferences`, enable a daily plan and verify: startup schedules without `requestPermission`; advancing more than 24 h delivers the next occurrence; two independent module clients use identical tags and the fake notification center retains one notification per occurrence; preference disable or permission denial cancels; visible refresh rematerializes; absent/rejected/hung `getRegistration()` falls back by 2 seconds; stop/wipe during a delayed lookup emits nothing. Stop the scheduler in cleanup before restoring timers/globals. Guard scheduler commits and delivery after every async boundary with the scheduler/delivery generation, including a preference change racing permission reads; current settings must still enable the occurrence when delivered.

Run: `cd app && npx vitest run src/platform/notifications.test.ts`
Expected: startup, rolling window, permission, tag dedupe, bounded fallback and wipe behaviors pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/platform/notifications.ts app/src/platform/notifications.test.ts
git commit -m "Add in-session web reminders replacing Capacitor local notifications"
```

### Task 6: Switch the app to the platform layer and delete the native layer

**Files:**
- Create: `app/src/platform/runtime.ts`, `app/src/platform/reportExport.ts` (+ move `reportExport.test.ts`), `app/src/lib/healthImport.ts`
- Modify: `app/src/main.tsx`, `app/src/App.tsx`, `app/src/components/{AssistantScreen,DoctorReport,LogSheet,PinLock}.tsx`, `app/src/screens/{CycleReportScreen,Onboarding,Settings,Today}.tsx`, `app/src/screens/Settings.test.ts`, `app/src/styles/{app,reports}.css`, `app/src/components/PinLock.test.ts`, `app/src/App.test.ts`, `app/src/lib/providerFetch.ts`, `app/package.json`, `pnpm-workspace.yaml`
- Delete: `app/src/native/`, `app/ios/`, `app/android/`, `app/capacitor.config.ts`, `workers/oauth-callback/`, `docs/NATIVE_ARCHITECTURE.md`

**Interfaces:**
- `platform/runtime.ts` produces: `export const isNative = false as const`, `export const nativePlatform = 'web' as const`, `initializeRuntime(): Promise<void>` (sets `document.documentElement.dataset.runtime = 'web'`, then starts reminders without prompting), `initializeNativeRuntime = initializeRuntime` (alias so main.tsx compiles before it is edited), `nativeTap(): Promise<void>` (calls `navigator.vibrate?.(10)`).
- `platform/reportExport.ts` produces the same `exportCurrentReport(jobName?, deps?)` with `native` forced false; keep `ReportExportDependencies` type so the moved test compiles.
- `lib/healthImport.ts` produces: `HealthSample`, `HealthDataType`, `SUPPORTED_HEALTH_DATA_TYPES`, `groupHealthSamples`, `groupHealthSamplesWithProvenance`, `applyHealthSamples`, `GroupedHealthDay`, `HealthImportApplyResult` (copy the type definitions for `HealthSample`/`HealthDataType` from `native/health.ts` into this file; drop everything that touched the bridge).

- [ ] **Step 1: Create the three modules**

```ts
// app/src/platform/runtime.ts
import { startReminderScheduler } from './notifications'

export const isNative = false as const
export const nativePlatform = 'web' as const

export async function initializeRuntime(): Promise<void> {
  document.documentElement.dataset.runtime = 'web'
  await startReminderScheduler()
}

/** Alias kept for one commit so existing imports compile during the switch. */
export const initializeNativeRuntime = initializeRuntime

export async function nativeTap(): Promise<void> {
  try {
    navigator.vibrate?.(10)
  } catch {
    /* unsupported */
  }
}
```

```ts
// app/src/platform/reportExport.ts
export interface ReportExportDependencies {
  browserPrint?: () => void
}

/** Web build: the browser print dialog is the export surface. */
export async function exportCurrentReport(
  _jobName = 'Lunara cycle report',
  dependencies: ReportExportDependencies = {},
): Promise<void> {
  const browserPrint = dependencies.browserPrint ?? (() => window.print())
  browserPrint()
}
```

Move `app/src/native/reportExport.test.ts` to `app/src/platform/reportExport.test.ts`. Remove native cases; rewrite the retained browser test to supply only `{ browserPrint }`, removing its bridge mock and assertion. Keep the dependency type with only `browserPrint?: () => void`.

`app/src/lib/healthImport.ts`: copy `native/healthImport.ts`, remove the imports from `./health` and `./runtime`, paste in the `HealthDataType`, `SUPPORTED_HEALTH_DATA_TYPES`, `HealthSample` definitions from `native/health.ts`, delete `importAppleHealthPeriodHistory`, `unavailablePeriodResult`, `healthImportProvider`, `AppleHealthPeriodImportResult`. Keep `groupHealthSamplesWithProvenance`, `groupHealthSamples`, `applyHealthSamples`.

- [ ] **Step 2: Repoint imports**

- `main.tsx`: `import { initializeRuntime } from './platform/runtime'`, call `void initializeRuntime()`, delete the service-worker unregister block.
- `App.tsx`: remove Capacitor imports/listener and split the old flags effect. Profile/consent updates only update profile-derived UI and PIN presence; the initial lock runs once when ready flips. Add `useRef` imports and use:
  ```ts
  const hasPinRef = useRef(false)
  const initialLockDone = useRef(false)
  hasPinRef.current = flags?.hasPin ?? hasPinRef.current
  useEffect(() => {
    if (flags === undefined) return
    setOnboarded(flags.ob)
    setReady(true)
  }, [flags])
  useEffect(() => {
    if (!ready || initialLockDone.current) return
    initialLockDone.current = true
    if (hasPinRef.current) setLocked(true)
  }, [ready, setLocked])
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && hasPinRef.current) setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [setLocked])
  ```
  Remove the old `if (flags.hasPin) setLocked(true)` from the flags effect; later flags/profile object changes never lock the session. PIN creation/removal handlers update presence explicitly as needed.

- `AssistantScreen.tsx`, `Onboarding.tsx`: `'../native/secureVault'` → `'../platform/secureVault'`. In AssistantScreen and Settings replace every persistence comparison with `'memory'` and its branches with the browser-vault label; the new type has no memory variant.
- `DoctorReport.tsx`, `CycleReportScreen.tsx`: `'../native/reportExport'` → `'../platform/reportExport'`.
- `LogSheet.tsx`: `'../native/runtime'` → `'../platform/runtime'`.
- `PinLock.tsx`: repoint to platform/deviceUnlock and use "Unlock with device". Maintain a lock generation ref. Increment on hidden/re-lock and unmount (including a hide while already locked), reset partial PIN entry on re-lock, and capture the generation before PIN hashing or WebAuthn. Only call setLocked(false) if that generation is still current and `document.visibilityState === 'visible'`. Skip automatic WebAuthn while hidden. Tests may extract pure lock helpers: (1) unlock, write a profile/medical-records consent update, and stay unlocked; (2) suspend PIN hashing and, separately, WebAuthn success, hide/re-lock, resolve each, and assert still locked with cleared partial entry. Test hidden mounting starts no automatic assertion.
- `Onboarding.tsx`: remove no StepIds. Keep `cycle-history` and the body-measurement `biometrics` step. Remove only the Apple Health subsection inside cycle-history, `importApplePeriodsDuringOnboarding`, its four health-import state variables, `onboardingHealthPermission`, and import-only helpers/imports (`HealthAuthorization`, `importAppleHealthPeriodHistory`, `nativePlatform`, `recentCycleLength`, `getPeriodStarts`, `toEpochDay` when otherwise unused). Use default healthData permission and a not-requested health-import ledger entry; Task 18 adds medical-records consent.
- `Today.tsx`: remove the widget import and the `publishWidgetSnapshot` effect (lines ~320–390); keep any snapshot computation only if something else uses it, otherwise delete it.
- `Settings.test.ts`: import `HealthSample`, `groupHealthSamples`, `groupHealthSamplesWithProvenance` from `'../lib/healthImport'`.
- `Settings.tsx`: repoint biometrics, notifications, runtime and secureVault to platform modules. Remove `profileHealthPermission`, health/widget state and initialization results, `syncHealthData`, `recordHealthImportDecision`, `importApplePeriods`, their imports and the complete "Device health & native services" section. Remove native gating from device unlock and reminders. Show the unlock toggle when the platform authenticator is available. Enabling requires a PIN, calls `enrollDeviceUnlock()` before any enrolled check, then saves `SK.biometricLock`. Disabling or removing the PIN clears the flag and credential. Run permission, scheduling, cancellation and notification-consent updates through the existing reminder handler; remove its web branch forcing not-requested, use the web permission result, and call `refreshReminderScheduler()` after saved preferences change. Replace all native-only status messages. Replace all persistence-versus-memory branches with "Browser-managed key (WebCrypto in IndexedDB)" and the honest key/screen-gate copy; add in-session reminder limitations.
- In this task's existing Settings wipe handler, call `stopReminderScheduler()` first and `destroySecureVault()` before reporting success. Propagate blocked-delete failures and show exactly "Close other Lunara tabs and try again." Task 17 extends this same handler with connection-generation invalidation before abort/clear; it must preserve the nonpersonal generation tombstone. Pass the app-table clear as destroySecureVault's callback so the exclusive vault lifecycle covers app clearing and key destruction; do not nest a second lifecycle lock. No sealed write can cross destruction. Replace the old db.delete()/unconditional reload sequence: clear tables transactionally, catch failures in the wipe handler, and reload/report success only after destruction succeeds. Task 17 preserves the generation tombstone rather than deleting the whole Dexie database. Do not postpone vault destruction to Task 21.
- DoctorReport and CycleReportScreen: add an explicit `<div className="print-root">…report content…</div>` wrapper. Disable export while requested report data loads or failed. Add the following print rules after existing print declarations in reports.css; ancestors remain only as structural containers so hidden siblings take no space:
  ```css
  @media print {
    #root:has(.print-root) *:not(.print-root):not(.print-root *):not(:has(.print-root)) {
      display: none !important;
    }
    #root:has(.print-root), #root :has(.print-root), .print-root {
      display: block !important;
      position: static !important;
      inset: auto !important;
      transform: none !important;
      animation: none !important;
      width: auto !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
    }
    #root .no-print, #root .sheet-backdrop, #root .dialog-scrim {
      display: none !important;
    }
  }
  ```
  Keep report controls outside the wrapper or mark no-print. Verify underlying main/screens and unchecked sensitive sections are absent in portrait and landscape print previews.

- `lib/providerFetch.ts`: reduce to `export const providerFetch: typeof fetch = (input, init) => fetch(input, init)` with the existing doc comment trimmed to the browser case.

- [ ] **Step 3: Delete the native layer and dependencies**

```bash
git rm -r -q app/src/native app/ios app/android app/capacitor.config.ts workers/oauth-callback docs/NATIVE_ARCHITECTURE.md
```

In `app/package.json` remove every `@capacitor/*` dependency and devDependency and the scripts `build:native`, `native:sync`, `native:ios`, `native:android`, `native:ios:build`, `native:android:build`, `native:doctor`. In `pnpm-workspace.yaml` keep `esbuild` and `sharp` under `allowBuilds`, drop `workerd` only if no worker still needs it (the backup and reminders workers use wrangler → keep it). Run `pnpm install` from the repo root to refresh the lockfile.

- [ ] **Step 4: Verify**

Run from repo root: `pnpm --filter @lunara/app test && cd app && npx tsc --noEmit && npx vite build`
Expected: all retained and new behavior tests pass, no type errors, build succeeds. `grep -r "@capacitor\|native/" app/src` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Replace Capacitor native layer with web platform adapters"
```

### Task 7: PWA, service worker, and security headers

**Files:**
- Create: `app/pwa.config.ts`, `app/pwa.config.test.ts`, `app/public/_headers`
- Modify: `app/vite.config.ts`, `app/index.html`, `app/package.json`, `app/src/platform/runtime.ts`, `app/src/vite-env.d.ts`

**Interfaces:**
- `pwa.config.ts` produces `export const pwaOptions: Partial<VitePWAOptions>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/pwa.config.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pwaOptions } from './pwa.config'

describe('pwa config', () => {
  it('registers with autoUpdate and a standalone manifest', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.manifest).toMatchObject({ name: 'Lunara', display: 'standalone' })
  })

  afterEach(() => vi.unstubAllGlobals())
  it('serialized matchers keep every sensitive destination network-only', () => {
    vi.stubGlobal('self', { location: { origin: 'https://app.test' } })
    const routes = pwaOptions.workbox?.runtimeCaching ?? []
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.every((r) => r.handler === 'NetworkOnly')).toBe(true)
    for (const url of [
      'https://api.finchnode.com/demo/v1/x', 'https://arbitrary-relay.test/v1/x',
      'https://api.openai.com/v1/x', 'https://backup.test/x',
      'https://app.test/api/x', 'https://app.test/v1/users/u_x/records',
    ]) {
      const match = routes.some((route) => {
        if (typeof route.urlPattern !== 'function') return false
        // Evaluate without the config module closure, just as generated SW code runs.
        const matcher = new Function(`return (${route.urlPattern.toString()})`)()
        return matcher({ url: new URL(url) })
      })
      expect(match).toBe(true)
    }
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.some((re) => re.test('/?records=return'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run pwa.config.test.ts`
Expected: FAIL, cannot resolve `./pwa.config`. (Add `'*.test.ts'` at the app root to `test.include` in `vite.config.ts`: `include: ['src/**/*.test.ts', '*.test.ts']`.)

- [ ] **Step 3: Install and implement**

Run: `cd app && pnpm add -D vite-plugin-pwa@^1.3.0`

```ts
// app/pwa.config.ts
import type { VitePWAOptions } from 'vite-plugin-pwa'

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: 'autoUpdate',
  includeAssets: ['icons/apple-touch-icon.png'],
  manifest: {
    name: 'Lunara',
    short_name: 'Lunara',
    description: 'Private cycle, fertility, pregnancy and perimenopause companion. Your data stays in your browser.',
    display: 'standalone',
    start_url: '/',
    background_color: '#FFF7F8',
    theme_color: '#FFF7F8',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    navigateFallbackDenylist: [/^\/(?:api|v1)\//],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => url.hostname === 'api.finchnode.com',
        handler: 'NetworkOnly',
      },
      {
        // Any cross-origin request (relay, AI provider, backup) is network-only.
        urlPattern: ({ url }) => url.origin !== self.location.origin,
        handler: 'NetworkOnly',
      },
      {
        urlPattern: ({ url }) => url.origin === self.location.origin && /^\/(?:api|v1)\//.test(url.pathname),
        handler: 'NetworkOnly',
      },
    ],
  },
}
```

`vite.config.ts`: `import { VitePWA } from 'vite-plugin-pwa'`, `import { pwaOptions } from './pwa.config'`, `plugins: [react(), VitePWA(pwaOptions)]`.

`platform/runtime.ts`: after setting the dataset, `if (import.meta.env.PROD) { const { registerSW } = await import('virtual:pwa-register'); registerSW({ immediate: true }) }`. Add `/// <reference types="vite-plugin-pwa/client" />` to `vite-env.d.ts`.

`index.html`: `<meta name="theme-color" content="#FFF7F8" />`, add `<meta name="description" content="Private cycle tracking that stays in your browser." />`.

```text
# app/public/_headers
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://api.finchnode.com https://api.openai.com https://api.anthropic.com http://localhost:* http://127.0.0.1:*; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
```

- [ ] **Step 4: Verify**

Run: `cd app && npx vitest run pwa.config.test.ts && npx tsc --noEmit && npx vite build && ls dist/sw.js dist/manifest.webmanifest`
Expected: tests pass and build emits the worker/manifest. Run `grep -q 'NetworkOnly' dist/sw.js && grep -q 'api\.finchnode\.com' dist/sw.js` and require both the strategy name and hostname in the emitted worker; verify it contains the self-contained hostname check, not a module-scoped constant reference. In a production preview, make FinchNode, arbitrary relay, AI, backup and same-origin API requests with the worker controlling the page; inspect CacheStorage to ensure none of their responses are stored. Navigate to `/?records=return` and verify only the precached app shell serves the navigation, with no session-specific cache entry. A source-callback-only test is insufficient.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add PWA service worker with network-only record traffic and security headers"
```

### Task 8: Documentation for the web build

**Files:**
- Modify: `README.md`, `docs/FEATURE_PARITY.md`, `docs/CURRENT_PROGRESS_AND_ROADMAP.md`
- Create: `docs/WEB_CAPABILITY_BOUNDARY.md`
- Delete: `docs/LOCAL_CAPABILITY_BOUNDARY.md`

- [ ] **Step 1: Rewrite README**

Structure: title + one-line description; "Fork notice" (upstream link, AGPL, what changed: web-first, FinchNode records, Aileron, palette); "Run it" (`pnpm install`, `pnpm dev`, `pnpm build`, `pnpm preview`; deploy `app/dist` to any static host; `_headers` note); "Privacy" (link `PRIVACY.md`, three bullets: local-first, opt-in transfers, sealed record bodies and vault secrets (plaintext indexes/connection metadata/logs/profiles)); "Medical records" placeholder paragraph that Task 23 completes; "Develop" (`pnpm test`, estimate audit note); "Structure" (`app/`, `workers/backup`, `workers/reminders`, `workers/records-relay` (added in Phase 3)); "AI companion" section kept; Disclaimer; License.

- [ ] **Step 2: Capability boundary doc**

`docs/WEB_CAPABILITY_BOUNDARY.md`: sections "Fully local in the browser" (logging, predictions, reports, content, encrypted export/import, sealed secrets, PIN + device unlock, in-session reminders, PWA offline shell), "Needs a network call the user opts into" (FinchNode demo, relay, AI, backup, email reminders), "Not possible in a browser" (background notifications without push, HealthKit/Health Connect, widgets, cross-device sync without transport). Mark the native rows in `FEATURE_PARITY.md` as "Removed in the web fork" and add a dated note at the top of the roadmap doc pointing to the spec.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Document the web-first build and its capability boundary"
```

---

# Phase 2: Aileron and the baby pink / baby red design system

### Task 9: Aileron typeface

**Files:**
- Modify: `app/package.json`, `app/src/main.tsx`, `app/src/styles/tokens.css` (typography block), `app/src/styles/app.css`, `app/src/styles/health.css`

- [ ] **Step 1: Install and import**

Run: `cd app && pnpm add @fontsource/aileron@^5.3.0`

At the top of `app/src/main.tsx`, before the style imports:

```ts
import '@fontsource/aileron/300.css'
import '@fontsource/aileron/400.css'
import '@fontsource/aileron/600.css'
import '@fontsource/aileron/700.css'
import '@fontsource/aileron/800.css'
```

- [ ] **Step 2: Point the tokens at Aileron**

In `tokens.css` replace the `--font-display`, `--font-sans`, `--tracking-tight` lines with:

```css
  --font-display: 'Aileron', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-sans: 'Aileron', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --tracking-tight: -0.02em;
  --weight-display: 800;
```

Set display-heading rules, including current weight-500 `.page h1`, `.page h2` and `.overlay-head h2`, to `var(--weight-display)`. Replace direct Avenir/Iowan font declarations in health.css with the font tokens. Leave body weights alone. Inspect final computed font family and weight; a token test cannot verify the cascade.

- [ ] **Step 3: Verify**

Run: `cd app && npx vite build && grep -c "aileron" dist/assets/*.css | head -1`
Expected: build succeeds and the CSS bundle references the Aileron woff2 files (count > 0).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Use the Aileron typeface for display and body text"
```

### Task 10: Palette tokens with a contrast test

**Files:**
- Create: `app/src/styles/tokens.test.ts`
- Modify: `app/src/styles/tokens.css`

**Interfaces:**
- Produces the token names in spec B2. Every old name (`--rose-*`, `--coral-400`, `--teal-*`, `--yellow-*`, `--clay-*`, `--paper-*`, `--purple-500`, `--red-500`, `--plum-*`, `--orange-500`, `--bg`, `--card`) must still resolve.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/styles/tokens.test.ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8')

function token(name: string, depth = 0): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`token ${name} missing`)
  const value = match[1].trim()
  const alias = value.match(/^var\((--[a-z0-9-]+)\)$/)
  if (alias) {
    if (depth > 5) throw new Error(`alias loop at ${name}`)
    return token(alias[1], depth + 1)
  }
  return value
}

function luminance(hex: string): number {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

describe('palette tokens', () => {
  it('defines the baby pink and baby red anchors', () => {
    expect(token('--pink-300').toUpperCase()).toBe('#F4C2C2')
    expect(token('--red-400').toUpperCase()).toBe('#F08080')
  })

  it.each([
    ['--ink-900', '--pink-50'],
    ['--ink-900', '--pink-100'],
    ['--ink-900', '--pink-200'],
    ['--ink-650', '--pink-50'],
    ['--ink-650', '--pink-100'],
    ['--ink-650', '--pink-200'],
    ['--cta-fg', '--cta-bg'],
    ['--red-700', '--pink-50'],
  ])('%s on %s meets WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps period and fertile markers distinguishable', () => {
    expect(contrast('--period', '--fertile')).toBeGreaterThanOrEqual(1.5)
  })

  it.each(['--rose-600', '--coral-400', '--teal-500', '--teal-100', '--yellow-500', '--clay-200', '--paper-100', '--purple-500', '--red-500', '--plum-900', '--orange-500', '--bg', '--card'])(
    'legacy alias %s still resolves',
    (name) => {
      expect(() => token(name)).not.toThrow()
    },
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/styles/tokens.test.ts`
Expected: FAIL on the anchor test (no `--pink-300`).

- [ ] **Step 3: Rewrite the palette block in `tokens.css`**

Replace everything from `/* Core palette */` through the `--card` alias with:

```css
  /* Baby pink surfaces */
  --pink-50: #FFF7F8;
  --pink-100: #FFEEF1;
  --pink-200: #FCDDE3;
  --pink-300: #F4C2C2;
  --pink-400: #EFA9B3;
  --pink-500: #E58E9C;

  /* Baby red actions and cycle signal */
  --red-200: #FBC4C4;
  --red-300: #F5A0A0;
  --red-400: #F08080;
  --red-500: #E86464;
  --red-600: #D64D4D;
  --red-700: #C0393B;
  --red-800: #9E2C2E;

  /* Warm ink */
  --ink-950: #2E1B1F;
  --ink-900: #3A2226;
  --ink-800: #4F3238;
  --ink-650: #6F4E56;
  --ink-500: #8E6E76;
  --ink-300: #BFA6AB;

  /* Semantic */
  --bg: var(--pink-50);
  --card: rgba(255, 255, 255, 0.86);
  --cta-bg: var(--red-700);
  --cta-fg: #FFFFFF;
  --period: var(--red-500);
  --fertile: var(--red-300);
  --phase-follicular: var(--pink-300);
  --phase-luteal: var(--pink-400);
  --chart-bbt: var(--red-800);
  --danger: var(--red-800);
  --warning: #C9862B;
  --success: #5E8C6A;

  /* Legacy aliases: the existing stylesheets keep working unchanged */
  --paper-50: var(--pink-50);
  --paper-100: var(--pink-50);
  --paper-150: var(--pink-100);
  --paper-200: var(--pink-200);
  --paper-300: var(--pink-300);
  --rose-700: var(--red-700);
  --rose-600: var(--red-600);
  --rose-500: var(--red-500);
  --rose-400: var(--red-400);
  --rose-300: var(--red-300);
  --rose-200: var(--red-200);
  --rose-100: var(--pink-100);
  --coral-400: var(--red-400);
  --teal-700: var(--red-700);
  --teal-600: var(--red-600);
  --teal-500: var(--pink-500);
  --teal-300: var(--pink-400);
  --teal-200: var(--pink-300);
  --teal-100: var(--pink-100);
  --yellow-600: var(--warning);
  --yellow-500: #E0A046;
  --yellow-300: #F3CF8E;
  --yellow-200: #F9E4BC;
  --yellow-100: #FDF2DA;
  --clay-500: var(--pink-500);
  --clay-200: var(--pink-300);
  --clay-100: var(--pink-200);
  --purple-500: var(--ink-650);
  --plum-900: var(--ink-900);
  --plum-500: var(--ink-500);
  --orange-500: var(--warning);
```

Then update the surfaces/lines/shadows block so its rgba values use the warm ink hue (`rgba(58, 34, 38, …)`) and the rose shadow uses `rgba(192, 57, 59, 0.22)`. Update the file's header comment to describe the new system.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/styles/tokens.test.ts`
Expected: all pass. If a contrast case fails, darken the ink or CTA value until it passes; never lower the threshold.

- [ ] **Step 5: Commit**

```bash
git add app/src/styles/tokens.css app/src/styles/tokens.test.ts
git commit -m "Introduce the baby pink and baby red palette with a contrast test"
```

### Task 11: Apply semantic tokens where the UI hard-codes hues

**Files:**
- Modify: `app/src/styles/base.css`, `app/src/styles/app.css`, `app/src/styles/health.css`, `app/src/styles/reports.css`, `app/src/components/CycleRing.tsx`, and every `.tsx` that uses `var(--teal-…)` / `var(--rose-…)` / `var(--coral-400)` inline (`grep -rn "var(--teal\|var(--rose\|var(--coral" app/src --include='*.tsx'`)

- [ ] **Step 1: Replace the body background gradients in `base.css`**

```css
  background:
    radial-gradient(circle at 14% -5%, rgba(240, 128, 128, 0.18), transparent 31%),
    radial-gradient(circle at 96% 18%, rgba(244, 194, 194, 0.35), transparent 30%),
    var(--pink-50);
```

and the `html` background to `var(--pink-100)`.

- [ ] **Step 2: Map cycle semantics**

In `CycleRing.tsx` and the phase/marker rules in `app.css` (search `period`, `fertile`, `ovulation`, `luteal`, `follicular` class names) use `var(--period)`, `var(--fertile)`, `var(--phase-follicular)`, `var(--phase-luteal)`. Inline TSX references to `--teal-500`/`--teal-100` become `--fertile`/`--pink-100`; `--rose-500`/`--rose-700`/`--coral-400` become `--period`/`--red-700`/`--red-400`. Target `.cta` and the effective override `.page.onboarding .ob-shell-footer .cta` with `background: var(--cta-bg); color: var(--cta-fg)`, preserving secondary, yellow and disabled variants. Update `.phase-fertile`, `.phase-ovulation`, `.cal-day.*`, `.date-cell.*`, `.bbt-line`, `.bbt-point`, and health.css's local palette variables and literal gradients; use separate dark `--chart-bbt` for the BBT series. Inspect computed styles for all these selectors and button variants, since token tests alone do not verify the cascade.

- [ ] **Step 3: Verify visually and mechanically**

Run: `cd app && npx tsc --noEmit && npx vite build && npx vite preview --port 4173 &` then open `http://localhost:4173` in a browser; check Today, Calendar, Trends and a primary button. Kill the preview afterwards.
Expected: no teal anywhere; period days are baby red; fertile window is soft red; surfaces are baby pink.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Apply the pink and red semantic tokens across the UI"
```

### Task 12: Desktop layout

**Files:**
- Create: `app/src/styles/desktop.css`
- Modify: `app/src/main.tsx` (import it last), `app/src/components/TabBar.tsx`, overlay render sites in `App.tsx` and health dialogs (scrims inside root)

- [ ] **Step 1: Write the stylesheet**

```css
/* Desktop shell: rail navigation and a centred reading column. */
@media screen and (min-width: 900px) {
  :root {
    --content-width: 760px;
    --rail-width: 220px;
  }

  #root {
    flex-direction: row;
  }

  main {
    order: 2;
    flex: 1;
    min-width: 0;
    padding-top: 32px;
    padding-bottom: 48px;
  }

  .tabbar {
    order: 1;
    position: sticky;
    top: 0;
    height: 100vh;
    width: var(--rail-width);
    border-right: 1px solid var(--line-soft);
    border-top: none;
    background: var(--pink-100);
    padding: 28px 12px;
  }

  .page { max-width: var(--content-width); margin-inline: auto; }

  .tabbar-inner {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    max-width: none;
  }

  .tabbar-item {
    flex-direction: row;
    justify-content: flex-start;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
  }

  .tabbar-item.is-active {
    background: var(--pink-200);
  }

  .tabbar-label {
    font-size: 15px;
  }

  .overlay,
  .sheet,
  .health-overlay {
    left: 50%;
    right: auto;
    width: min(680px, calc(100vw - 48px));
    transform: translateX(-50%);
    animation: none; /* old fill-mode: both animations override centering */
    border-radius: var(--radius-large);
    box-shadow: var(--shadow-float);
    max-height: calc(100vh - 48px);
    top: 24px;
    bottom: auto;
  }

  .overlay-body, .sheet-body, .health-scroll {
    overflow-y: auto;
    min-height: 0;
  }

  #root > .dialog-scrim {
    position: fixed;
    inset: 0;
    background: rgba(58, 34, 38, 0.18);
    z-index: 99;
  }
  .overlay, .sheet, .health-overlay { z-index: 100; }
}
```

Reuse `.sheet-backdrop` instead of adding a second Sheet scrim. Render other `.dialog-scrim` elements inside `#root` as siblings below their dialogs, with their existing dismissal handlers; ensure the scrim is below the matching dialog in the actual stacking context. Keep overflow scrolling in the three body containers. Keep desktop.css last among screen styles; Task 20 imports records.css before it. Print resets from Task 6 apply only at print time and must win over existing print declarations.

- [ ] **Step 2: Verify at two widths**

Run the preview as in Task 11; view at 390px and 1280px wide.
Expected: phone layout under 900px; flex column rail and centered `.page` above. Verify long-dialog scrolling, scrim clicks/stacking, no animation centering jump, and portrait/landscape print isolation. Task 20 expands the mobile grid to five columns.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add a desktop rail layout above 900px"
```

---

# Phase 3: Medical records via FinchNode

### Task 13: Record model and categories

**Files:**
- Create: `app/src/records/types.ts`, `app/src/records/categories.ts`
- Test: `app/src/records/categories.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
// app/src/records/types.ts
export type RecordCategory =
  | 'demographics' | 'medications' | 'conditions' | 'allergies' | 'labs' | 'vitals' | 'immunizations'
export type RecordsMode = 'demo' | 'live'

export interface RecordCoding { system: string | null; code: string | null; display: string | null }

interface Base<C extends RecordCategory> {
  /** Live: `${mode}:${category}:${upstream rec_… ID}`; demo: FHIR resource ID. */
  id: string
  category: C
  sourceRecordId: string | null
  sourceName: string | null
  /** ISO date or date-time used for sorting; meaning is category specific. */
  date: string | null
  codes: RecordCoding[]
  syncedAt: string
  synthetic: boolean
}
export interface DemographicRecord extends Base<'demographics'> { name: string; birthDate: string | null; gender: string | null; address: string | null; phone: string | null; email: string | null }
export interface MedicationRecord extends Base<'medications'> { name: string; dosage: string | null; frequency: string | null; status: string | null; startDate: string | null; endDate: string | null; prescriber: string | null; reason: string | null }
export interface ConditionRecord extends Base<'conditions'> { name: string; status: string | null; verificationStatus: string | null; severity: string | null; onsetDate: string | null; recordedDate: string | null }
export interface ObservationRecord extends Base<'labs' | 'vitals'> { name: string; value: string | number | null; unit: string | null; status: string | null; referenceRange: string | null; interpretation: string | null }
export interface AllergyRecord extends Base<'allergies'> { substance: string; reaction: string | null; severity: string | null; status: string | null; verificationStatus: string | null; recordedDate: string | null }
export interface ImmunizationRecord extends Base<'immunizations'> { name: string; code: string | null; status: string | null; manufacturer: string | null; lotNumber: string | null }
export type MedicalRecord = DemographicRecord | MedicationRecord | ConditionRecord | ObservationRecord | AllergyRecord | ImmunizationRecord

export interface NormalizeResult { records: MedicalRecord[]; skipped: number; additionalItems: number }

export interface RecordsSource { system: string; organization: string | null; lastSyncedAt: string | null }
export interface RecordsWarning { code: string; message: string; category?: RecordCategory | null }
export type ConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error'
export type SyncStatus = 'not_started' | 'queued' | 'syncing' | 'complete' | 'partial' | 'failed' | 'reauthorization_required'
export interface SyncFailure { code: string; message: string; retryable: boolean }
export interface SyncDetails {
  sync: { status: SyncStatus }
  grantedCategories: RecordCategory[]
  availableCategories: RecordCategory[]
  missingCategories: RecordCategory[]
  failure: SyncFailure | null
}

export interface RecordsConnection {
  id: 'primary'
  mode: RecordsMode
  status: ConnectionStatus
  generation: number
  relayBaseUrl: string | null
  importedAt?: string
  categories: RecordCategory[]
  subject?: string
  pendingSession?: { id: string; externalId: string; categories: RecordCategory[]; startedAt: string }
  sources: RecordsSource[]
  consentReceiptIds: string[]
  creationAttempt?: { externalId: string; categories: RecordCategory[]; returnUrl: string }
  grantedCategories: RecordCategory[]
  availableCategories: RecordCategory[]
  missingCategories: RecordCategory[]
  sync?: { status: SyncStatus }
  failure?: SyncFailure | null
  additionalItems: number
  connectedAt?: string
  lastSyncAt?: string
  syncStatus?: 'complete' | 'partial' | 'not_started'
  warnings: RecordsWarning[]
  skipped?: number
  lastError?: string
  recoveryAction?: 'start-again' | 'check-again' | 'refresh'
}
```

```ts
// app/src/records/categories.ts
import type { RecordCategory } from './types'
export const RECORD_CATEGORIES: readonly RecordCategory[] = ['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'] as const
export const CATEGORY_LABELS: Record<RecordCategory, string> = { demographics: 'About you', medications: 'Medications', conditions: 'Conditions', allergies: 'Allergies', labs: 'Lab results', vitals: 'Vital signs', immunizations: 'Immunizations' }
export function isRecordCategory(value: unknown): value is RecordCategory { return typeof value === 'string' && (RECORD_CATEGORIES as readonly string[]).includes(value) }
export function normalizeCategories(input: readonly unknown[]): RecordCategory[] { return RECORD_CATEGORIES.filter((c) => input.includes(c)) }
/** Use normalization only for trusted category intersections, never relay input validation. */
export function requireCategories(input: unknown): RecordCategory[] {
  if (!Array.isArray(input) || input.length === 0 || !input.every(isRecordCategory) || new Set(input).size !== input.length) {
    throw new Error('Choose at least one supported category without duplicates.')
  }
  return input
}
export function recordId(mode: 'demo' | 'live', category: RecordCategory, upstreamId: string): string {
  if (!upstreamId || (mode === 'live' && !/^rec_[a-f0-9]{24}$/.test(upstreamId))) throw new Error('Invalid stable record ID.')
  return `${mode}:${category}:${upstreamId}`
}
```

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/categories.test.ts
import { describe, expect, it } from 'vitest'
import { isRecordCategory, normalizeCategories, requireCategories, RECORD_CATEGORIES, recordId } from './categories'

describe('categories', () => {
  it('lists the seven v1 categories in display order', () => {
    expect(RECORD_CATEGORIES).toEqual(['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'])
  })
  it('filters unknown values and preserves canonical order', () => {
    expect(normalizeCategories(['labs', 'encounters', 'medications', 42])).toEqual(['medications', 'labs'])
    expect(isRecordCategory('claims')).toBe(false)
  })
  it.each([undefined, [], ['labs', 'labs'], ['claims']])('rejects invalid outbound categories: %j', (input) => {
    expect(() => requireCategories(input)).toThrow()
  })
  it('requires stable live IDs and keeps demo FHIR IDs', () => {
    expect(recordId('demo', 'labs', 'obs-1')).toBe('demo:labs:obs-1')
    expect(recordId('live', 'labs', 'rec_000000000000000000000001')).toBe('live:labs:rec_000000000000000000000001')
    expect(() => recordId('live', 'labs', '')).toThrow(/stable/)
  })
})
```

- [ ] **Step 2: Run, implement (files above), run again**

Run: `cd app && npx vitest run src/records/categories.test.ts` → FAIL, then PASS for category ordering, validation and stable identity.

- [ ] **Step 3: Commit**

```bash
git add app/src/records
git commit -m "Add the medical record model and category constants"
```

### Task 14: FHIR R4 normalizer (demo API shape)

**Files:**
- Create: `app/src/records/normalize/fhir.ts`, `app/src/records/__fixtures__/demo-records.json` (copy of `docs/finchnode/demo-records-sample.json`)
- Test: `app/src/records/normalize/fhir.test.ts`

**Interfaces:**
- Produces: `normalizeFhirRecordMap(recordMap: Record<string, unknown[]>, opts: { mode: 'demo' | 'live'; syncedAt: string; synthetic: boolean; sourceName: string | null; categories: readonly RecordCategory[] }): NormalizeResult`, plus exported per-resource helpers `fhirText(codeable)`, `fhirCodings(codeable)`, `fhirDate(resource)`.
- Mapping rules:
  - `Patient` → `demographics`: `name` = official name `${given.join(' ')} ${family}`, `birthDate`, `gender`, `address` = `city, state postalCode` joined from `address[0]`, `phone`/`email` from `telecom` by `system`.
  - `MedicationRequest` / `MedicationStatement` → `medications`: `name` = `medicationCodeableConcept.text ?? coding.display`, `dosage` = `dosageInstruction[0].text ?? dosage[0].text`, `status`, `startDate` = `authoredOn ?? effectivePeriod.start ?? effectiveDateTime`, `endDate` = `effectivePeriod.end`, `prescriber` = `requester.display`, `reason` = `reasonCode[0].text`.
  - `Condition` → `conditions`: `name` = `code.text ?? code.coding.display`, `status` = `clinicalStatus.coding[0].code`, `verificationStatus` = `verificationStatus.coding[0].code`, `severity` = `severity.text ?? severity.coding.display`, `onsetDate` = `onsetDateTime ?? onsetPeriod.start`, `recordedDate`.
  - `AllergyIntolerance` → `allergies`: `substance` = `code.text ?? code.coding.display`, `reaction` = `reaction[0].manifestation[0].text ?? …coding.display`, `severity` = `reaction[0].severity ?? criticality`, `status` = `clinicalStatus.coding[0].code`, `verificationStatus`, `recordedDate`.
  - `Observation` → `labs` when `category[].coding[].code === 'laboratory'`, `vitals` when `'vital-signs'`; anything else → skipped. `value`: `valueQuantity.value` (number) or `valueString`/`valueCodeableConcept.text`; if `component[]` exists, locate systolic LOINC `8480-6` and diastolic `8462-4` by code and format `systolic/diastolic` only if both are finite numbers with compatible units (`mmHg`/UCUM `mm[Hg]`). Otherwise render labeled `"name: value unit"` pairs, including unrelated two-component observations; `unit` = `valueQuantity.unit ?? component[0].valueQuantity.unit`; `referenceRange` uses explicit text when present, otherwise both finite bounds as `low–high unit`, low-only as `≥ low unit`, high-only as `≤ high unit`, or null; never interpolate undefined; `interpretation` = `interpretation[0].text ?? coding.display`; `date` = `effectiveDateTime ?? effectivePeriod.start ?? issued`.
  - `DiagnosticReport` → `labs`: `name` = `code.text`, `value` = `conclusion ?? null`, `date` = `effectiveDateTime ?? issued`.
  - `Immunization` → `immunizations`: `name` = `vaccineCode.text ?? coding.display`, `code` = `vaccineCode.coding[0].code`, `status`, `date` = `occurrenceDateTime`, `manufacturer` = `manufacturer.display`, `lotNumber`.
  - Any other `resourceType`, or a resource missing a usable name/substance → `skipped += 1`.
  - `sourceRecordId` = resource `id`; `sourceName` = `meta.source ?? opts.sourceName`. Skip/count malformed resources or missing usable IDs/dates safely (missing date becomes null, not a skipped otherwise valid record). Drop any category outside opts.categories; `additionalItems` counts unsupported extra arrays, separately from skipped malformed supported records. FHIR DiagnosticReport inside the selected labs map remains the mapped lab conclusion; the excluded live `data.diagnosticReports` array is a different input shape.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/normalize/fhir.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/demo-records.json'
import { normalizeFhirRecordMap } from './fhir'
import { RECORD_CATEGORIES } from '../categories'

const opts = { mode: 'demo' as const, syncedAt: '2026-09-11T00:00:00Z', synthetic: true, sourceName: 'Northstar Health', categories: RECORD_CATEGORIES }

describe('normalizeFhirRecordMap', () => {
  const { records, skipped } = normalizeFhirRecordMap(fixture.record as Record<string, unknown[]>, opts)

  it('normalizes every category in the demo fixture', () => {
    const byCat = Object.groupBy(records, (r) => r.category)
    expect(byCat.demographics).toHaveLength(1)
    expect(byCat.medications).toHaveLength(2)
    expect(byCat.conditions).toHaveLength(2)
    expect(byCat.allergies).toHaveLength(1)
    expect(byCat.labs).toHaveLength(3)
    expect(byCat.vitals).toHaveLength(1)
    expect(byCat.immunizations).toHaveLength(2)
    expect(skipped).toBe(0)
    expect(records.every((r) => r.synthetic && r.syncedAt === opts.syncedAt)).toBe(true)
  })

  it('maps the patient', () => {
    const p = records.find((r) => r.category === 'demographics')!
    expect(p).toMatchObject({ id: 'demo:demographics:patient-demo-001', name: 'Morgan Rivera', birthDate: '1988-04-17', gender: 'female' })
    expect((p as any).address).toContain('Demo City')
  })

  it('maps a medication with dosage text and RxNorm coding', () => {
    const m = records.find((r) => r.id === 'demo:medications:medication-demo-001')!
    expect(m).toMatchObject({ name: 'Metformin 500 mg tablet', status: 'active', startDate: '2026-07-18' })
    expect((m as any).dosage).toMatch(/twice daily/)
    expect(m.codes[0]).toMatchObject({ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '861007' })
  })

  it('routes observations to labs or vitals and flattens blood pressure', () => {
    const a1c = records.find((r) => r.id === 'demo:labs:observation-demo-a1c')!
    expect(a1c).toMatchObject({ category: 'labs', name: 'Hemoglobin A1c', value: 6.4, unit: '%', date: '2026-07-18T15:30:00Z' })
    const bp = records.find((r) => r.category === 'vitals')!
    expect((bp as any).value).toBe('124/78')
    expect((bp as any).unit).toBe('mmHg')
  })

  it('identifies BP by LOINC after component order is reversed', () => {
    const reversed = structuredClone(fixture.record) as any
    reversed.vitals[0].component.reverse()
    expect(normalizeFhirRecordMap(reversed, opts).records.find((r) => r.category === 'vitals')).toMatchObject({ value: '124/78', unit: 'mmHg' })
  })

  it('keeps unrelated components labeled and one-sided ranges readable', () => {
    const observation = { resourceType: 'Observation', id: 'other', code: { text: 'Other measurements' }, category: [{ coding: [{ code: 'laboratory' }] }], component: [
      { code: { text: 'A', coding: [{ system: 'http://loinc.org', code: '1111-1' }] }, valueQuantity: { value: 2, unit: 'u' } },
      { code: { text: 'B', coding: [{ system: 'http://loinc.org', code: '2222-2' }] }, valueQuantity: { value: 3, unit: 'u' } },
    ] }
    for (const [range, expected] of [[{ low: { value: 1, unit: 'u' } }, '≥ 1 u'], [{ high: { value: 4, unit: 'u' } }, '≤ 4 u']] as const) {
      const record = normalizeFhirRecordMap({ labs: [{ ...observation, referenceRange: [range] }] }, opts).records[0] as any
      expect(record.value).toBe('A: 2 u, B: 3 u')
      expect(record.referenceRange).toBe(expected)
      expect(record.date).toBeNull()
    }
    expect(normalizeFhirRecordMap({ labs: [null, {}, 42] }, opts).records).toEqual([])
  })

  it('skips unknown resource types and observations without a category', () => {
    const { records: r, skipped: s } = normalizeFhirRecordMap(
      { labs: [{ resourceType: 'Procedure', id: 'p1' }, { resourceType: 'Observation', id: 'o1', code: { text: 'X' } }] },
      opts,
    )
    expect(r).toHaveLength(0)
    expect(s).toBe(2)
  })
})
```

Use locked TypeScript 5.9.3. Add `resolveJsonModule: true` and set `lib` to `['ES2024', 'DOM', 'DOM.Iterable']` in compilerOptions; keep existing target/module settings. Include tsconfig.json in this task's modified files.

- [ ] **Step 2: Run to verify it fails, implement `fhir.ts` per the mapping rules, run to verify it passes**

Run: `cd app && npx vitest run src/records/normalize/fhir.test.ts && npx tsc --noEmit`
Expected: fixture mapping, exact/reversed BP, incompatible-unit handling, labeled components, one-sided ranges, malformed resources and missing dates pass; no type errors. Add an incompatible-unit BP case that must stay labeled.

- [ ] **Step 3: Commit**

```bash
git add app/src/records app/tsconfig.json
git commit -m "Normalize FHIR R4 resources from the FinchNode demo API"
```

### Task 15: FinchNode normalized-record normalizer (live API shape)

**Files:**
- Create: `app/src/records/normalize/finchnode.ts`, `app/src/records/__fixtures__/finchnode-health-record.json`
- Test: `app/src/records/normalize/finchnode.test.ts`

**Interfaces:**
- Produces `normalizeFinchnodeHealthRecord(record: FinchnodeHealthRecord, opts: { syncedAt: string; categories: readonly RecordCategory[] }): NormalizeResult & SyncDetails & { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[] }`. Validate the input fields from the vendored HealthRecord schema; use unknown values at the untrusted boundary instead of spreading upstream objects. Preserve meta.availableCategories/missingCategories and meta.syncStatus; set `sync.status` from meta.syncStatus, `grantedCategories` to opts.categories ∩ record.categories, and failure to null (the snapshot schema has no failure field; session/HTTP failures are handled separately).
- Require live IDs matching `^rec_[a-f0-9]{24}$`, and use `recordId('live', category, rec.id)` as local identity. Preserve separate nullable sourceRecordId. Skip/count records without a stable ID or usable name/substance; never use array index fallback. Validate every category field explicitly, filling absent nullable fields with null. Dates use medications.startDate, conditions.onsetDate ?? recordedDate, labs/vitals.date, allergies.recordedDate, immunizations.date, demographics.birthDate. Validate codes individually; sourceName uses a valid string sourceName/source only; synthetic is false.
- Observation values: finite number, string or null directly; convert other JSON to deterministic safe display text (`JSON.stringify` for objects/arrays, string for booleans), with failed/nonfinite conversion becoming null. Render as text, never HTML. Demographics null produces no rows; object-only produces a valid row; nested records are normalized separately and deduplicated by upstream ID (prefer the nested row on duplicate). Never persist the nested records array inside a row. Missing arrays are empty. Drop records outside opts.categories before returning; neither malformed extras nor upstream categories can broaden the selection.
- Open-question decision: do not display live `medicationAdministrations`, `medicationDispenses`, `diagnosticReports`, encounters, appointments, careTeam, documents, clinicalNotes or claims arrays in v1. Sum their received array lengths (including nested claims arrays) into `additionalItems`, separate from `skipped`. Persist only that count and display "n additional items from your provider are not shown yet" on the source card. This does not change Task 14's FHIR DiagnosticReport mapping inside selected demo labs.

- [ ] **Step 1: Write the fixture**

`finchnode-health-record.json`: hand-write one `HealthRecord` following the vendored schema with `id: "u_0123456789abcdef"`, `categories` = all seven, `consent.receiptIds: ["rcpt_ABC123"]`, `sources: [{ system: "epic", organization: "Example Medical Center", lastSyncedAt: "2026-09-10T12:00:00Z" }]`, `data` with one record in each of the six available categories, `immunizations: []` (ids `rec_` + 24 hex), `meta.syncStatus: "partial"`, `meta.warnings: [{ code: "category_unavailable", message: "Immunizations were not available from this source.", category: "immunizations", retryable: false }]`, `meta.availableCategories` = the six other categories, `meta.missingCategories: ["immunizations"]`, `meta.changeCursor: "cur_1"`, `meta.disclaimer: "…"`. Fill every required field from the schema, including consent.receipts and metadata, with plausible values (nulls where allowed). Add two medicationAdministrations, one medicationDispense and one diagnosticReport as unsupported-array fixtures; expect six displayed records and additionalItems = 4, with no immunization record contradicting missingCategories.

- [ ] **Step 2: Write the failing test**

```ts
// app/src/records/normalize/finchnode.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/finchnode-health-record.json'
import { normalizeFinchnodeHealthRecord } from './finchnode'
import { RECORD_CATEGORIES } from '../categories'

describe('normalizeFinchnodeHealthRecord', () => {
  const out = normalizeFinchnodeHealthRecord(fixture as any, { syncedAt: '2026-09-11T00:00:00Z', categories: RECORD_CATEGORIES })

  it('validates normalized records with stable live ids and no synthetic flag', () => {
    expect(out.records).toHaveLength(6)
    expect(out.records.some((r) => r.category === 'immunizations')).toBe(false)
    expect(out.additionalItems).toBe(4)
    expect(out.records.every((r) => r.id.startsWith('live:') && r.synthetic === false)).toBe(true)
    const med = out.records.find((r) => r.category === 'medications') as any
    expect(med.name).toBeTruthy()
    expect(med.date).toBe(med.startDate)
  })

  it('surfaces sources, consent receipts, sync status and warnings', () => {
    expect(out.sources[0]).toMatchObject({ system: 'epic', organization: 'Example Medical Center' })
    expect(out.consentReceiptIds).toEqual(['rcpt_ABC123'])
    expect(out.syncStatus).toBe('partial')
    expect(out.warnings[0]).toMatchObject({ code: 'category_unavailable', category: 'immunizations' })
  })

  it('handles explicit null, object-only and duplicate nested demographics', () => {
    const person = fixture.data.demographics
    const normalize = (demographics: unknown) => normalizeFinchnodeHealthRecord(
      { ...fixture, data: { demographics } } as any,
      { syncedAt: '2026-09-11T00:00:00Z', categories: ['demographics'] },
    ).records
    expect(normalize(null)).toEqual([])
    expect(normalize(person)).toHaveLength(1)
    const nested = normalize({ ...person, records: [person, { ...person, id: 'rec_ffffffffffffffffffffffff' }] })
    expect(nested).toHaveLength(2)
    expect(nested.every((r) => !('records' in r))).toBe(true)
  })

  it('converts object observations and skips unstable IDs', () => {
    const lab = fixture.data.labs[0]
    const result = normalizeFinchnodeHealthRecord({ ...fixture, data: { labs: [
      { ...lab, value: { amount: 3, qualifier: 'estimated' } },
      { ...lab, id: null }, { ...lab, id: 'not-stable' },
    ] } } as any, { syncedAt: 'now', categories: ['labs'] })
    expect(result.records).toHaveLength(1)
    expect((result.records[0] as any).value).toBe('{"amount":3,"qualifier":"estimated"}')
    expect(result.skipped).toBe(2)
    expect(result.records[0].sourceRecordId).toBe(lab.sourceRecordId)
  })

  it('tolerates missing arrays and skips nameless records', () => {
    const r = normalizeFinchnodeHealthRecord({ ...fixture, data: { medications: [{ id: 'rec_000000000000000000000000' }] } } as any, { syncedAt: 'now', categories: RECORD_CATEGORIES })
    expect(r.records).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })
})
```

- [ ] **Step 3: Run to verify it fails, implement, run to verify it passes**

Run: `cd app && npx vitest run src/records/normalize/finchnode.test.ts` → all stated behaviors pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/records
git commit -m "Normalize FinchNode health-record snapshots"
```

### Task 16: Records providers (demo direct, live via relay)

**Files:**
- Create: `app/src/records/providers/types.ts`, `app/src/records/providers/demo.ts`, `app/src/records/providers/relay.ts`, `app/src/records/providers/http.ts`
- Test: `app/src/records/providers/demo.test.ts`, `app/src/records/providers/relay.test.ts`

**Interfaces:**

```ts
// app/src/records/providers/types.ts
import type { NormalizeResult, RecordCategory, RecordsMode, RecordsSource, RecordsWarning, SyncDetails } from '../types'
export interface ConnectStart { sessionId: string; redirectUrl: string | null; expiresAt: string | null; completed: boolean; subject: string | null }
export type SessionStatus = 'pending' | 'collect-consented' | 'system-selected' | 'completed' | 'abandoned' | 'canceled' | 'expired' | 'failed'
export interface ConnectSessionState extends SyncDetails { id: string; status: SessionStatus; subject: string | null; warnings: RecordsWarning[]; expiresAt: string | null; retryAfterSeconds?: number | null }
export interface RecordsSnapshot extends NormalizeResult, SyncDetails { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[]; synthetic: boolean }
export interface RecordsProvider {
  mode: RecordsMode
  startConnect(input: { categories: RecordCategory[]; returnUrl: string; externalId: string }): Promise<ConnectStart>
  getSession(sessionId: string): Promise<ConnectSessionState>
  fetchSnapshot(subject: string, categories: RecordCategory[]): Promise<RecordsSnapshot>
}
export class RecordsHttpError extends Error { constructor(message: string, public status: number, public retryAfterSeconds: number | null, public code: string | null) { super(message) } }
```

```ts
// app/src/records/providers/http.ts
import { RecordsHttpError } from './types'
export interface HttpDeps { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; onResponse?: (headers: Headers) => void }
/** JSON fetch that never leaks response bodies into thrown messages. */
export async function requestJson<T>(url: string, init: RequestInit & HttpDeps = {}): Promise<T> {
  const { fetch: doFetch = fetch, timeoutMs = 10_000, signal, onResponse, ...request } = init
  const deadline = AbortSignal.timeout(timeoutMs)
  const res = await doFetch(url, {
    ...request, signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    headers: { accept: 'application/json', ...(request.headers ?? {}) },
    credentials: 'omit', cache: 'no-store', redirect: 'error',
  })
  onResponse?.(res.headers)
  if (!res.ok) {
    let code: string | null = null
    try { code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? null } catch { /* ignore */ }
    const retry = res.headers.get('retry-after')
    throw new RecordsHttpError(friendlyStatus(res.status), res.status, parseRetryAfter(retry), code)
  }
  return (await res.json()) as T
}
export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1_000
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null
}
export function friendlyStatus(status: number): string {
  if (status === 429) return 'The records service is busy. Try again in a minute.'
  if (status === 401 || status === 403) return 'The records service refused the request. Check the relay settings.'
  if (status === 404) return 'The records service could not find this connection.'
  if (status === 410) return 'This connection has expired. Start again to reconnect.'
  return 'The records service is unavailable right now.'
}
```

- `demo.ts`: export `DEMO_BASE_URL = 'https://api.finchnode.com/demo/v1'`, `DEMO_PATIENT_ID = 'patient-demo-001'`, `createDemoProvider(deps?: HttpDeps): RecordsProvider`. Validate nonempty unique supported categories for creation and reads. POST `{ external_user_id: externalId, categories }`; return the completed ConnectStart with DEMO_PATIENT_ID. Retain categories for the local completed getSession result (granted/available = requested; missing = []; sync.status = complete; failure = null). GET `/patients/${subject}/records?categories=…` always includes the validated effective filter. Pass it as opts.categories to normalizeFhirRecordMap, and enforce it again on the result. Return complete RecordsSnapshot with sync.status complete, requested granted/available categories, missing [], failure null, synthetic true and the sample source. Map demo 429 to "FinchNode's sample API is busy, try again in a minute" and retain Retry-After.
- `relay.ts`: `createRelayProvider(config: { baseUrl: string; token: string }, deps?: HttpDeps): RecordsProvider`. Parse base with `new URL`; allow HTTPS or HTTP only when hostname is exactly localhost/127.0.0.1. Reject credentials, query and fragment; strip trailing slashes to canonicalize. Require a nonempty token and send X-Lunara-Relay-Token on every request. The caller verifies the vault token's relayBaseUrl matches this URL. Export/reuse the pure URL canonicalizer for Settings/import. Reject credential-bearing or non-HTTPS Hosted Connect redirect URLs before navigation.
- Relay POST `/v1/connect/sessions` sends `{ categories, returnUrl, externalId }` and maps id/url/expiresAt to ConnectStart. GET `/v1/connect/sessions/${id}` validates the session ID and preserves sync.status, sync.grantedCategories, sync.availableCategories, sync.missingCategories, sync.failure, warnings and expiresAt in ConnectSessionState. Filter received category metadata only to supported categories, never replace an empty grant with selected/all categories. Expose successful response Retry-After through HttpDeps.onResponse (already removed from fetch init by the helper), so polling respects it as well as error Retry-After.
- Relay GET `/v1/users/${subject}/records?categories=…` validates subject and the nonempty effective category list, passes opts.categories to normalizeFinchnodeHealthRecord, and returns synthetic false with all snapshot completeness metadata. `RecordsSnapshot.sync.status` comes from meta.syncStatus; failure is null because this response schema lacks it, while the orchestrator retains/checks session failure before reads. No normalizer may return an unselected category. Use the same request deadline/abort helper for creation, polls and snapshots; polling clips per-request timeout to its remaining overall deadline.

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/records/providers/demo.test.ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../__fixtures__/demo-records.json'
import { createDemoProvider, DEMO_BASE_URL, DEMO_PATIENT_ID } from './demo'

function fakeFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { status = 200, body = {}, headers = {} } = handler(String(input), init)
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }) as unknown as typeof fetch
}

describe('demo provider', () => {
  it('simulates a completed connect session', async () => {
    const fetch = fakeFetch((url, init) => {
      expect(url).toBe(`${DEMO_BASE_URL}/connect/sessions`)
      expect(JSON.parse(String(init?.body))).toEqual({ external_user_id: 'abcdefghijklmnop', categories: ['labs'] })
      return { body: { id: 'demo_cs_1', status: 'completed' } }
    })
    const p = createDemoProvider({ fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'http://localhost/', externalId: 'abcdefghijklmnop' })).toMatchObject({ completed: true, subject: DEMO_PATIENT_ID, redirectUrl: null })
  })

  it('fetches and normalizes the synthetic snapshot', async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(`${DEMO_BASE_URL}/patients/${DEMO_PATIENT_ID}/records?categories=labs,vitals`)
      return { body: fixture }
    })
    const snap = await createDemoProvider({ fetch }).fetchSnapshot(DEMO_PATIENT_ID, ['labs', 'vitals'])
    expect(snap.synthetic).toBe(true)
    expect(snap.records).toHaveLength(4) // three labs and one vital in the demo fixture
    expect(new Set(snap.records.map((r) => r.category))).toEqual(new Set(['labs', 'vitals']))
    expect(snap.sources[0].organization).toContain('Northstar')
  })

  it('turns 429 into a friendly retryable error', async () => {
    const fetch = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '30' }, body: { error: { type: 'api_error', code: 'rate_limited', message: 'Busy', requestId: 'req_demo' } } }))
    await expect(createDemoProvider({ fetch }).fetchSnapshot(DEMO_PATIENT_ID, ['labs'])).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30, code: 'rate_limited' })
  })
})
```

```ts
// app/src/records/providers/relay.test.ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../__fixtures__/finchnode-health-record.json'
import { createRelayProvider } from './relay'

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

describe('relay provider', () => {
  it('rejects insecure relay urls', () => {
    expect(() => createRelayProvider({ baseUrl: 'http://relay.example.com', token: 'tok' })).toThrow(/https/)
  })

  it.each(['http://localhost.evil', 'http://127.0.0.1.evil', 'https://user:pass@relay.test', 'https://relay.test/?token=x', 'https://relay.test/#x'])(
    'rejects hostile or credential-bearing base %s', (baseUrl) => {
      expect(() => createRelayProvider({ baseUrl, token: 'tok' })).toThrow()
    },
  )
  it('requires a token before requesting anything', () => {
    const fetch = vi.fn()
    expect(() => createRelayProvider({ baseUrl: 'https://relay.test', token: '' }, { fetch })).toThrow(/token/i)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('starts a hosted connect session with the token header', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://relay.example.com/v1/connect/sessions')
      expect(new Headers(init.headers).get('x-lunara-relay-token')).toBe('tok')
      expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store', redirect: 'error' })
      expect(JSON.parse(String(init.body))).toEqual({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'abcdefghijklmnop' })
      return ok({ id: 'cs_0123456789abcdef0123', url: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', status: 'pending' })
    }) as unknown as typeof fetch
    const p = createRelayProvider({ baseUrl: 'https://relay.example.com/', token: 'tok' }, { fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'abcdefghijklmnop' })).toEqual({ sessionId: 'cs_0123456789abcdef0123', redirectUrl: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', completed: false, subject: null })
  })

  it('reads session state', async () => {
    const fetch = vi.fn(async () => ok({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'queued', grantedCategories: ['labs', 'claims'], availableCategories: [], missingCategories: ['labs'], failure: null, warnings: [] } })) as unknown as typeof fetch
    const s = await createRelayProvider({ baseUrl: 'https://r', token: 'tok' }, { fetch }).getSession('cs_0123456789abcdef0123')
    expect(s).toMatchObject({ status: 'completed', subject: 'u_0123456789abcdef', sync: { status: 'queued' }, grantedCategories: ['labs'], availableCategories: [], missingCategories: ['labs'], failure: null })
  })

  it('fetches and normalizes a live snapshot', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://r/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
      return ok(fixture)
    }) as unknown as typeof fetch
    const snap = await createRelayProvider({ baseUrl: 'https://r', token: 'tok' }, { fetch }).fetchSnapshot('u_0123456789abcdef', ['labs', 'vitals'])
    expect(snap.synthetic).toBe(false)
    expect(snap.records).toHaveLength(2)
    expect(new Set(snap.records.map((r) => r.category))).toEqual(new Set(['labs', 'vitals']))
    expect(snap.consentReceiptIds).toEqual(['rcpt_ABC123'])
  })
})
```

- [ ] **Step 2: Run to verify they fail, implement the four files, run to verify they pass**

Add tests for non-HTTPS/credential-bearing Hosted Connect redirects; empty, duplicate and unsupported filters on both providers (fetch never called); exact localhost acceptance; deadline/abort handling; Retry-After seconds and dates on successful polls/errors. Use full upstream error envelopes `{ error: { type, code, message, requestId } }` in fixtures.

Run: `cd app && npx vitest run src/records/providers` → all provider, category and HTTP boundary behaviors pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/records/providers
git commit -m "Add FinchNode demo and relay record providers"
```

### Task 17: Sealed records store (Dexie v4)

**Files:**
- Modify: `app/src/db/schema.ts` (version 4 + tables + `SK.recordsRelayUrl`, medical-records ConsentPurpose used by commit guards), `app/src/screens/Settings.tsx` (extend Task 6 wipe invalidation)
- Create: `app/src/records/store.ts`
- Test: `app/src/records/store.test.ts`

**Interfaces:**
- `schema.ts` adds:
  ```ts
  export interface SealedRecordRow { id: string; category: RecordCategory; date: string | null; sealed: SealedBlob }
  // Add class properties to LunaraDB:
  // medicalRecords!: Table<SealedRecordRow, string>
  // recordsConnection!: Table<RecordsConnection, string>
  // Append this.version(4).stores(v4Stores) after existing versions in its constructor.
  const v4Stores = {
    dailyLogs: 'date', cycles: 'startDate', settings: 'key', contentBookmarks: 'slug',
    healthProfiles: 'id', regimenRecords: 'id, method, startDate, [method+startDate]',
    missedDoseEvents: 'id, regimenId, date, [regimenId+date]',
    medicalRecords: 'id, category, date', recordsConnection: 'id',
  }
  ```
  and `SK.recordsRelayUrl: 'recordsRelayUrl'`.
- `store.ts` produces `getConnection(): Promise<RecordsConnection>` (read-only; absent row returns default without writing), `putConnection(patch: ConnectionPatch): Promise<boolean>`, `putSnapshot(records: MedicalRecord[], categoriesToReplace: RecordCategory[], patch: ConnectionPatch): Promise<boolean>`, `listRecords(category?)`, `countByCategory()`, `clearRecords(): Promise<void>`, and `defaultConnection(): RecordsConnection`. `ConnectionPatch = Partial<Omit<RecordsConnection, 'id' | 'generation'>> & { expectedGeneration: number }`; strip expectedGeneration before storage. Async updates must use guarded putConnection/putSnapshot, never raw state writes.
- `defaultConnection` is `{ id: 'primary', mode: 'demo', status: 'disconnected', generation: 0, relayBaseUrl: null, categories: [...RECORD_CATEGORIES], grantedCategories: [], availableCategories: [], missingCategories: [], sources: [], consentReceiptIds: [], warnings: [], additionalItems: 0 }`. `clearRecords` increments the current generation in a transaction, clears rows and replaces the connection with a disconnected default carrying the new generation. Retain this nonpersonal tombstone even through full wipe so an old generation cannot be reused. `getConnection` and liveQuery never bootstrap a row.
- Acquire Task 2's shared vault lifecycle for key access, sealing and commit. Prepare sealed rows before opening the Dexie transaction; list fetches rows and decrypts outside transactions under the same shared lifecycle. `putSnapshot` uses one rw transaction including medicalRecords, recordsConnection, healthProfiles and settings. Re-read the current connection and latest medical-records consent inside that transaction. If generation differs from expectedGeneration or consent is no longer granted, return false with no writes, including error/connection writes. Also reject live writes with a stale relay binding. Otherwise delete categoriesToReplace, bulkPut only records in that list, and merge patch. `putConnection` uses the same transaction guard for metadata/error commits. No WebCrypto await inside a transaction.
- For complete snapshots categoriesToReplace = selected ∩ granted. For partial, use effective ∩ meta.availableCategories, retaining every missing category's prior rows as "not refreshed". For not_started, write no record rows and no completed-import time; use only guarded metadata state. Delete consent-removed categories in the transaction changing the local selection. Validate category boundaries again before persistence. Task 19 computes replacement sets; the store never infers them from which records happened to arrive.
- Add a synchronous-in-transaction transition helper for deliberate begin/cancel/disconnect/wipe changes: read current row, increment generation, update consent/connection and optionally clear rows in one Dexie transaction. This path is distinct from guarded async completion writes; start still requires granted consent inside the transaction. Add medical-records to ConsentPurpose here so these guards typecheck; Task 18 adds ledger initialization and transfer support.
- Extend the Task 6 Settings wipe now: stop scheduler first, transactionally increment generation, remove personal connection state and consent, then abort requests/polls and clear data/vault in destroySecureVault's clearAppData callback under the exclusive lifecycle lock. No late result may recreate records/errors. Record clearing inside wipe preserves the tombstone and does not call guarded putSnapshot. Cancel/disconnect similarly invalidate before aborting. Tasks 18 and 19 reuse these primitives.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/store.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, putHealthProfile } from '../db/schema'
import { deleteKeyStore } from '../platform/keyStore'
import type { MedicalRecord } from './types'
import { clearRecords, countByCategory, getConnection, listRecords, putConnection, putSnapshot } from './store'

const lab = (id: string, date: string | null): MedicalRecord => ({ id: `demo:labs:${id}`, category: 'labs', sourceRecordId: id, sourceName: 'S', date, codes: [], syncedAt: 'now', synthetic: true, name: `Lab ${id}`, value: 1, unit: 'u', status: 'final', referenceRange: null, interpretation: null })
const med = (id: string): MedicalRecord => ({ id: `demo:medications:${id}`, category: 'medications', sourceRecordId: id, sourceName: 'S', date: '2026-01-01', codes: [], syncedAt: 'now', synthetic: true, name: `Med ${id}`, dosage: null, frequency: null, status: 'active', startDate: '2026-01-01', endDate: null, prescriber: null, reason: null })

describe('records store', () => {
  beforeEach(async () => {
    installLifecycleLocks()
    await clearRecords()
    await deleteKeyStore()
    await putHealthProfile({ privacy: { consentLedger: [{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt: '2026-09-11T00:00:00Z' }] } })
  })

  it('starts disconnected with all categories selected', async () => {
    expect(await getConnection()).toMatchObject({ id: 'primary', status: 'disconnected', categories: expect.arrayContaining(['labs', 'vitals']) })
  })

  it('stores sealed rows and reads them back sorted by date', async () => {
    await putSnapshot([lab('a', '2026-02-01'), lab('b', null), lab('c', '2026-03-01')], ['labs'], { status: 'connected', mode: 'demo', expectedGeneration: (await getConnection()).generation })
    const raw = await db.medicalRecords.toArray()
    expect(JSON.stringify(raw)).not.toContain('Lab a')
    expect(raw[0].sealed.v).toBe(1)
    const labs = await listRecords('labs')
    expect(labs.map((r) => r.sourceRecordId)).toEqual(['c', 'a', 'b'])
    expect((await getConnection()).status).toBe('connected')
  })

  it('refresh replaces only the refreshed categories', async () => {
    await putSnapshot([lab('a', '2026-02-01'), med('m1')], ['labs', 'medications'], { expectedGeneration: (await getConnection()).generation })
    await putSnapshot([lab('z', '2026-04-01')], ['labs'], { expectedGeneration: (await getConnection()).generation })
    expect(await countByCategory()).toMatchObject({ labs: 1, medications: 1 })
    expect((await listRecords('labs'))[0].sourceRecordId).toBe('z')
  })

  it('clearRecords empties records and keeps a disconnected generation tombstone', async () => {
    await putSnapshot([med('m1')], ['medications'], { status: 'connected', expectedGeneration: (await getConnection()).generation })
    await putConnection({ subject: 'u_x', expectedGeneration: (await getConnection()).generation })
    await clearRecords()
    expect(await db.medicalRecords.count()).toBe(0)
    expect((await getConnection()).status).toBe('disconnected')
  })
})

afterEach(() => vi.unstubAllGlobals())

```

- [ ] **Step 2: Run to verify it fails, implement schema v4 + `store.ts`, run to verify it passes**

Add these behavior tests with real fake-indexeddb/Dexie databases:

- Open an actual version-3 database using all seven historical table definitions; insert representative rows into dailyLogs, settings, contentBookmarks, healthProfiles, regimenRecords, missedDoseEvents and cycles. Close it, reopen with v4 and assert every existing row survives and both new tables exist. Do not merely open the current schema on a blank database.
- Subscribe liveQuery(getConnection) on a database with no connection row; assert emission of the default, zero recordsConnection writes (instrument hooks) and no feedback loop. Unsubscribe/close in cleanup.
- Seed labs plus medications, apply a partial snapshot replacing only available labs, and assert missing medications remain byte-for-byte. Apply a complete empty labs snapshot and assert labs clear; a not_started result leaves rows and lastSyncAt unchanged.
- Capture a generation, suspend sealing, clear/disconnect/wipe from an independent Dexie client, then release sealing; for wipe, start its promise, wait only for generation invalidation, release the suspended seal, then await both operations (destruction waits on the shared lifecycle). putSnapshot and an error putConnection with the old generation return false and neither records nor error state reappear. Repeat with consent revoked without a generation change to prove the transaction consent check independently. Use the shared vault lifecycle test LockManager.

Run: `cd app && npx vitest run src/records/store.test.ts src/db && npx tsc --noEmit` → migration, no-write reads, replacement and invalidation behaviors pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/db/schema.ts app/src/records/store.ts app/src/records/store.test.ts app/src/screens/Settings.tsx
git commit -m "Store medical records sealed at rest in Dexie v4"
```

### Task 18: Consent purpose and export/import v2

**Files:**
- Modify: `app/src/db/schema.ts` (ConsentPurpose already extended in Task 17), `app/src/db/transfer.ts`, `app/src/screens/Onboarding.tsx` (ledger seeding)
- Test: `app/src/db/transfer.test.ts` (new)

**Interfaces:**
- Task 17 adds `'medical-records'` to ConsentPurpose for its guard. In this task, seed a not-requested medical-records entry from Onboarding using the existing ledger conventions. A restored ledger from the user's own export is their decision; do not replace granted consent with a different authorization rule.
- `ExportPayloadV2` contains `{ app: 'lunara'; v: 2; exportedAt; dailyLogs; settings; contentBookmarks; healthProfiles; regimenRecords; missedDoseEvents; medicalRecords: MedicalRecord[]; recordsConnection: Omit<RecordsConnection, 'pendingSession' | 'creationAttempt'> | null }`. Validate all table arrays and record/connection fields, app and supported version before any write. Keep accepting v1 without new tables. `collectExport` opens records, exports the actual connection even when it is disconnected but has a viewable snapshot, drops pending/creation state, and returns null for an absent/logically empty generation tombstone. Never drop a connection merely because medicalRecords is empty.
- Exclude from both exported and imported settings:
  ```ts
  const SECRET_KEYS = new Set<string>([
    SK.pinSalt, SK.pinHash, SK.aiKey, 'recoveryCode',
    SK.biometricLock, SK.deviceUnlockCredential,
  ])
  ```
  Never serialize vault values, raw keys or relay credentials. Validate/canonicalize an exportable SK.recordsRelayUrl without credentials; importing it never activates a connection or reuses a token for another endpoint.
- Validate the whole payload first. Under the shared vault lifecycle, seal imported medical rows before any Dexie transaction. Use ONE rw transaction with every imported table: dailyLogs, settings, contentBookmarks, healthProfiles, regimenRecords, missedDoseEvents, medicalRecords and recordsConnection (plus any existing transfer-owned table). Do not call putSnapshot or any WebCrypto operation inside that transaction. Preserve existing legacy merge semantics for legacy tables. V1 preserves existing medical rows and connection (except the mandatory disconnect if importing a changed relay setting). V2 clears and replaces the entire medical snapshot, including `[]`, and the entire logical connection, including null; replace canonical profile/regimen/adherence tables including empty arrays. Throwing inside the transaction rolls back all imported table changes.
- Imported non-null connections get importedAt, a fresh local generation, no pendingSession/creationAttempt and status disconnected; keep subject, sources, category metadata and records for local viewing. Null yields a fresh disconnected generation tombstone with no imported identifying metadata. Explicit start can use the restored granted ledger; importing itself performs no network operation. Refresh requires an enabled connection, granted consent, subject, current canonical relayBaseUrl equality and a matching saved token. Changing/importing a different relay URL invalidates the existing live generation, disables refresh while preserving records, and deletes the old endpoint's token from the vault after the settings transaction; if token cleanup fails, report it and leave the connection disabled. A stale token envelope cannot be used because its binding differs.

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/db/transfer.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, SK, getSetting } from './schema'
import { clearRecords, defaultConnection, getConnection, listRecords } from '../records/store'
import type { MedicalRecord } from '../records/types'
import { applyImport, collectExport, type ExportPayloadV2 } from './transfer'

const cond: MedicalRecord = { id: 'live:conditions:rec_000000000000000000000001', category: 'conditions', sourceRecordId: 'provider-source-1', sourceName: 'Clinic', date: '2021-03-12', codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: false, name: 'Example condition', status: 'active', verificationStatus: 'confirmed', severity: null, onsetDate: '2021-03-12', recordedDate: null }
const connection = { ...defaultConnection(), mode: 'live' as const, status: 'connected' as const, relayBaseUrl: 'https://relay.test', categories: ['conditions'] as const, subject: 'u_0123456789abcdef' }
// Use mutable categories in the actual ExportPayloadV2 factory.
const payload = (): ExportPayloadV2 => ({ app: 'lunara' as const, v: 2 as const, exportedAt: '2026-09-11T00:00:00Z', dailyLogs: [], settings: [], contentBookmarks: [], healthProfiles: [], regimenRecords: [], missedDoseEvents: [], medicalRecords: [cond], recordsConnection: { ...connection, categories: [...connection.categories] } })

beforeEach(async () => {
    installLifecycleLocks()
  for (const table of db.tables) await table.clear()
})

describe('transfer v2', () => {
  it('restores a viewable snapshot with an imported disconnected connection', async () => {
    await applyImport(payload())
    expect(await listRecords('conditions')).toEqual([cond])
    expect(await getConnection()).toMatchObject({ status: 'disconnected', subject: connection.subject, relayBaseUrl: connection.relayBaseUrl, importedAt: expect.any(String) })
    const exported = await collectExport()
    expect(exported.medicalRecords).toEqual([cond])
    expect(exported.recordsConnection).not.toBeNull()
    expect(exported.recordsConnection).not.toHaveProperty('pendingSession')
    expect(exported.recordsConnection).not.toHaveProperty('creationAttempt')
  })

  it('replaces populated data with empty arrays and preserves an empty connection snapshot', async () => {
    await applyImport(payload())
    await applyImport({ ...payload(), medicalRecords: [] })
    expect(await listRecords()).toEqual([])
    expect((await collectExport()).recordsConnection).toMatchObject({ subject: connection.subject })
    await applyImport({ ...payload(), medicalRecords: [], recordsConnection: null })
    expect((await collectExport()).recordsConnection).toBeNull()
    expect((await getConnection()).status).toBe('disconnected')
  })

  it('v1 preserves existing medical records and their connection', async () => {
    await applyImport(payload())
    const before = await getConnection()
    await applyImport({ app: 'lunara', v: 1, exportedAt: '2026-09-11T00:00:00Z', dailyLogs: [], settings: [], contentBookmarks: [] })
    expect(await listRecords()).toEqual([cond])
    expect(await getConnection()).toEqual(before)
  })

  it.each([SK.pinSalt, SK.pinHash, SK.aiKey, 'recoveryCode', SK.biometricLock, SK.deviceUnlockCredential])(
    'excludes security setting %s on export and import', async (key) => {
      await db.settings.put({ key, value: 'local-secret' })
      expect((await collectExport()).settings.some((row) => row.key === key)).toBe(false)
      await applyImport({ ...payload(), settings: [{ key, value: 'imported-secret' }] })
      expect(await getSetting(key)).not.toBe('imported-secret')
      expect(JSON.stringify(await collectExport())).not.toContain('local-secret')
    },
  )

  it.each([{ app: 'other', v: 2 }, { app: 'lunara', v: 3 }])('rejects invalid app/version before writes: %j', async (bad) => {
    await applyImport(payload())
    const before = await collectExport()
    await expect(applyImport({ ...payload(), ...bad } as any)).rejects.toThrow()
    expect((await collectExport()).medicalRecords).toEqual(before.medicalRecords)
  })
})

afterEach(() => vi.unstubAllGlobals())

```

Add full round-trip and atomicity cases using canonical schema fixtures, not cast-only skeletal rows:

- Seed populated demo and live snapshots in separate cases; import a different v2 snapshot and assert no old category/source/subject/pending state survives, including categories empty in the import. Preserve only the fresh local generation.
- Export a real health profile with granted medical-records ledger, regimenRecords and missedDoseEvents. Open a fresh database, import, and compare those canonical tables and opened records to the export; assert the ledger decision is restored, imported connection is viewable and no network ran.
- Inject a failing Dexie hook on the final imported table write; assert all prior dailyLogs/settings/bookmarks/profile/regimen/adherence/record/connection changes rolled back. Also verify malformed records and unsupported versions are rejected before sealing/writes.
- Include every excluded security key in one plaintext export/import fixture, plus saved vault secrets/relay-token envelope. Assert none of those values enter exported JSON and import never restores them; validated relay URL does round-trip.
- Change/import relay A to B with a connected A snapshot and saved A token; assert disconnected status, increased generation, retained records, removed token and zero refresh requests. Hostile-prefix, credentials/query/fragment URL imports reject before writing. Same-URL import does not copy or activate credentials.
Use Task 2's shared lifecycle test LockManager in this suite and close database handles on completion.

- [ ] **Step 2: Run to verify it fails, implement, run to verify it passes**

Run: `cd app && npx vitest run src/db/transfer.test.ts` → all stated behaviors pass. Also `npx tsc --noEmit` (Settings.tsx uses `applyImport`/`collectExport`; types still line up).

- [ ] **Step 3: Commit**

```bash
git add app/src/db app/src/screens/Onboarding.tsx
git commit -m "Add the medical-records consent purpose and export format v2"
```

### Task 19: Connection orchestration and return handling

**Files:**
- Create: `app/src/records/connect.ts`, `app/src/records/returnHandler.ts`
- Test: `app/src/records/connect.test.ts`, `app/src/records/returnHandler.test.ts`

**Interfaces:**

```ts
// connect.ts: public signatures; implement the transaction/state rules below.
export interface ConnectDeps {
  provider: RecordsProvider
  now?: () => string
  randomId?: () => string
  navigate?: (url: string) => void
  sleep?: (ms: number) => Promise<void>
  monotonicNow?: () => number // polling deadline; default performance.now
}
export async function grantRecordsConsent(): Promise<void>
export async function hasRecordsConsent(): Promise<boolean>
export async function startConnection(categories: RecordCategory[], deps: ConnectDeps): Promise<'connected' | 'redirected' | 'error'>
export async function completePendingConnection(params: ReturnParams, deps: ConnectDeps): Promise<RecordsConnection>
export async function syncSnapshot(deps: ConnectDeps): Promise<RecordsConnection>
export async function cancelConnection(): Promise<void>
export async function disconnectAndDelete(): Promise<void>
export function providerFor(connection: RecordsConnection, relay: { baseUrl: string | null; token: string | null; tokenRelayBaseUrl: string | null }): RecordsProvider
export class InvalidReturnError extends Error {
  constructor() { super('This link does not match a connection you started.') }
}
```

Implement in this order:

1. Consent uses the current health-profile ledger; grant replaces that purpose's entry with `{ purpose: 'medical-records', state: 'granted', version: 1, decidedAt }`. Before every network operation require consent and an enabled connection with the captured generation. Live also requires current canonical relay setting = connection.relayBaseUrl = saved token envelope.relayBaseUrl, plus a nonempty token. providerFor enforces that binding; it never sends a token or subject to a changed endpoint. Zero selected/effective categories makes no request.
2. startConnection validates categories, then transactionally increments generation and persists mode/categories/relay binding before creating anything. Demo sets its known subject and granted categories before calling syncSnapshot(deps). Live persists a random 16-byte base64url externalId and exact creation body in creationAttempt before POST. Return URL is exactly `${location.origin}/?records=return`, with nothing appended. Save the returned live pendingSession in a guarded transaction before navigate(redirectUrl); recheck current generation/consent before navigation. Reject unsafe redirect URLs. A failed sync returns 'error', not 'connected'.
3. Capture and strip return parameters synchronously in main.tsx before rendering/awaiting. completePendingConnection requires params.isReturn, !params.invalidSession, consent and a stored LIVE pendingSession whose connection binding equals current relay settings and token. If a session parameter is supplied it must equal pendingSession.id; only absence permits fallback. Otherwise throw InvalidReturnError for local UI copy, with no poll or database write. Consumed sessions, disconnect returns and no-pending returns cannot replay.
4. Capture the persisted generation before polling and pass expectedGeneration on EVERY asynchronous metadata, record and error commit. In the single Dexie write transaction re-read connection and current consent and return without any write if stale or revoked. A local AbortController stops local work promptly; safety across tabs comes from the persisted guard, without BroadcastChannel. Cancel, disconnect, start and wipe increment generation before aborting requests/timers. Cancel clears pending/creation state, sets disconnected and keeps cached rows viewable. Disconnect clears rows/identifying state and declines consent in that same invalidation transaction; keep the nonpersonal generation tombstone.
5. Poll every 2 seconds within a 60-second monotonic deadline while session status is not terminal OR sync.status is queued/syncing. Completed is session-terminal but queued/syncing is still polled. Terminal failures and failed/reauthorization_required sync take priority and exit to error; reauthorization copy is "Your provider needs you to sign in again. Start again to reconnect." Respect successful/error Retry-After without issuing requests before it elapses or beyond the deadline; clip HTTP timeouts to remaining budget. Terminal sessions clear pendingSession and offer Start again. Timeouts keep it and offer Check again. Persist subject and granted/available/missing categories and failure via guarded writes; snapshot failures retain subject and previous records for Refresh.
6. Effective = selected ∩ granted, additionally narrowed by snapshot scope; never broaden an empty grant to omitted categories. For complete snapshots call putSnapshot(records, effective, patch). For partial call putSnapshot(records filtered to replaceable categories, effective ∩ snapshot.availableCategories, patch); missing categories retain old rows and are marked not refreshed. For not_started make no record writes or lastSyncAt/connectedAt success update; retain pending when available and offer Check again. Categories whose selection/consent was removed are deleted in that selection-change transaction. On successful complete/partial commit set connected and clear pending/creation/error state while retaining completeness, source, warning, skipped/additional-item and granted metadata.
7. Creation, polling and snapshot failures go through ONE sanitized error function using guarded putConnection({ expectedGeneration, status: 'error', lastError, recoveryAction, ... }). Map only safe codes/status to copy; never persist raw response messages/stacks. Missing-consent/stale-generation preconditions cannot persist errors because the guard forbids all writes; return 'error' or the current connection and let the UI show the precondition. Invalid returns use InvalidReturnError without persistence. Terminal failures use start-again; timeout uses check-again; snapshot failure uses refresh. Preserve creationAttempt/externalId/body for retrying an ambiguous creation with unchanged categories/relay, even if a new local generation is allocated; definitive terminal failure clears creation state so Start again creates a new external ID. A selection/endpoint change is a new request, not an idempotent retry.
8. Deduplicate completion and refresh by generation with module-level promises. Concurrent same-page refresh calls return the same promise. For cross-tab refresh ordering, use a Web Lock keyed by generation, re-read generation/consent and lastSyncAt after acquiring it, and skip redundant queued work if another refresh committed since it was requested. Network waits do not hold an IndexedDB transaction. Task 20 additionally deduplicates StrictMode return effects by session ID.

```ts
// returnHandler.ts
export interface ReturnParams { isReturn: boolean; sessionId: string | null; invalidSession: boolean }
export function readReturnParams(search: string): ReturnParams {
  const params = new URLSearchParams(search)
  const ids = params.getAll('session')
  const isReturn = params.getAll('records').includes('return')
  const invalidSession = isReturn && (params.getAll('records').length !== 1
    || ids.length > 1 || (ids.length === 1 && !/^cs_[a-f0-9]{20}$/.test(ids[0])))
  return { isReturn, sessionId: ids.length === 1 ? ids[0] : null, invalidSession }
}
export function stripReturnParams(): void {
  const url = new URL(location.href)
  url.searchParams.delete('records')
  url.searchParams.delete('session')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/records/connect.test.ts
import 'fake-indexeddb/auto'
import { installLifecycleLocks } from '../platform/__tests__/lifecycleLocks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSetting, SK } from '../db/schema'
import { setSecureSecret, SECURE_SECRET_KEYS } from '../platform/secureVault'
import { completePendingConnection, disconnectAndDelete, grantRecordsConsent, startConnection, syncSnapshot } from './connect'
import { getConnection, listRecords } from './store'
import type { RecordsProvider, RecordsSnapshot, ConnectSessionState } from './providers/types'

const id = 'cs_0123456789abcdef0123'
const subject = 'u_0123456789abcdef'
const ret = { isReturn: true, sessionId: null, invalidSession: false }
const snapshot: RecordsSnapshot = {
  records: [{ id: 'live:labs:rec_000000000000000000000001', category: 'labs', sourceRecordId: 'lab-source', sourceName: 'Clinic', date: '2026-09-10', codes: [], syncedAt: '2026-09-11T00:00:00Z', synthetic: false, name: 'A1c', value: 6, unit: '%', status: 'final', referenceRange: null, interpretation: null }],
  skipped: 0, additionalItems: 0, sources: [], warnings: [], syncStatus: 'complete', sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, consentReceiptIds: [], synthetic: false,
}
const completed: ConnectSessionState = { id, status: 'completed', subject, sync: { status: 'complete' }, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [], expiresAt: null }
function provider(states: ConnectSessionState[] = [completed]): RecordsProvider {
  let index = 0
  return {
    mode: 'live',
    startConnect: vi.fn(async () => ({ sessionId: id, redirectUrl: 'https://connect.test/s', expiresAt: null, completed: false, subject: null })),
    getSession: vi.fn(async () => states[Math.min(index++, states.length - 1)]),
    fetchSnapshot: vi.fn(async () => snapshot),
  }
}
let elapsed = 0
const deps = { now: () => '2026-09-11T00:00:00Z', randomId: () => 'abcdefghijklmnop', navigate: vi.fn(), monotonicNow: () => elapsed, sleep: async (ms: number) => { elapsed += ms } }

beforeEach(async () => {
  installLifecycleLocks()
  for (const table of db.tables) await table.clear()
  elapsed = 0
  vi.stubGlobal('location', { origin: 'https://app.test' })
  await setSetting(SK.recordsRelayUrl, 'https://relay.test')
  await setSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken, JSON.stringify({ relayBaseUrl: 'https://relay.test', token: 'tok' }))
  await grantRecordsConsent()
})
afterEach(() => vi.unstubAllGlobals())

describe('connection orchestration', () => {
  it('stores the pending session before navigation with a fixed return URL', async () => {
    const p = provider()
    expect(await startConnection(['labs'], { ...deps, provider: p })).toBe('redirected')
    expect(p.startConnect).toHaveBeenCalledWith({ categories: ['labs'], returnUrl: 'https://app.test/?records=return', externalId: 'abcdefghijklmnop' })
    expect(await getConnection()).toMatchObject({ mode: 'live', relayBaseUrl: 'https://relay.test', pendingSession: { id }, generation: expect.any(Number) })
  })

  it('waits through queued sync and narrows to the granted categories', async () => {
    const p = provider([{ ...completed, sync: { status: 'queued' } }, completed])
    await startConnection(['labs', 'vitals'], { ...deps, provider: p })
    const done = await completePendingConnection(ret, { ...deps, provider: p })
    expect(p.getSession).toHaveBeenCalledTimes(2)
    expect(p.fetchSnapshot).toHaveBeenCalledWith(subject, ['labs'])
    expect(done.status).toBe('connected')
    expect(done.pendingSession).toBeUndefined()
    expect(await listRecords()).toEqual(snapshot.records)
  })

  it('rejects unsolicited, mismatched, malformed and replayed sessions without polling', async () => {
    const p = provider()
    await expect(completePendingConnection(ret, { ...deps, provider: p })).rejects.toThrow('This link does not match a connection you started.')
    expect(p.getSession).not.toHaveBeenCalled()
    await startConnection(['labs'], { ...deps, provider: p })
    for (const params of [{ ...ret, sessionId: 'cs_ffffffffffffffffffff' }, { ...ret, invalidSession: true }]) {
      await expect(completePendingConnection(params, { ...deps, provider: p })).rejects.toThrow(/does not match/)
    }
    expect(p.getSession).not.toHaveBeenCalled()
    await completePendingConnection(ret, { ...deps, provider: p })
    vi.mocked(p.getSession).mockClear()
    await expect(completePendingConnection({ ...ret, sessionId: id }, { ...deps, provider: p })).rejects.toThrow(/does not match/)
    expect(p.getSession).not.toHaveBeenCalled()
  })

  it('does not recreate rows or errors when disconnected during a fetch', async () => {
    const p = provider()
    await startConnection(['labs'], { ...deps, provider: p })
    await completePendingConnection(ret, { ...deps, provider: p })
    let release!: (s: RecordsSnapshot) => void
    let started!: () => void
    const fetching = new Promise<void>((resolve) => { started = resolve })
    vi.mocked(p.fetchSnapshot).mockImplementationOnce(() => { started(); return new Promise((resolve) => { release = resolve }) })
    const refresh = syncSnapshot({ ...deps, provider: p })
    await fetching
    const generation = (await getConnection()).generation
    await disconnectAndDelete()
    release(snapshot)
    await refresh
    expect(await listRecords()).toEqual([])
    expect(await getConnection()).toMatchObject({ status: 'disconnected', generation: generation + 1 })
    expect((await getConnection()).lastError).toBeUndefined()
    await expect(completePendingConnection(ret, { ...deps, provider: p })).rejects.toThrow(/does not match/)
  })
})
```

Add separate explicit tests for all remaining branches:

- Demo persists mode/subject/categories/generation before fetch and returns connected or error according to sync outcome; no consent or zero categories makes no request.
- Partial refresh with labs available/medications missing replaces labs but keeps old medications and marks not refreshed; complete empty labs clears only labs; not_started leaves rows and success timestamps untouched. An empty narrowed grant never calls fetchSnapshot. Test queued and syncing separately; test failed and reauthorization_required copy/status.
- Terminal expired/canceled/failed clears pending and offers Start again (new creation); bounded timeout with Retry-After retains pending and Check again. Snapshot failure keeps subject/rows and Refresh. Creation/poll failure uses only sanitized persisted text. Ambiguous creation retry sends identical externalId/body; changed selection/relay uses a fresh attempt.
- Suspend sealing or reject a suspended fetch after cancel/disconnect/wipe from an independent client: no records, subject or error writes survive. Verify consent revocation and relay URL changes during work also reject the commit. Simultaneous same-generation refresh calls share work; independent-tab ordering cannot commit an older result over the newer one. Use fake timers with asynchronous advancement for deadline tests and restore all stubbed globals, including location.

```ts
// app/src/records/returnHandler.test.ts
import { describe, expect, it } from 'vitest'
import { readReturnParams } from './returnHandler'
const id = 'cs_0123456789abcdef0123'
describe('readReturnParams', () => {
  it('distinguishes valid, absent, malformed and duplicate IDs', () => {
    expect(readReturnParams(`?records=return&session=${id}`)).toEqual({ isReturn: true, sessionId: id, invalidSession: false })
    expect(readReturnParams('?records=return')).toEqual({ isReturn: true, sessionId: null, invalidSession: false })
    expect(readReturnParams('?records=return&session=<script>')).toMatchObject({ isReturn: true, invalidSession: true })
    expect(readReturnParams('?records=return&session=')).toMatchObject({ invalidSession: true })
    expect(readReturnParams(`?records=return&session=${id}&session=${id}`)).toMatchObject({ invalidSession: true })
    expect(readReturnParams('?preview=onboarding')).toEqual({ isReturn: false, sessionId: null, invalidSession: false })
  })
})
```

Also stub history/location to assert synchronous stripping before any render/provider call, preserving unrelated query/hash fields. Test duplicate records parameters as invalid. Return after disconnected state, consumed-session replay and no-pending fallback must each make zero requests.

- [ ] **Step 2: Run to verify they fail, implement both modules, run to verify they pass**

Run: `cd app && npx vitest run src/records/connect.test.ts src/records/returnHandler.test.ts` → all stated behaviors pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/records
git commit -m "Orchestrate FinchNode connections, polling, refresh and disconnect"
```

### Task 20: Records tab and screens

**Files:**
- Modify: `app/src/components/TabBar.tsx`, `app/src/state/appStore.ts`, `app/src/App.tsx`, `app/src/main.tsx`, `app/src/styles/app.css`
- Test: `app/src/components/RecordsReturnHandler.test.ts` (StrictMode/shared completion)
- Create: `app/src/screens/RecordsScreen.tsx`, `app/src/components/RecordsCategoryList.tsx`, `app/src/components/RecordsReturnHandler.tsx`, `app/src/styles/records.css`

**Interfaces:**
- `Tab` gains `'records'`; `TABS` inserts `{ id: 'records', label: 'Records', icon: 'M6 4h9l4 4v12H6z M9 12h6M9 16h6' }` before settings.
- `appStore` gains `recordsCategory: RecordCategory | null`, `setRecordsCategory`, `recordsReturn: ReturnParams | null`, `setRecordsReturn`.
- `main.tsx`: before rendering, `const ret = readReturnParams(window.location.search); if (ret.isReturn) { stripReturnParams(); useApp.getState().setRecordsReturn(ret) }`.
- `App.tsx`: render RecordsScreen for the records tab and RecordsReturnHandler when a captured return exists. The handler switches to Records and clears the captured return after completion. Guard StrictMode double-run with a MODULE-LEVEL `inFlight: Map<string, Promise<RecordsConnection>>` keyed by the validated stored pending session ID, not a component ref. Validate consent/relay/pending equality before joining or creating that promise; invalid returns surface the exact mismatch copy without persistence or polling. For an absent URL ID resolve the stored pending ID to use as the key. Remove the map entry in finally only if it still points to that promise. Component cleanup only unsubscribes UI updates; it must not cancel the shared promise or clear a newer return. Task 19 still guards writes by generation.
- Add a duplicate-handler test: mount/effect, StrictMode cleanup/remount before a suspended poll resolves, then release; assert one completion/poll sequence and one committed snapshot. A later replay after pending is consumed must be rejected. Include two same-session return-handler calls directly if pure helpers are extracted for Node testability.
- `RecordsScreen` reads the connection via `useLiveQuery(getConnection)`, counts via `useLiveQuery(countByCategory)`, relay settings via `getSetting(SK.recordsRelayUrl)` + `getSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken)`, and renders the four states from spec C5 with these exact strings:
  - Heading: "Your medical records"
  - Intro: "Bring conditions, medications, labs and more from your provider into Lunara. Records are encrypted in this browser and are not sent to the AI assistant. They are included when you export a backup or explicitly upload an encrypted backup, and you can choose to include them in a report."
  - Consent checkbox: "I understand that connecting sends my chosen categories and a random external ID to FinchNode (through my relay in live mode, also with a return URL). Record bodies are encrypted in this browser, are not sent to the AI assistant, are included in exports and explicitly uploaded encrypted backups, and may be included in a report I choose."
  - Buttons: "Try with sample data", "Connect my provider" (disabled hint: "Save a relay URL and its required token in Settings to connect your provider."), "Refresh", "Disconnect and delete".
  - Demo banner: "Sample data from FinchNode's fictional Northstar Health. Nothing here is about you."
  - Pending: "Finishing your connection" / "Cancel" (calls cancelConnection, invalidating generation before abort). Both connect buttons are disabled without consent or with zero categories. Live also needs a saved token whose relay binding matches the saved URL. For a new live attempt, construct its provider from that matched saved URL/token and let startConnection persist the new connection binding before the first request; providerFor is used for existing pending/refresh connections.
  - Error card shows lastError and the persisted recoveryAction: "Start again" calls startConnection (with the saved creation body only for an ambiguous retry); "Check again" resumes the matching pending session via completePendingConnection; "Refresh" uses retained subject and previous records. A timeout must not restart creation, and terminal sessions must not keep polling their old ID.
  - Source card: organization, "Last synced {date}", `syncStatus === 'partial'` → "Some categories were not available" with the warnings, `skipped > 0` → "{n} items could not be read"; additionalItems > 0 → "{n} additional items from your provider are not shown yet". Show missing categories as "not refreshed" and retained rows as previously cached; distinguish not-selected/unavailable/not_started from a successfully refreshed empty category. ImportedAt and disconnected snapshots stay viewable; refresh is disabled until a valid enabled connection with matching relay/token exists.
- `RecordsCategoryList` props `{ category: RecordCategory; onBack(): void }`: header with `CATEGORY_LABELS[category]`, rows: primary line = `name`/`substance`, secondary = category-specific detail (`dosage · status`, `status · onset {date}`, `value unit · {date}` with `referenceRange` muted, `reaction · severity`, `status · {date}`), tertiary = `sourceName`. Empty state only after a successful available-category refresh: "Nothing in this category from your provider." Missing categories show "Not refreshed" with cached rows when present; unselected categories show "Not selected".
- Every user-triggered action wraps in try/catch and sets a local `status` string; never `alert()`.

- [ ] **Step 1: Wire the tab, store and return handler; build the screens**

Write the components following the interface above. Reuse existing classes: `.page`, `.card`, `.section-label`, `.cta`, `.overlay` (for the category list). Put new rules in `records.css` under a `.records-` prefix (banner, source card, count grid `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`, row layout). Import records.css before desktop.css in main.tsx; desktop.css stays last among screen styles. Change the default mobile `.tabbar-inner` grid to `grid-template-columns: repeat(5, minmax(0, 1fr))`; preserve the desktop display:flex override. Include app.css in this task's files.

- [ ] **Step 2: Verify**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`. Then `npx vite dev` and in a browser: complete onboarding, open Records, tick consent, "Try with sample data" → connected state with seven cards and the demo banner; open "Lab results" → three rows; "Disconnect and delete" → back to the disconnected state. In the network panel only `api.finchnode.com` requests appear.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add the Records tab with demo and live connection flows"
```

### Task 21: Settings, privacy table, and doctor's report section

**Files:**
- Create: `app/src/components/PrivacyTable.tsx`, `app/src/privacy/destinations.ts`
- Modify: `app/src/screens/Settings.tsx`, `app/src/components/DoctorReport.tsx`
- Test: `app/src/screens/Settings.test.ts` (URL/token binding and endpoint changes)

**Interfaces:**
- `privacy/destinations.ts` exports `PRIVACY_DESTINATIONS: { destination: string; when: string; sent: string; offByDefault: true }[]` with the six rows from spec section 8. Correct the demo row to "Chosen categories and a random external ID"; encrypted backup uploads include imported records and occur only through the explicit backup action. The live row includes the required token sent only to the relay. Carry the same wording into PRIVACY.md and the Records consent explanation.
- `PrivacyTable` renders that array as a responsive table (`<table class="privacy-table">`, stacked rows under 560px).
- Settings gains two cards:
  - "Medical records": use Task 16's new URL canonicalizer on blur (HTTPS or exact localhost/127.0.0.1 HTTP; no credentials/query/fragment). Save through a helper that compares the old canonical URL in the settings/connection transaction. When it changes, increment generation, set a live connection disconnected, clear pending/creation state, keep records/subject for local viewing and disable refresh. Then delete the old token from the vault. The password field is required for live mode; save JSON `{ relayBaseUrl: canonicalUrl, token }` under records-relay-token, show "Saved" / "Not set" without echoing it, and report saved only for the current matching endpoint. Use Task 2's shared lifecycle for token operations. A canonical-equivalent URL does not disconnect. Live connect also requires the saved matching token. Include mode and Open Records link.
  - URL/token edits and imports share the binding rules: never forward an old subject/token to a new relay. Add tests for relay A→B, removal, canonical-equivalent URLs, hostile localhost prefixes, saved-token validation and refresh disabled with cached rows still viewable. Coordinate token saves versus URL changes with a Web Lock named lunara-relay-settings and re-read settings before saving; a stale form cannot bind a token to an endpoint selected by another tab.
  - "Privacy and data": `<PrivacyTable />` plus a paragraph "Full details in PRIVACY.md in the repository." Use the existing wipe flow already completed in Tasks 6 and 17, including its blocked-delete message and lifecycle coordination.
- DoctorReport gains `includeProviderRecords` (default `false`) next to the other opt-ins, labelled "Records from your provider". Only when ticked, render a section "Records from your provider" inside DoctorReport's Task 6 `.print-root` with three sub-lists (active conditions, active medications, allergies) from `listRecords(...)`, each row `name — status — date — source`, and a footnote "Imported via FinchNode on {lastSyncAt}. Not verified by Lunara." When the connection is demo, prefix the footnote with "Sample data. ". Fetch opt-in data with loading/error state; export remains disabled until all requested report data loaded successfully. Unticking removes the section and cancels/ignores pending loads. Do not leave hidden provider records in the printable tree.

- [ ] **Step 1: Implement the three changes**

- [ ] **Step 2: Verify**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`; in the browser: set a relay URL, confirm it persists after reload; open the doctor's report with the demo connection, toggle the provider-records section. Verify portrait and landscape print previews contain the section only when ticked, never underlying app screens or scrims, and export is disabled during load/failure. Changing the relay removes its old token and disables refresh without deleting the visible snapshot.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add records settings, the privacy table, and provider records in the doctor report"
```

### Task 22: Records relay Worker

**Files:**
- Create: `workers/records-relay/package.json`, `workers/records-relay/wrangler.toml`, `workers/records-relay/src/index.js`, `workers/records-relay/src/index.test.js`, `workers/records-relay/README.md`

**Interfaces:** routes and validation from spec C2. `export default { fetch(request, env) }`. Env: `FINCHNODE_API_KEY` (secret), `ALLOWED_ORIGINS`, `RELAY_CLIENT_TOKEN` (required high-entropy secret), `FINCHNODE_BASE_URL` (default `https://api.finchnode.com/api/v1`). `package.json` mirrors `workers/backup/package.json` with name `@lunara/records-relay-worker`. `wrangler.toml`: `name = "lunara-records-relay"`, `main = "src/index.js"`, `compatibility_date = "2026-01-01"`, `[vars] ALLOWED_ORIGINS = "http://localhost:5173"`, and comments for `wrangler secret put FINCHNODE_API_KEY` and `wrangler secret put RELAY_CLIENT_TOKEN`. Neither secret belongs in [vars]. This is one owner using a dedicated FinchNode application; a shared deployment for independent users requires per-user authentication and subject/session ownership checks before live use. Missing secret configuration returns 503; absent/incorrect token returns 401 before any upstream call. Exact Origin allowlisting is an additional browser restriction, not authentication.

- [ ] **Step 1: Write the failing tests**

```js
// workers/records-relay/src/index.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = { FINCHNODE_API_KEY: 'ck_test_placeholder', ALLOWED_ORIGINS: 'https://app.example', RELAY_CLIENT_TOKEN: 'tok' }
const origin = { origin: 'https://app.example', 'x-lunara-relay-token': 'tok' }
let upstream

beforeEach(() => {
  upstream = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: '2026-09-12T00:00:00Z', status: 'pending', object: 'connect_session' }), { status: 201, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', upstream)
})

afterEach(() => vi.unstubAllGlobals())

const call = (method, path, body, headers = origin) =>
  worker.fetch(new Request(`https://relay.test${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined }), env)

describe('records relay', () => {
  it('answers preflight for allowed origins only', async () => {
    const ok = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'OPTIONS', headers: { origin: 'https://app.example' } }), env)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example')
    expect(ok.headers.get('access-control-allow-headers')).toMatch(/x-lunara-relay-token/i)
    const bad = await worker.fetch(new Request('https://relay.test/v1/connect/sessions', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), env)
    expect(bad.status).toBe(403)
  })

  it('requires the client token before all upstream access', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' }, { origin: 'https://app.example' })
    expect(res.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects missing server configuration and incorrect client tokens', async () => {
    const request = new Request('https://relay.test/v1/connect/sessions/cs_0123456789abcdef0123', { headers: origin })
    expect((await worker.fetch(request, { ...env, RELAY_CLIENT_TOKEN: undefined })).status).toBe(503)
    expect((await call('GET', '/v1/connect/sessions/cs_0123456789abcdef0123', undefined, { ...origin, 'x-lunara-relay-token': 'wrong' })).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('rejects claims rather than filtering an unsupported category', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs', 'claims'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' })
    expect(res.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([undefined, [], ['labs', 'labs'], ['claims'], ['labs', ''], 'labs'])(
    'rejects missing, empty, duplicate or malformed POST categories: %j', async (categories) => {
      expect((await call('POST', '/v1/connect/sessions', { categories, returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop' })).status).toBe(400)
      expect(upstream).not.toHaveBeenCalled()
    },
  )
  it.each(['', '?categories=', '?categories=labs,labs', '?categories=claims', '?categories=labs&categories=vitals', '?categories=labs,'])(
    'rejects invalid snapshot category query %s', async (query) => {
      expect((await call('GET', `/v1/users/u_0123456789abcdef/records${query}`)).status).toBe(400)
      expect(upstream).not.toHaveBeenCalled()
    },
  )

  it('creates a connect session with an allowlisted body and bearer key', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop', evil: true })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: '2026-09-12T00:00:00Z', status: 'pending' })
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://api.finchnode.com/api/v1/connect/sessions')
    expect(init.headers.authorization).toBe('Bearer ck_test_placeholder')
    expect(init.headers['idempotency-key']).toBe('abcdefghijklmnop')
    expect(JSON.parse(init.body)).toEqual({ categories: ['labs'], returnUrl: 'https://app.example/?records=return', externalId: 'abcdefghijklmnop', syncMode: 'one-time', durationDays: 365 })
  })

  it('rejects return urls outside the allowed origins and bad ids', async () => {
    for (const returnUrl of ['https://evil.example/', 'https://app.example.evil/?records=return', 'https://app.example@evil.test/', 'https://user:pass@app.example/', 'https://app.example:8443/', `https://app.example/?x=${'x'.repeat(2048)}`]) {
      expect((await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl, externalId: 'abcdefghijklmnop' })).status).toBe(400)
    }
    expect((await call('GET', '/v1/connect/sessions/nope')).status).toBe(400)
    expect((await call('GET', '/v1/users/u_zz/records')).status).toBe(400)
  })

  it('proxies session state and snapshots with no-store and passes rate-limit headers', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', syncId: null, startedAt: null, completedAt: null, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [] }, categories: ['labs'] }), { status: 200 }))
    const s = await call('GET', '/v1/connect/sessions/cs_0123456789abcdef0123')
    expect(await s.json()).toEqual({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', syncId: null, startedAt: null, completedAt: null, grantedCategories: ['labs'], availableCategories: ['labs'], missingCategories: [], failure: null, warnings: [] } })
    upstream.mockResolvedValueOnce(new Response('{"object":"health_record"}', { status: 200, headers: { 'ratelimit-remaining': '9', 'retry-after': '1' } }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
    expect(upstream.mock.calls[1][0]).toBe('https://api.finchnode.com/api/v1/users/u_0123456789abcdef/records?categories=labs%2Cvitals')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('ratelimit-remaining')).toBe('9')
    expect(r.headers.get('retry-after')).toBe('1')
    expect(r.headers.get('access-control-expose-headers')).toMatch(/retry-after/i)
    expect(r.headers.get('access-control-expose-headers')).toMatch(/ratelimit-remaining/i)
    expect(r.headers.get('vary')).toMatch(/origin/i)
  })

  it('forwards upstream errors without leaking the key', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'consent_expired', message: 'Consent expired', requestId: 'req_1' } }), { status: 410 }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records?categories=labs')
    expect(r.status).toBe(410)
    expect(await r.text()).not.toContain('ck_test')
  })
})
```

- [ ] **Step 2: Run to verify they fail, implement `src/index.js`, run to verify they pass**

Add actual-request tests for missing and disallowed Origin with valid tokens, malformed JSON, a body over the explicit 16 KiB limit (including streamed bodies without Content-Length), upstream fetch rejection/timeouts, complete local/upstream error envelopes, no-store on errors/sessions/snapshots and browser-visible Retry-After. Test exact return origin against both Origin and ALLOWED_ORIGINS when the allowlist contains two valid origins: a return to the other allowed origin is still rejected for this request. Test missing FINCHNODE_API_KEY as 503 too.

Run: `cd workers/records-relay && pnpm install && pnpm test` → authentication, origin, strict category, envelope and header behaviors pass. Implement:

- Validate required secret configuration first (503); OPTIONS uses exact Origin preflight without asking for the client token header value. Every actual route authenticates the required token (401) before upstream access and validates a present allowlisted Origin (403). Compare SHA-256 digests with a full fixed-length XOR/OR accumulation over all 32 bytes, returning equality only after the loop; no early-return byte comparison.
- Parse URLs with new URL. Return URL must be credential-free, at most 2048 characters, and have origin exactly equal to request Origin and an ALLOWED_ORIGINS entry. Strictly require supported, nonempty, unique categories on POST and exactly one comma-separated categories query on snapshot GET. Reject invalid input with 400; never filter unsupported entries or omit the upstream filter. Limit/validate JSON bodies and allowlist outbound fields.
- Forward only whitelisted session fields: id/status/subject/expiresAt and the full validated sync metadata including status, granted/available/missing categories, warnings and failure. Stream snapshots as JSON. Upstream fetch is bounded (10 seconds), with redirects rejected and no cookies; map local network failures to sanitized api_error envelopes.
- Copy AND expose Retry-After, RateLimit-Limit, RateLimit-Remaining and RateLimit-Reset via Access-Control-Expose-Headers. Include Vary: Origin and Cache-Control: private, no-store on sessions, snapshots and all error responses. Local errors use `{ error: { type: 'invalid_request_error' | 'api_error', code, message, requestId } }`; upstream error fixtures use that complete vendored envelope and never include a real secret. Expose headers on errors too so browser polling can honor backoff.

- [ ] **Step 3: README**

Write workers/records-relay/README.md with single-owner/dedicated-app scope, setup/category allowlisting, both secret commands, exact origin configuration, deployment and required saved URL/token. Include "What the relay can and cannot see": trusted operator can see records in transit, stores nothing. Explain that Origin is not authentication and a deployment serving independent users needs per-user authentication and subject/session ownership checks.

- [ ] **Step 4: Commit**

```bash
git add workers/records-relay pnpm-lock.yaml
git commit -m "Add the stateless FinchNode records relay Worker"
```

### Task 23: PRIVACY.md, README records section, CSP

**Files:**
- Create: `PRIVACY.md`
- Modify: `README.md`, `app/public/_headers`, `docs/WEB_CAPABILITY_BOUNDARY.md`

- [ ] **Step 1: Write PRIVACY.md**

Sections: "Summary" (three sentences), "What leaves your browser" (the table generated from `PRIVACY_DESTINATIONS`, same wording), "What is stored and how" (medical-record bodies and vault secrets are sealed; record IDs/categories/dates and connection metadata—including organizations, warnings, subjects and pending-session identifiers—remain plaintext in IndexedDB; existing daily logs and health profiles are also not sealed; the browser-managed key; PIN/device unlock only gate the screen, without server signature verification), "Threat model" (spec section 8 paragraph), "Medical records via FinchNode" (demo vs live, the relay, FinchNode's own consent receipts and how to revoke at the source), "Deleting your data" (Disconnect and delete; Delete all data; clearing site data), "No tracking" (no analytics, cookies, third-party scripts; CSP enforced by `_headers`).

State explicitly that exports contain opened medical records plus canonical healthProfiles, regimenRecords and missedDoseEvents, with all listed security settings excluded; backup uploads encrypt this whole payload and occur only through the backup action. Do not describe the entire local database as encrypted. Repeat Task 20's introduction/consent privacy statements and single-owner relay authentication/binding limitations.

- [ ] **Step 2: README**

Replace the Task 8 placeholder with "Medical records" instructions: try sample data; live setup (deploy `workers/records-relay`, paste URL/token in Settings); privacy summary linking `PRIVACY.md`. Add `workers/records-relay/` to Structure.

- [ ] **Step 3: CSP**

Confirm `connect-src` in `_headers` lists `https://api.finchnode.com`; add a comment line above it explaining how to append a custom relay origin. Add the relay to `docs/WEB_CAPABILITY_BOUNDARY.md` under opt-in network calls.

- [ ] **Step 4: Final verification**

Run from the repo root: `pnpm --filter @lunara/app test && (cd app && npx tsc --noEmit && npx vite build) && (cd workers/records-relay && pnpm test)`. Expected: all green. `grep -rn "ck_live\|ck_test_[a-z0-9]\{8\}" --include='*' . | grep -v node_modules` returns only the placeholder.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Document privacy guarantees and the FinchNode records setup"
```

---

## Plan self-review

- **Structure:** header, Global Constraints, file structure, Tasks 1–23 with checkbox steps and this self-review retained. Task 8 points to Task 23. Verification uses behavioral expectations rather than stale test-suite totals. This document is self-contained; implementing agents do not need the saved review.
- **Spec coverage:** section 5 A1 → T6; A2 → T1–T3/T17; A3 → T4/T6; A4 → T5/T6; A5 → T7/T16; A6 → T6/T12/T20/T21. Section 6 B1 → T9; B2/B3 → T10/T11. Section 7 C1 → T16/T19/T20; C2 → T16/T21/T22; C3 → T13–T16; C4 → T17–T19/T21; C5 → T20/T21; C6 → T16/T19/T20. Sections 8/11 → T8/T18/T21–T23; section 9 → each task's behavior tests. Phase 4 adversarial review remains the orchestrator's final implementation review.
- **B1–B5:** required single-owner token/503/401 and dedicated app (T16/T21/T22); exact parsed relay/return URLs, token/connection bindings and endpoint invalidation (T16/T18/T19/T21/T22); fixed return URL plus invalidSession, replay/no-pending checks (T19/T20); generation guarded transactions, invalidation before abort, cross-tab safety and StrictMode promise dedupe (T17/T19/T20); atomic key winner, versionchange, shared lifecycle and blocked-wipe errors (T2/T3/T6/T17/T21).
- **B6–B10:** complete security-setting exclusion list and vault-free transfer (T18); validate/seal-before-transaction v1 preservation/v2 full replacement/imported views (T18); independent session/sync states, effective categories and complete/partial/not_started rules (T13/T15–T20); initialized demo state and recoverable sanitized errors/idempotent creation retry (T19/T20); strict relay filters plus provider/normalizer/UI category boundaries (T13–T16/T19/T20/T22).
- **B11–B15:** isolated print roots and opt-in/load guards (T6/T21); initial-ready lock plus synchronous hide and generation-checked unlock (T6); memory-label/type cleanup and precise Onboarding subsection removal without StepId changes (T6); visible device enrollment/web reminders and vault destruction in the early wipe migration (T6); startup/restored/rolling scheduler, tags, bounded registration lookup, stop-before-wipe and strict time syntax (T5/T6).
- **B16–B20:** Node-safe global stubs/restoration and asynchronous timers (T4/T5/T19); serialized and built SW checks plus omit/no-store/error HTTP (T7/T16); flex rail, root scrims, scrolling/animation, stylesheet order and mobile five-tab grid (T12/T20); explicit live normalization/stable identity/demographics/consistent fixture and unsupported-array disclosure (T13/T15/T16/T20); LOINC-keyed exact/reversed BP, labeled other components and one-sided ranges (T14).
- **N1–N4:** effective heading/font/CTA/phase/chart/health CSS and computed-style checks (T9–T12); accurate demo/export/backup/report/AI privacy text (T20/T21/T23); exact plaintext/encryption boundary (T8/T17/T23); raw WebAuthn ID/type/null verification and honest screen-gate copy (T4/T6).
- **N5–N8:** exposed rate-limit headers, full envelopes and Worker security/error tests (T16/T22); canonical profile/regimen/adherence v2 round trip without overriding restored ledger decisions (T18); locked TypeScript 5.9.3, ES2024+DOM libs and tsc in the FHIR task (T14); closed raw handles, explicit demographics fixtures, true v3 migration/no-write liveQuery, corrected task reference and behavioral verification (T3/T8/T15/T17 and test steps throughout).
- **Contract consistency:** SyncDetails/RecordsSnapshot distinguish sync.status from snapshot completeness; RecordsConnection includes generation/relayBaseUrl/importedAt and recovery metadata; guarded ConnectionPatch carries expectedGeneration but never stores it. All completion/error writes use the same consent/generation transaction guard; import is a deliberate full replacement with a new generation, prepared ciphertext and all tables in one transaction. The minimal generation tombstone prevents ABA after cancel/disconnect/wipe. Token envelopes are always bound and excluded from transfers.
- **Resolved decisions:** one owner/dedicated FinchNode app; live extra arrays are counted and disclosed, not displayed. Demo FHIR DiagnosticReport inside labs retains its existing lab mapping. The exact Onboarding StepIds, real CSS selectors and version-3 tables are specified above. No BroadcastChannel and no additional consent-versus-authorization restriction were added. Imported snapshots remain viewable; explicit connection may use the user's restored granted ledger and must satisfy endpoint/token checks.
