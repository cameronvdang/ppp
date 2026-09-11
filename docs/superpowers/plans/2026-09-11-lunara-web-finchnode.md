# Lunara Web + FinchNode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Lunara fork into a browser-first, privacy-first web app with Aileron + baby pink/red styling and FinchNode medical-records import.

**Architecture:** The React/Vite/Dexie product layer stays. `src/native/*` (Capacitor bridges) is replaced by `src/platform/*` web adapters with the same exported names. A new `src/records/*` module talks to FinchNode's demo API directly or to a self-hosted relay Worker, normalizes records into one model, and stores them sealed in Dexie. A PWA service worker precaches the shell only.

**Tech Stack:** React 18, Vite 6, TypeScript 5.6, Dexie 4, zustand 5, vitest 2, `@fontsource/aileron`, `vite-plugin-pwa` ^1.3, `fake-indexeddb` ^6.2 (tests), Cloudflare Workers (wrangler 3) for the relay.

**Spec:** `docs/superpowers/specs/2026-09-10-lunara-web-finchnode-design.md`

## Global Constraints

- Node 24 / pnpm 9 workspace. Run app commands as `pnpm --filter @lunara/app <script>` from the repo root, or from `app/`.
- Baseline must never regress: `pnpm --filter @lunara/app test` (186 tests, estimate audit at zero violations), `npx tsc --noEmit` in `app/`, `npx vite build` in `app/`.
- Vitest runs in `environment: 'node'`; tests that need IndexedDB import `'fake-indexeddb/auto'` at the top; tests that need `window`/`navigator` stub them on `globalThis`.
- Exported function names in `src/platform/*` must match the old `src/native/*` names listed in spec A1 so call sites change only their import path.
- No new network destinations beyond spec section 8. No analytics, no CDN scripts, no cookies.
- Never cache `api.finchnode.com` or the relay in the service worker.
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
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/crypto/sealed.ts app/src/crypto/sealed.test.ts
git commit -m "Add key-based AES-GCM sealing primitive"
```

### Task 2: Browser key store

**Files:**
- Create: `app/src/platform/keyStore.ts`
- Test: `app/src/platform/keyStore.test.ts`
- Modify: `app/package.json` (devDependency `fake-indexeddb: ^6.2.5`)

**Interfaces:**
- Consumes: `generateSealingKey` from Task 1.
- Produces: `getSealingKey(): Promise<CryptoKey>` (creates on first call, memoized per page), `deleteKeyStore(): Promise<void>` (deletes the whole `lunara-keys` database and clears the memo), `KEY_DB_NAME = 'lunara-keys'`.

- [ ] **Step 1: Add fake-indexeddb**

Run: `cd app && pnpm add -D fake-indexeddb@^6.2.5`

- [ ] **Step 2: Write the failing test**

```ts
// app/src/platform/keyStore.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { open, seal } from '../crypto/sealed'
import { deleteKeyStore, getSealingKey } from './keyStore'

describe('keyStore', () => {
  beforeEach(async () => {
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
```

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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idb<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = run(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

async function loadOrCreate(): Promise<CryptoKey> {
  const db = await openDb()
  try {
    const existing = await idb<CryptoKey | undefined>(db, 'readonly', (s) => s.get(MAIN_KEY))
    if (existing) return existing
    const key = await generateSealingKey()
    await idb(db, 'readwrite', (s) => s.put(key, MAIN_KEY))
    return key
  } finally {
    db.close()
  }
}

/** The browser-managed sealing key. Never leaves IndexedDB as bytes. */
export function getSealingKey(): Promise<CryptoKey> {
  memo ??= loadOrCreate().catch((error) => {
    memo = null
    throw error
  })
  return memo
}

export function deleteKeyStore(): Promise<void> {
  memo = null
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(KEY_DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => resolve()
  })
}

/** Test-only: forget the memoized key without touching IndexedDB. */
export function __resetMemoForTests(): void {
  memo = null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd app && npx vitest run src/platform/keyStore.test.ts`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add app/package.json pnpm-lock.yaml app/src/platform/keyStore.ts app/src/platform/keyStore.test.ts
git commit -m "Add browser key store backed by a non-extractable CryptoKey"
```

### Task 3: Web secure vault

**Files:**
- Create: `app/src/platform/secureVault.ts`
- Test: `app/src/platform/secureVault.test.ts`

**Interfaces:**
- Consumes: `getSealingKey`, `deleteKeyStore` (Task 2); `seal`, `open` (Task 1).
- Produces (same names as `native/secureVault.ts`): `SECURE_SECRET_KEYS` (adds `recordsRelayToken: 'records-relay-token'`), `secureVaultStatus(): Promise<SecureVaultStatus>` where `SecureVaultStatus = { available: true; persistence: 'indexeddb-webcrypto'; hardwareBacked: false; platform: 'web' }`, `setSecureSecret(key, value)`, `getSecureSecret(key): Promise<string | null>`, `deleteSecureSecret(key)`, `clearSecureSecrets()`, `currentVaultPlatform(): 'web'`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/platform/secureVault.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
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
        get.onsuccess = () => resolve(get.result)
        get.onerror = () => reject(get.error)
      }
      req.onerror = () => reject(req.error)
    })
    expect(JSON.stringify(raw)).not.toContain('sk-ant-visible')
  })
})
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
    req.onsuccess = () => resolve(req.result)
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
  const blob = await seal(await getSealingKey(), value)
  await withStore('readwrite', (s) => s.put(blob, key))
}

export async function getSecureSecret(key: string): Promise<string | null> {
  assertValidKey(key)
  const blob = await withStore<SealedBlob | undefined>('readonly', (s) => s.get(key))
  if (!blob) return null
  try {
    return await open<string>(await getSealingKey(), blob)
  } catch {
    return null // key store was wiped; the sealed value is unrecoverable
  }
}

export async function deleteSecureSecret(key: string): Promise<void> {
  assertValidKey(key)
  await withStore('readwrite', (s) => s.delete(key))
}

export async function clearSecureSecrets(): Promise<void> {
  await withStore('readwrite', (s) => s.clear())
}

/** Full wipe used by "Delete all data": secrets and the key that seals them. */
export async function destroySecureVault(): Promise<void> {
  await clearSecureSecrets()
  await deleteKeyStore()
}

export function currentVaultPlatform(): SecureVaultStatus['platform'] {
  return 'web'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/platform/secureVault.test.ts`
Expected: 4 passed.

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
  ;(globalThis as any).window = { location: { hostname: 'localhost' } }
  ;(globalThis as any).PublicKeyCredential = {
    isUserVerifyingPlatformAuthenticatorAvailable: async () => opts.uvpaa,
  }
  ;(globalThis as any).navigator = {
    credentials: {
      create: vi.fn(async () => fakeCredential),
      get: vi.fn(async () => {
        if (opts.getError) throw opts.getError
        return opts.getResult ?? fakeCredential
      }),
    },
  }
}

describe('deviceUnlock', () => {
  beforeEach(async () => {
    await db.settings.clear()
  })
  afterEach(() => {
    delete (globalThis as any).PublicKeyCredential
    delete (globalThis as any).navigator
    delete (globalThis as any).window
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
 * signature-verified. It holds the same trust level as the PIN.
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
    return { authenticated: Boolean(assertion), kind: 'platform' }
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
Expected: 5 passed.

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
- Behaviour: timers are `setTimeout`s held in a module map; firing calls `showReminder(title, body)` which uses `navigator.serviceWorker?.ready → registration.showNotification` when available, else `new Notification(...)` when `Notification.permission === 'granted'`, else no-op. Daily reminder re-arms itself for the next day after firing. Materialized requests schedule only those with `fireAt` within the next 24 h (cap 64).

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
    ;(globalThis as any).Notification = Object.assign(vi.fn(), { permission: 'granted', requestPermission: vi.fn(async () => 'granted') })
    ;(globalThis as any).navigator = {}
  })
  afterEach(async () => {
    await cancelDailyReminder()
    await cancelMaterializedReminders()
    vi.useRealTimers()
    delete (globalThis as any).Notification
    delete (globalThis as any).navigator
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
    vi.advanceTimersByTime(5 * 60_000)
    expect((globalThis as any).Notification).toHaveBeenCalledWith('Lunara', expect.objectContaining({ body: expect.any(String) }))
    expect(await pendingDailyReminder()).toBe(true)
  })

  it('rejects malformed times and unsupported permission', async () => {
    await expect(scheduleDailyReminder('25:99')).rejects.toThrow(/HH:MM/)
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
    vi.advanceTimersByTime(60_000)
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

const DAILY_KEY = 'daily'
const WINDOW_MS = 24 * 60 * 60_000
const MAX_TIMERS = 64
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let dailyTime: string | null = null

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
  const [hour, minute] = time.split(':').map(Number)
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

async function showReminder(title: string, body: string, tag: string): Promise<void> {
  const sw = (globalThis as { navigator?: { serviceWorker?: { ready?: Promise<{ showNotification(t: string, o: object): Promise<void> }> } } }).navigator?.serviceWorker
  if (sw?.ready) {
    try {
      const reg = await sw.ready
      await reg.showNotification(title, { body, tag })
      return
    } catch {
      /* fall through */
    }
  }
  const N = notificationApi()
  if (N && N.permission === 'granted') new N(title, { body, tag })
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
      void showReminder('Lunara', 'A gentle moment to check in with yourself.', 'lunara-daily')
      armDaily()
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
  const t = timers.get(DAILY_KEY)
  if (t) clearTimeout(t)
  timers.delete(DAILY_KEY)
  dailyTime = null
}

export async function pendingDailyReminder(): Promise<boolean> {
  return timers.has(DAILY_KEY)
}

export async function cancelMaterializedReminders(): Promise<void> {
  for (const [key, t] of timers) {
    if (key === DAILY_KEY) continue
    clearTimeout(t)
    timers.delete(key)
  }
}

/** In-session only: fires while a Lunara tab is open. Documented in Settings. */
export async function scheduleMaterializedReminders(requests: MaterializedReminderRequest[]): Promise<void> {
  await cancelMaterializedReminders()
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

export async function syncReminderPlans(plans: ReminderPlan[], options: MaterializeReminderOptions): Promise<MaterializedReminderRequest[]> {
  const requests = materializeReminderRequests(plans, { ...options, limit: Math.min(MAX_TIMERS, options.limit ?? MAX_TIMERS) })
  if ((await notificationPermission(false)) === 'granted') await scheduleMaterializedReminders(requests)
  return requests
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

Run: `cd app && npx vitest run src/platform/notifications.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add app/src/platform/notifications.ts app/src/platform/notifications.test.ts
git commit -m "Add in-session web reminders replacing Capacitor local notifications"
```

### Task 6: Switch the app to the platform layer and delete the native layer

**Files:**
- Create: `app/src/platform/runtime.ts`, `app/src/platform/reportExport.ts` (+ move `reportExport.test.ts`), `app/src/lib/healthImport.ts`
- Modify: `app/src/main.tsx`, `app/src/App.tsx`, `app/src/components/{AssistantScreen,DoctorReport,LogSheet,PinLock}.tsx`, `app/src/screens/{CycleReportScreen,Onboarding,Settings,Today}.tsx`, `app/src/screens/Settings.test.ts`, `app/src/lib/providerFetch.ts`, `app/package.json`, `pnpm-workspace.yaml`
- Delete: `app/src/native/`, `app/ios/`, `app/android/`, `app/capacitor.config.ts`, `workers/oauth-callback/`, `docs/NATIVE_ARCHITECTURE.md`

**Interfaces:**
- `platform/runtime.ts` produces: `export const isNative = false as const`, `export const nativePlatform = 'web' as const`, `initializeRuntime(): Promise<void>` (sets `document.documentElement.dataset.runtime = 'web'`), `initializeNativeRuntime = initializeRuntime` (alias so main.tsx compiles before it is edited), `nativeTap(): Promise<void>` (calls `navigator.vibrate?.(10)`).
- `platform/reportExport.ts` produces the same `exportCurrentReport(jobName?, deps?)` with `native` forced false; keep `ReportExportDependencies` type so the moved test compiles.
- `lib/healthImport.ts` produces: `HealthSample`, `HealthDataType`, `SUPPORTED_HEALTH_DATA_TYPES`, `groupHealthSamples`, `groupHealthSamplesWithProvenance`, `applyHealthSamples`, `GroupedHealthDay`, `HealthImportApplyResult` (copy the type definitions for `HealthSample`/`HealthDataType` from `native/health.ts` into this file; drop everything that touched the bridge).

- [ ] **Step 1: Create the three modules**

```ts
// app/src/platform/runtime.ts
export const isNative = false as const
export const nativePlatform = 'web' as const

export async function initializeRuntime(): Promise<void> {
  document.documentElement.dataset.runtime = 'web'
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
  native?: boolean
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

Move `app/src/native/reportExport.test.ts` to `app/src/platform/reportExport.test.ts`; delete the test cases that assert the native bridge path and keep the browser-print cases (adjust imports).

`app/src/lib/healthImport.ts`: copy `native/healthImport.ts`, remove the imports from `./health` and `./runtime`, paste in the `HealthDataType`, `SUPPORTED_HEALTH_DATA_TYPES`, `HealthSample` definitions from `native/health.ts`, delete `importAppleHealthPeriodHistory`, `unavailablePeriodResult`, `healthImportProvider`, `AppleHealthPeriodImportResult`. Keep `groupHealthSamplesWithProvenance`, `groupHealthSamples`, `applyHealthSamples`.

- [ ] **Step 2: Repoint imports**

- `main.tsx`: `import { initializeRuntime } from './platform/runtime'`, call `void initializeRuntime()`, delete the service-worker unregister block.
- `App.tsx`: delete the two `@capacitor` imports, the `isNative` import, and the `NativeApp.addListener('appStateChange', …)` effect. Replace with:
  ```ts
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        void getSetting(SK.pinHash).then((pin) => { if (pin) setLocked(true) })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [setLocked])
  ```
- `AssistantScreen.tsx`, `Onboarding.tsx`: `'../native/secureVault'` → `'../platform/secureVault'`.
- `DoctorReport.tsx`, `CycleReportScreen.tsx`: `'../native/reportExport'` → `'../platform/reportExport'`.
- `LogSheet.tsx`: `'../native/runtime'` → `'../platform/runtime'`.
- `PinLock.tsx`: `'../native/biometrics'` → `'../platform/deviceUnlock'`; the `biometricKind === 'face'` branches become a single label "Unlock with device".
- `Onboarding.tsx`: remove the `HealthAuthorization`, `importAppleHealthPeriodHistory`, `nativePlatform` imports and the Apple Health import step/UI they power (search for `importApplePeriods`/`healthImport` usages in the file; remove those step ids from the step queue and their render branches).
- `Today.tsx`: remove the widget import and the `publishWidgetSnapshot` effect (lines ~320–390); keep any snapshot computation only if something else uses it, otherwise delete it.
- `Settings.test.ts`: import `HealthSample`, `groupHealthSamples`, `groupHealthSamplesWithProvenance` from `'../lib/healthImport'`.
- `Settings.tsx`: repoint `biometrics → platform/deviceUnlock`, `notifications → platform/notifications`, `runtime → platform/runtime`, `secureVault → platform/secureVault`; delete the `health`, `healthImport`, `widgets` imports and every UI/handler that used them (`syncHealthData`, `importApplePeriods`, `recordHealthImportDecision`, the `health`/`widget` state, the "Health data" card, the widget status row). The biometric toggle calls `enrollDeviceUnlock()` on enable and `removeDeviceUnlock()` on disable. The vault label reads `Browser-managed key (WebCrypto in IndexedDB)`. Add the honest copy from spec A2 under the vault row and the in-session reminder copy from spec A4 under the reminders section.
- `lib/providerFetch.ts`: reduce to `export const providerFetch: typeof fetch = (input, init) => fetch(input, init)` with the existing doc comment trimmed to the browser case.

- [ ] **Step 3: Delete the native layer and dependencies**

```bash
git rm -r -q app/src/native app/ios app/android app/capacitor.config.ts workers/oauth-callback docs/NATIVE_ARCHITECTURE.md
```

In `app/package.json` remove every `@capacitor/*` dependency and devDependency and the scripts `build:native`, `native:sync`, `native:ios`, `native:android`, `native:ios:build`, `native:android:build`, `native:doctor`. In `pnpm-workspace.yaml` keep `esbuild` and `sharp` under `allowBuilds`, drop `workerd` only if no worker still needs it (the backup and reminders workers use wrangler → keep it). Run `pnpm install` from the repo root to refresh the lockfile.

- [ ] **Step 4: Verify**

Run from repo root: `pnpm --filter @lunara/app test && cd app && npx tsc --noEmit && npx vite build`
Expected: all tests pass (186 + the new platform tests minus the removed native bridge cases), no type errors, build succeeds. `grep -r "@capacitor\|native/" app/src` returns nothing.

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
- `pwa.config.ts` produces `export const NEVER_CACHE_HOSTS = ['api.finchnode.com']` and `export const pwaOptions: Partial<VitePWAOptions>`.

- [ ] **Step 1: Write the failing test**

```ts
// app/pwa.config.test.ts
import { describe, expect, it } from 'vitest'
import { NEVER_CACHE_HOSTS, pwaOptions } from './pwa.config'

describe('pwa config', () => {
  it('registers with autoUpdate and a standalone manifest', () => {
    expect(pwaOptions.registerType).toBe('autoUpdate')
    expect(pwaOptions.manifest).toMatchObject({ name: 'Lunara', display: 'standalone' })
  })

  it('never caches record or relay traffic', () => {
    const routes = pwaOptions.workbox?.runtimeCaching ?? []
    for (const host of NEVER_CACHE_HOSTS) {
      const match = routes.find((r) => typeof r.urlPattern === 'function' && r.urlPattern({ url: new URL(`https://${host}/x`) } as any))
      expect(match?.handler).toBe('NetworkOnly')
    }
    expect(routes.some((r) => r.handler === 'CacheFirst' || r.handler === 'StaleWhileRevalidate')).toBe(false)
    expect(pwaOptions.workbox?.navigateFallbackDenylist?.some((re) => re.test('/?records=return&session=cs_1'))).toBe(false)
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

/** Hosts whose responses must never touch the cache: they carry health records. */
export const NEVER_CACHE_HOSTS = ['api.finchnode.com']

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
    navigateFallbackDenylist: [],
    runtimeCaching: [
      {
        urlPattern: ({ url }) => NEVER_CACHE_HOSTS.includes(url.hostname),
        handler: 'NetworkOnly',
      },
      {
        // Any cross-origin request (relay, AI provider, backup) is network-only.
        urlPattern: ({ url }) => typeof self !== 'undefined' && url.origin !== self.location.origin,
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
Expected: tests pass, build emits `sw.js` and `manifest.webmanifest`.

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

Structure: title + one-line description; "Fork notice" (upstream link, AGPL, what changed: web-first, FinchNode records, Aileron, palette); "Run it" (`pnpm install`, `pnpm dev`, `pnpm build`, `pnpm preview`; deploy `app/dist` to any static host; `_headers` note); "Privacy" (link `PRIVACY.md`, three bullets: local-first, opt-in transfers, encrypted at rest); "Medical records" placeholder paragraph that Task 24 completes; "Develop" (`pnpm test`, estimate audit note); "Structure" (`app/`, `workers/backup`, `workers/reminders`, `workers/records-relay` (added in Phase 3)); "AI companion" section kept; Disclaimer; License.

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
- Modify: `app/package.json`, `app/src/main.tsx`, `app/src/styles/tokens.css` (typography block only)

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

Search `app.css` and the other style files for `font-family: var(--font-display)` rules that set `font-weight: 700` on headings and change those to `var(--weight-display)`; leave body weights alone.

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

In `CycleRing.tsx` and the phase/marker rules in `app.css` (search `period`, `fertile`, `ovulation`, `luteal`, `follicular` class names) use `var(--period)`, `var(--fertile)`, `var(--phase-follicular)`, `var(--phase-luteal)`. Inline TSX references to `--teal-500`/`--teal-100` become `--fertile`/`--pink-100`; `--rose-500`/`--rose-700`/`--coral-400` become `--period`/`--red-700`/`--red-400`. Primary buttons (`.cta`, `button.primary`, or whatever `app.css` names them) use `background: var(--cta-bg); color: var(--cta-fg)`.

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
- Modify: `app/src/main.tsx` (import it last), `app/src/components/TabBar.tsx` (no logic change; add `data-layout` hook only if needed)

- [ ] **Step 1: Write the stylesheet**

```css
/* Desktop shell: rail navigation and a centred reading column. */
@media (min-width: 900px) {
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

  .tabbar-inner {
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
  .sheet {
    left: 50%;
    right: auto;
    width: min(680px, calc(100vw - 48px));
    transform: translateX(-50%);
    border-radius: var(--radius-large);
    box-shadow: var(--shadow-float);
    max-height: calc(100vh - 48px);
    top: 24px;
    bottom: auto;
  }

  body::after {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    background: rgba(58, 34, 38, 0.18);
    opacity: 0;
    transition: opacity 160ms var(--ease-soft);
  }

  body:has(.overlay, .sheet)::after {
    opacity: 1;
  }
}
```

Adjust selectors to match the real class names in `app.css` (verify `.tabbar`, `.tabbar-inner`, `.tabbar-item`, `.is-active`, `.overlay`, `.sheet` exist; if a sheet uses a wrapper class, target that).

- [ ] **Step 2: Verify at two widths**

Run the preview as in Task 11; view at 390px and 1280px wide.
Expected: phone layout unchanged under 900px; rail + centred column above.

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
  /** `${mode}:${category}:${sourceRecordId}`; stable across refreshes. */
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

export interface NormalizeResult { records: MedicalRecord[]; skipped: number }

export interface RecordsSource { system: string; organization: string | null; lastSyncedAt: string | null }
export interface RecordsWarning { code: string; message: string; category?: RecordCategory | null }
export type ConnectionStatus = 'disconnected' | 'pending' | 'connected' | 'error'

export interface RecordsConnection {
  id: 'primary'
  mode: RecordsMode
  status: ConnectionStatus
  categories: RecordCategory[]
  subject?: string
  pendingSession?: { id: string; externalId: string; categories: RecordCategory[]; startedAt: string }
  sources: RecordsSource[]
  consentReceiptIds: string[]
  connectedAt?: string
  lastSyncAt?: string
  syncStatus?: 'complete' | 'partial' | 'not_started'
  warnings: RecordsWarning[]
  skipped?: number
  lastError?: string
}
```

```ts
// app/src/records/categories.ts
import type { RecordCategory } from './types'
export const RECORD_CATEGORIES: readonly RecordCategory[] = ['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'] as const
export const CATEGORY_LABELS: Record<RecordCategory, string> = { demographics: 'About you', medications: 'Medications', conditions: 'Conditions', allergies: 'Allergies', labs: 'Lab results', vitals: 'Vital signs', immunizations: 'Immunizations' }
export function isRecordCategory(value: unknown): value is RecordCategory { return typeof value === 'string' && (RECORD_CATEGORIES as readonly string[]).includes(value) }
export function normalizeCategories(input: readonly unknown[]): RecordCategory[] { return RECORD_CATEGORIES.filter((c) => input.includes(c)) }
export function recordId(mode: 'demo' | 'live', category: RecordCategory, sourceRecordId: string | null, fallback: string): string { return `${mode}:${category}:${sourceRecordId ?? fallback}` }
```

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/categories.test.ts
import { describe, expect, it } from 'vitest'
import { isRecordCategory, normalizeCategories, RECORD_CATEGORIES, recordId } from './categories'

describe('categories', () => {
  it('lists the seven v1 categories in display order', () => {
    expect(RECORD_CATEGORIES).toEqual(['demographics', 'medications', 'conditions', 'allergies', 'labs', 'vitals', 'immunizations'])
  })
  it('filters unknown values and preserves canonical order', () => {
    expect(normalizeCategories(['labs', 'encounters', 'medications', 42])).toEqual(['medications', 'labs'])
    expect(isRecordCategory('claims')).toBe(false)
  })
  it('builds stable ids with a fallback', () => {
    expect(recordId('demo', 'labs', 'obs-1', 'x')).toBe('demo:labs:obs-1')
    expect(recordId('live', 'labs', null, 'h123')).toBe('live:labs:h123')
  })
})
```

- [ ] **Step 2: Run, implement (files above), run again**

Run: `cd app && npx vitest run src/records/categories.test.ts` → FAIL, then PASS (3 tests).

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
- Produces: `normalizeFhirRecordMap(recordMap: Record<string, unknown[]>, opts: { mode: 'demo' | 'live'; syncedAt: string; synthetic: boolean; sourceName: string | null }): NormalizeResult`, plus exported per-resource helpers `fhirText(codeable)`, `fhirCodings(codeable)`, `fhirDate(resource)`.
- Mapping rules:
  - `Patient` → `demographics`: `name` = official name `${given.join(' ')} ${family}`, `birthDate`, `gender`, `address` = `city, state postalCode` joined from `address[0]`, `phone`/`email` from `telecom` by `system`.
  - `MedicationRequest` / `MedicationStatement` → `medications`: `name` = `medicationCodeableConcept.text ?? coding.display`, `dosage` = `dosageInstruction[0].text ?? dosage[0].text`, `status`, `startDate` = `authoredOn ?? effectivePeriod.start ?? effectiveDateTime`, `endDate` = `effectivePeriod.end`, `prescriber` = `requester.display`, `reason` = `reasonCode[0].text`.
  - `Condition` → `conditions`: `name` = `code.text ?? code.coding.display`, `status` = `clinicalStatus.coding[0].code`, `verificationStatus` = `verificationStatus.coding[0].code`, `severity` = `severity.text ?? severity.coding.display`, `onsetDate` = `onsetDateTime ?? onsetPeriod.start`, `recordedDate`.
  - `AllergyIntolerance` → `allergies`: `substance` = `code.text ?? code.coding.display`, `reaction` = `reaction[0].manifestation[0].text ?? …coding.display`, `severity` = `reaction[0].severity ?? criticality`, `status` = `clinicalStatus.coding[0].code`, `verificationStatus`, `recordedDate`.
  - `Observation` → `labs` when `category[].coding[].code === 'laboratory'`, `vitals` when `'vital-signs'`; anything else → skipped. `value`: `valueQuantity.value` (number) or `valueString`/`valueCodeableConcept.text`; if `component[]` exists, `value` = components joined `"${v}/${v}"` for two numeric components (blood pressure) else `"name: v"` pairs joined by `, `; `unit` = `valueQuantity.unit ?? component[0].valueQuantity.unit`; `referenceRange` = `referenceRange[0].text ?? "${low}–${high} ${unit}"`; `interpretation` = `interpretation[0].text ?? coding.display`; `date` = `effectiveDateTime ?? effectivePeriod.start ?? issued`.
  - `DiagnosticReport` → `labs`: `name` = `code.text`, `value` = `conclusion ?? null`, `date` = `effectiveDateTime ?? issued`.
  - `Immunization` → `immunizations`: `name` = `vaccineCode.text ?? coding.display`, `code` = `vaccineCode.coding[0].code`, `status`, `date` = `occurrenceDateTime`, `manufacturer` = `manufacturer.display`, `lotNumber`.
  - Any other `resourceType`, or a resource missing a usable name/substance → `skipped += 1`.
  - `sourceRecordId` = resource `id`; `sourceName` = `meta.source ?? opts.sourceName`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/normalize/fhir.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/demo-records.json'
import { normalizeFhirRecordMap } from './fhir'

const opts = { mode: 'demo' as const, syncedAt: '2026-09-11T00:00:00Z', synthetic: true, sourceName: 'Northstar Health' }

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
    expect(String((bp as any).value)).toMatch(/^\d+\/\d+$/)
    expect((bp as any).unit).toBe('mmHg')
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

Add `"resolveJsonModule": true` to `app/tsconfig.json` `compilerOptions` if missing.

- [ ] **Step 2: Run to verify it fails, implement `fhir.ts` per the mapping rules, run to verify it passes**

Run: `cd app && npx vitest run src/records/normalize/fhir.test.ts`
Expected: 5 passed. (`Object.groupBy` exists in Node 24; if the TS lib complains, add `"lib": ["ES2024", "DOM", "DOM.Iterable"]` to `tsconfig.json`.)

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
- Produces: `normalizeFinchnodeHealthRecord(record: FinchnodeHealthRecord, opts: { syncedAt: string }): NormalizeResult & { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[] }` and the input type `FinchnodeHealthRecord` typed loosely from the vendored OpenAPI (`id`, `categories`, `consent.receiptIds`, `sources[]`, `data.{demographics, medications, conditions, labs, vitals, allergies, immunizations}`, `meta.{syncStatus, warnings, sources, availableCategories, missingCategories}`).
- Mapping: each FinchNode record already has the target field names; copy them, set `id = recordId('live', category, rec.id, rec.sourceRecordId ?? index)`, `date` = category-specific (`medications.startDate`, `conditions.onsetDate ?? recordedDate`, `labs/vitals.date`, `allergies.recordedDate`, `immunizations.date`, `demographics.birthDate`), `codes = rec.codes ?? []`, `sourceName = rec.sourceName ?? rec.source`, `synthetic: false`. `demographics` may be a single object with optional `records[]`: emit the object (and each of `records[]` if present). Missing arrays are treated as empty; a record without `name`/`substance` is skipped.

- [ ] **Step 1: Write the fixture**

`finchnode-health-record.json`: hand-write one `HealthRecord` following the vendored schema with `id: "u_0123456789abcdef"`, `categories` = all seven, `consent.receiptIds: ["rcpt_ABC123"]`, `sources: [{ system: "epic", organization: "Example Medical Center", lastSyncedAt: "2026-09-10T12:00:00Z" }]`, `data` with one record per category (ids `rec_` + 24 hex), `meta.syncStatus: "partial"`, `meta.warnings: [{ code: "category_unavailable", message: "Immunizations were not available from this source.", category: "immunizations", retryable: false }]`, `meta.missingCategories: ["immunizations"]`, `meta.changeCursor: "cur_1"`, `meta.disclaimer: "…"`. Fill every required field from the schema with plausible values (nulls where allowed).

- [ ] **Step 2: Write the failing test**

```ts
// app/src/records/normalize/finchnode.test.ts
import { describe, expect, it } from 'vitest'
import fixture from '../__fixtures__/finchnode-health-record.json'
import { normalizeFinchnodeHealthRecord } from './finchnode'

describe('normalizeFinchnodeHealthRecord', () => {
  const out = normalizeFinchnodeHealthRecord(fixture as any, { syncedAt: '2026-09-11T00:00:00Z' })

  it('copies normalized records with live ids and no synthetic flag', () => {
    expect(out.records.length).toBeGreaterThanOrEqual(7)
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

  it('handles demographics as an object with nested records', () => {
    const demo = out.records.filter((r) => r.category === 'demographics')
    expect(demo.length).toBeGreaterThanOrEqual(1)
  })

  it('tolerates missing arrays and skips nameless records', () => {
    const r = normalizeFinchnodeHealthRecord({ ...fixture, data: { medications: [{ id: 'rec_000000000000000000000000' }] } } as any, { syncedAt: 'now' })
    expect(r.records).toHaveLength(0)
    expect(r.skipped).toBe(1)
  })
})
```

- [ ] **Step 3: Run to verify it fails, implement, run to verify it passes**

Run: `cd app && npx vitest run src/records/normalize/finchnode.test.ts` → 4 passed.

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
import type { NormalizeResult, RecordCategory, RecordsMode, RecordsSource, RecordsWarning } from '../types'
export interface ConnectStart { sessionId: string; redirectUrl: string | null; expiresAt: string | null; completed: boolean; subject: string | null }
export type SessionStatus = 'pending' | 'collect-consented' | 'system-selected' | 'completed' | 'abandoned' | 'canceled' | 'expired' | 'failed'
export interface ConnectSessionState { id: string; status: SessionStatus; subject: string | null; grantedCategories: RecordCategory[]; warnings: RecordsWarning[]; expiresAt: string | null }
export interface RecordsSnapshot extends NormalizeResult { sources: RecordsSource[]; warnings: RecordsWarning[]; syncStatus: 'complete' | 'partial' | 'not_started'; consentReceiptIds: string[]; synthetic: boolean }
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
export interface HttpDeps { fetch?: typeof fetch }
/** JSON fetch that never leaks response bodies into thrown messages. */
export async function requestJson<T>(url: string, init: RequestInit & HttpDeps = {}): Promise<T> {
  const doFetch = init.fetch ?? fetch
  const res = await doFetch(url, { ...init, headers: { accept: 'application/json', ...(init.headers ?? {}) } })
  if (!res.ok) {
    let code: string | null = null
    try { code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? null } catch { /* ignore */ }
    const retry = res.headers.get('retry-after')
    throw new RecordsHttpError(friendlyStatus(res.status), res.status, retry ? Number(retry) || null : null, code)
  }
  return (await res.json()) as T
}
export function friendlyStatus(status: number): string {
  if (status === 429) return 'The records service is busy. Try again in a minute.'
  if (status === 401 || status === 403) return 'The records service refused the request. Check the relay settings.'
  if (status === 404) return 'The records service could not find this connection.'
  if (status === 410) return 'This connection has expired. Start again to reconnect.'
  return 'The records service is unavailable right now.'
}
```

- `demo.ts` exports `DEMO_BASE_URL = 'https://api.finchnode.com/demo/v1'`, `DEMO_PATIENT_ID = 'patient-demo-001'`, `createDemoProvider(deps?: HttpDeps): RecordsProvider`. `startConnect` → `POST ${base}/connect/sessions` JSON `{ external_user_id: externalId, categories }`; returns `{ sessionId: body.id ?? 'demo-session', redirectUrl: null, expiresAt: null, completed: true, subject: DEMO_PATIENT_ID }`. `getSession` → resolves `{ id, status: 'completed', subject: DEMO_PATIENT_ID, grantedCategories: [], warnings: [], expiresAt: null }` without a network call. `fetchSnapshot` → `GET ${base}/patients/${subject}/records?categories=${categories.join(',')}` then `normalizeFhirRecordMap(body.record, { mode: 'demo', syncedAt: new Date().toISOString(), synthetic: true, sourceName: 'Northstar Health (FinchNode sample)' })` and returns `{ ...result, sources: [{ system: body.source ?? 'finchnode-demo', organization: 'Northstar Health (sample)', lastSyncedAt: syncedAt }], warnings: [], syncStatus: 'complete', consentReceiptIds: [], synthetic: true }`.
- `relay.ts` exports `createRelayProvider(config: { baseUrl: string; token: string | null }, deps?: HttpDeps): RecordsProvider`. Base URL is trimmed of trailing slashes and must start with `https://` or `http://localhost`/`http://127.0.0.1` (throw otherwise). Header `X-Lunara-Relay-Token` when token set. `startConnect` → `POST ${base}/v1/connect/sessions` `{ categories, returnUrl, externalId }` → `{ sessionId: body.id, redirectUrl: body.url, expiresAt: body.expiresAt, completed: false, subject: null }`. `getSession` → `GET ${base}/v1/connect/sessions/${id}` → map `status`, `subject`, `sync.grantedCategories` (filtered by `normalizeCategories`), `sync.warnings`, `expiresAt`. `fetchSnapshot` → `GET ${base}/v1/users/${subject}/records?categories=…` → `normalizeFinchnodeHealthRecord(body, { syncedAt })` and `synthetic: false`.

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
      expect(JSON.parse(String(init?.body))).toEqual({ external_user_id: 'ext_1', categories: ['labs'] })
      return { body: { id: 'demo_cs_1', status: 'completed' } }
    })
    const p = createDemoProvider({ fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'http://localhost/', externalId: 'ext_1' })).toMatchObject({ completed: true, subject: DEMO_PATIENT_ID, redirectUrl: null })
  })

  it('fetches and normalizes the synthetic snapshot', async () => {
    const fetch = fakeFetch((url) => {
      expect(url).toBe(`${DEMO_BASE_URL}/patients/${DEMO_PATIENT_ID}/records?categories=labs,vitals`)
      return { body: fixture }
    })
    const snap = await createDemoProvider({ fetch }).fetchSnapshot(DEMO_PATIENT_ID, ['labs', 'vitals'])
    expect(snap.synthetic).toBe(true)
    expect(snap.records.length).toBeGreaterThan(0)
    expect(snap.sources[0].organization).toContain('Northstar')
  })

  it('turns 429 into a friendly retryable error', async () => {
    const fetch = fakeFetch(() => ({ status: 429, headers: { 'retry-after': '30' }, body: { error: { code: 'rate_limited' } } }))
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
    expect(() => createRelayProvider({ baseUrl: 'http://relay.example.com', token: null })).toThrow(/https/)
  })

  it('starts a hosted connect session with the token header', async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://relay.example.com/v1/connect/sessions')
      expect(new Headers(init.headers).get('x-lunara-relay-token')).toBe('tok')
      expect(JSON.parse(String(init.body))).toEqual({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'ext_1' })
      return ok({ id: 'cs_0123456789abcdef0123', url: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', status: 'pending' })
    }) as unknown as typeof fetch
    const p = createRelayProvider({ baseUrl: 'https://relay.example.com/', token: 'tok' }, { fetch })
    expect(await p.startConnect({ categories: ['labs'], returnUrl: 'https://app/?records=return', externalId: 'ext_1' })).toEqual({ sessionId: 'cs_0123456789abcdef0123', redirectUrl: 'https://connect.finchnode.com/s/1', expiresAt: '2026-09-12T00:00:00Z', completed: false, subject: null })
  })

  it('reads session state', async () => {
    const fetch = vi.fn(async () => ok({ id: 'cs_1', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', grantedCategories: ['labs', 'claims'], warnings: [] } })) as unknown as typeof fetch
    const s = await createRelayProvider({ baseUrl: 'https://r', token: null }, { fetch }).getSession('cs_1')
    expect(s).toMatchObject({ status: 'completed', subject: 'u_0123456789abcdef', grantedCategories: ['labs'] })
  })

  it('fetches and normalizes a live snapshot', async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe('https://r/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
      return ok(fixture)
    }) as unknown as typeof fetch
    const snap = await createRelayProvider({ baseUrl: 'https://r', token: null }, { fetch }).fetchSnapshot('u_0123456789abcdef', ['labs', 'vitals'])
    expect(snap.synthetic).toBe(false)
    expect(snap.consentReceiptIds).toEqual(['rcpt_ABC123'])
  })
})
```

- [ ] **Step 2: Run to verify they fail, implement the four files, run to verify they pass**

Run: `cd app && npx vitest run src/records/providers` → 7 passed.

- [ ] **Step 3: Commit**

```bash
git add app/src/records/providers
git commit -m "Add FinchNode demo and relay record providers"
```

### Task 17: Sealed records store (Dexie v4)

**Files:**
- Modify: `app/src/db/schema.ts` (version 4 + tables + `SK.recordsRelayUrl`)
- Create: `app/src/records/store.ts`
- Test: `app/src/records/store.test.ts`

**Interfaces:**
- `schema.ts` adds:
  ```ts
  export interface SealedRecordRow { id: string; category: RecordCategory; date: string | null; sealed: SealedBlob }
  medicalRecords!: Table<SealedRecordRow, string>
  recordsConnection!: Table<RecordsConnection, string>
  this.version(4).stores({ ...all v3 tables..., medicalRecords: 'id, category, date', recordsConnection: 'id' })
  ```
  and `SK.recordsRelayUrl: 'recordsRelayUrl'`.
- `store.ts` produces: `getConnection(): Promise<RecordsConnection>` (default disconnected object when absent), `putConnection(patch: Partial<RecordsConnection>): Promise<RecordsConnection>`, `putSnapshot(records: MedicalRecord[], categories: RecordCategory[], connectionPatch: Partial<RecordsConnection>): Promise<void>` (one `rw` transaction on both tables: delete rows whose `category` is in `categories`, `bulkPut` sealed rows, merge the connection patch), `listRecords(category?: RecordCategory): Promise<MedicalRecord[]>` (opened, sorted by `date` desc with nulls last), `countByCategory(): Promise<Record<RecordCategory, number>>`, `clearRecords(): Promise<void>` (both tables). Sealing uses `getSealingKey()` from Task 2; sealing/opening happens outside the Dexie transaction (compute sealed rows first, then run the transaction; on read, fetch rows then open).
- `defaultConnection(): RecordsConnection` = `{ id: 'primary', mode: 'demo', status: 'disconnected', categories: [...RECORD_CATEGORIES], sources: [], consentReceiptIds: [], warnings: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/records/store.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/schema'
import { deleteKeyStore } from '../platform/keyStore'
import type { MedicalRecord } from './types'
import { clearRecords, countByCategory, getConnection, listRecords, putConnection, putSnapshot } from './store'

const lab = (id: string, date: string | null): MedicalRecord => ({ id: `demo:labs:${id}`, category: 'labs', sourceRecordId: id, sourceName: 'S', date, codes: [], syncedAt: 'now', synthetic: true, name: `Lab ${id}`, value: 1, unit: 'u', status: 'final', referenceRange: null, interpretation: null })
const med = (id: string): MedicalRecord => ({ id: `demo:medications:${id}`, category: 'medications', sourceRecordId: id, sourceName: 'S', date: '2026-01-01', codes: [], syncedAt: 'now', synthetic: true, name: `Med ${id}`, dosage: null, frequency: null, status: 'active', startDate: '2026-01-01', endDate: null, prescriber: null, reason: null })

describe('records store', () => {
  beforeEach(async () => {
    await clearRecords()
    await deleteKeyStore()
  })

  it('starts disconnected with all categories selected', async () => {
    expect(await getConnection()).toMatchObject({ id: 'primary', status: 'disconnected', categories: expect.arrayContaining(['labs', 'vitals']) })
  })

  it('stores sealed rows and reads them back sorted by date', async () => {
    await putSnapshot([lab('a', '2026-02-01'), lab('b', null), lab('c', '2026-03-01')], ['labs'], { status: 'connected', mode: 'demo' })
    const raw = await db.medicalRecords.toArray()
    expect(JSON.stringify(raw)).not.toContain('Lab a')
    expect(raw[0].sealed.v).toBe(1)
    const labs = await listRecords('labs')
    expect(labs.map((r) => r.sourceRecordId)).toEqual(['c', 'a', 'b'])
    expect((await getConnection()).status).toBe('connected')
  })

  it('refresh replaces only the refreshed categories', async () => {
    await putSnapshot([lab('a', '2026-02-01'), med('m1')], ['labs', 'medications'], {})
    await putSnapshot([lab('z', '2026-04-01')], ['labs'], {})
    expect(await countByCategory()).toMatchObject({ labs: 1, medications: 1 })
    expect((await listRecords('labs'))[0].sourceRecordId).toBe('z')
  })

  it('clearRecords empties both tables', async () => {
    await putSnapshot([med('m1')], ['medications'], { status: 'connected' })
    await putConnection({ subject: 'u_x' })
    await clearRecords()
    expect(await db.medicalRecords.count()).toBe(0)
    expect((await getConnection()).status).toBe('disconnected')
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement schema v4 + `store.ts`, run to verify it passes**

Run: `cd app && npx vitest run src/records/store.test.ts src/db` → store tests 4 passed; existing schema tests still pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/db/schema.ts app/src/records/store.ts app/src/records/store.test.ts
git commit -m "Store medical records sealed at rest in Dexie v4"
```

### Task 18: Consent purpose and export/import v2

**Files:**
- Modify: `app/src/db/schema.ts` (`ConsentPurpose` union), `app/src/db/transfer.ts`
- Test: `app/src/db/transfer.test.ts` (new)

**Interfaces:**
- `ConsentPurpose` gains `'medical-records'`. `createDefaultHealthProfile` is unchanged (ledger entries are added when decided).
- `transfer.ts`: `ExportPayload` becomes `{ app: 'lunara'; v: 2; exportedAt; dailyLogs; settings; contentBookmarks; medicalRecords: MedicalRecord[]; recordsConnection: Omit<RecordsConnection, 'pendingSession'> | null }`. `collectExport()` opens records via `listRecords()` and reads the connection via `getConnection()` (drop `pendingSession`; `null` when `status === 'disconnected'`). `applyImport(payload: ExportPayload | LegacyExportPayloadV1)` accepts `v: 1` (no records) and `v: 2` (calls `putSnapshot(records, categoriesPresent, connection ?? {})` when records exist). `SECRET_KEYS` also excludes `SK.recordsRelayUrl`? No: the relay URL is not secret; keep it exportable. The relay token lives in the vault and is never exported.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/db/transfer.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteKeyStore } from '../platform/keyStore'
import { clearRecords, getConnection, listRecords, putSnapshot } from '../records/store'
import type { MedicalRecord } from '../records/types'
import { db } from './schema'
import { applyImport, collectExport } from './transfer'

const cond: MedicalRecord = { id: 'live:conditions:rec_1', category: 'conditions', sourceRecordId: 'rec_1', sourceName: 'Clinic', date: '2021-03-12', codes: [], syncedAt: 'now', synthetic: false, name: 'Example condition', status: 'active', verificationStatus: 'confirmed', severity: null, onsetDate: '2021-03-12', recordedDate: null }

describe('transfer v2', () => {
  beforeEach(async () => {
    await db.dailyLogs.clear()
    await db.settings.clear()
    await clearRecords()
    await deleteKeyStore()
  })

  it('exports opened records and the connection without pendingSession', async () => {
    await putSnapshot([cond], ['conditions'], { status: 'connected', mode: 'live', subject: 'u_x', pendingSession: { id: 'cs_1', externalId: 'e', categories: ['conditions'], startedAt: 'now' } })
    const payload = await collectExport()
    expect(payload.v).toBe(2)
    expect(payload.medicalRecords).toEqual([cond])
    expect(payload.recordsConnection).toMatchObject({ status: 'connected', subject: 'u_x' })
    expect(payload.recordsConnection).not.toHaveProperty('pendingSession')
  })

  it('imports a v2 payload', async () => {
    await applyImport({ app: 'lunara', v: 2, exportedAt: 'now', dailyLogs: [{ date: '2026-01-01', flow: 'light' }], settings: [], contentBookmarks: [], medicalRecords: [cond], recordsConnection: { id: 'primary', mode: 'live', status: 'connected', categories: ['conditions'], sources: [], consentReceiptIds: [], warnings: [] } })
    expect(await listRecords('conditions')).toEqual([cond])
    expect((await getConnection()).status).toBe('connected')
  })

  it('still imports a v1 payload', async () => {
    const n = await applyImport({ app: 'lunara', v: 1, exportedAt: 'now', dailyLogs: [{ date: '2026-01-02' }], settings: [], contentBookmarks: [] } as any)
    expect(n).toBe(1)
    expect(await db.medicalRecords.count()).toBe(0)
  })

  it('rejects other apps', async () => {
    await expect(applyImport({ app: 'other', v: 2 } as any)).rejects.toThrow(/Lunara export/)
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement, run to verify it passes**

Run: `cd app && npx vitest run src/db/transfer.test.ts` → 4 passed. Also `npx tsc --noEmit` (Settings.tsx uses `applyImport`/`collectExport`; types still line up).

- [ ] **Step 3: Commit**

```bash
git add app/src/db
git commit -m "Add the medical-records consent purpose and export format v2"
```

### Task 19: Connection orchestration and return handling

**Files:**
- Create: `app/src/records/connect.ts`, `app/src/records/returnHandler.ts`
- Test: `app/src/records/connect.test.ts`, `app/src/records/returnHandler.test.ts`

**Interfaces:**

```ts
// connect.ts
export interface ConnectDeps { provider: RecordsProvider; now?: () => string; randomId?: () => string; navigate?: (url: string) => void; sleep?: (ms: number) => Promise<void> }
export async function grantRecordsConsent(): Promise<void>       // appends {purpose:'medical-records', state:'granted', version:1, decidedAt} to the profile ledger (replacing any prior entry for that purpose) via putHealthProfile
export async function hasRecordsConsent(): Promise<boolean>
export async function startConnection(categories: RecordCategory[], deps: ConnectDeps): Promise<'connected' | 'redirected'>
//   requires hasRecordsConsent() else throws Error('consent-required');
//   externalId = randomId() (default: 16 random bytes base64url);
//   returnUrl = `${location.origin}/?records=return&session=`  (sessionId appended after startConnect);
//   demo: startConnect → completed → syncSnapshot(subject) → 'connected'
//   live: putConnection({status:'pending', mode:'live', categories, pendingSession}) then navigate(redirectUrl) → 'redirected'
export async function completePendingConnection(sessionId: string | null, deps: ConnectDeps): Promise<RecordsConnection>
//   resolves session id from arg or pendingSession; polls provider.getSession every 2 s up to 30 attempts;
//   'completed' + subject → putConnection({subject, pendingSession: undefined}) then syncSnapshot; terminal → status 'error' with friendly lastError; timeout → 'error' "Still waiting for your provider. Try refreshing."
export async function syncSnapshot(deps: ConnectDeps): Promise<RecordsConnection>
//   uses connection.subject + connection.categories; on success putSnapshot(records, categories, {status:'connected', sources, consentReceiptIds, lastSyncAt, syncStatus, warnings, skipped, connectedAt: connectedAt ?? now, lastError: undefined});
//   on RecordsHttpError → putConnection({status: 'error', lastError: message + (retryAfterSeconds ? ` Try again in ${n} seconds.` : '')}); on other errors → generic message. Never rethrows; returns the connection.
export async function disconnectAndDelete(): Promise<void>
//   clearRecords(); ledger entry 'declined' for 'medical-records'
export function providerFor(connection: RecordsConnection, relay: { baseUrl: string | null; token: string | null }): RecordsProvider
//   'demo' → createDemoProvider(); 'live' → createRelayProvider (throws Error('relay-required') when baseUrl null)
```

```ts
// returnHandler.ts
export interface ReturnParams { isReturn: boolean; sessionId: string | null }
export function readReturnParams(search: string): ReturnParams   // parses ?records=return&session=cs_…; sessionId only when it matches /^cs_[a-f0-9]{20}$/, else null
export function stripReturnParams(): void                        // history.replaceState(null, '', location.pathname) — call before any await
```

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/records/connect.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getHealthProfile } from '../db/schema'
import { deleteKeyStore } from '../platform/keyStore'
import { completePendingConnection, disconnectAndDelete, grantRecordsConsent, hasRecordsConsent, startConnection, syncSnapshot } from './connect'
import type { RecordsProvider } from './providers/types'
import { RecordsHttpError } from './providers/types'
import { clearRecords, getConnection, listRecords } from './store'
import type { MedicalRecord } from './types'

const rec: MedicalRecord = { id: 'demo:labs:o1', category: 'labs', sourceRecordId: 'o1', sourceName: 'S', date: '2026-01-01', codes: [], syncedAt: 'now', synthetic: true, name: 'A1c', value: 6, unit: '%', status: 'final', referenceRange: null, interpretation: null }
const snapshot = { records: [rec], skipped: 0, sources: [{ system: 'demo', organization: 'Northstar', lastSyncedAt: 'now' }], warnings: [], syncStatus: 'complete' as const, consentReceiptIds: [], synthetic: true }

function demoProvider(): RecordsProvider {
  return { mode: 'demo', startConnect: vi.fn(async () => ({ sessionId: 'd1', redirectUrl: null, expiresAt: null, completed: true, subject: 'patient-demo-001' })), getSession: vi.fn(), fetchSnapshot: vi.fn(async () => snapshot) }
}
function liveProvider(states: Array<{ status: any; subject: string | null }>): RecordsProvider {
  let i = 0
  return { mode: 'live', startConnect: vi.fn(async () => ({ sessionId: 'cs_0123456789abcdef0123', redirectUrl: 'https://connect/x', expiresAt: null, completed: false, subject: null })), getSession: vi.fn(async () => ({ id: 'cs_0123456789abcdef0123', ...states[Math.min(i++, states.length - 1)], grantedCategories: [], warnings: [], expiresAt: null })), fetchSnapshot: vi.fn(async () => ({ ...snapshot, synthetic: false })) }
}
const deps = { now: () => '2026-09-11T00:00:00Z', randomId: () => 'ext_fixed', sleep: async () => {} }

describe('connect', () => {
  beforeEach(async () => {
    await db.healthProfiles.clear()
    await db.settings.clear()
    await clearRecords()
    await deleteKeyStore()
    ;(globalThis as any).location = { origin: 'https://app.test' }
  })

  it('requires consent before connecting', async () => {
    expect(await hasRecordsConsent()).toBe(false)
    await expect(startConnection(['labs'], { provider: demoProvider(), ...deps })).rejects.toThrow('consent-required')
    await grantRecordsConsent()
    expect(await hasRecordsConsent()).toBe(true)
    expect((await getHealthProfile()).privacy.consentLedger.find((c) => c.purpose === 'medical-records')?.state).toBe('granted')
  })

  it('demo mode connects and stores the snapshot in one go', async () => {
    await grantRecordsConsent()
    expect(await startConnection(['labs'], { provider: demoProvider(), ...deps })).toBe('connected')
    expect(await getConnection()).toMatchObject({ mode: 'demo', status: 'connected', subject: 'patient-demo-001', categories: ['labs'], lastSyncAt: deps.now() })
    expect(await listRecords('labs')).toHaveLength(1)
  })

  it('live mode stores a pending session and redirects', async () => {
    await grantRecordsConsent()
    const navigate = vi.fn()
    const provider = liveProvider([])
    expect(await startConnection(['labs'], { provider, navigate, ...deps })).toBe('redirected')
    expect(provider.startConnect).toHaveBeenCalledWith({ categories: ['labs'], returnUrl: 'https://app.test/?records=return&session=', externalId: 'ext_fixed' })
    expect(navigate).toHaveBeenCalledWith('https://connect/x')
    expect(await getConnection()).toMatchObject({ mode: 'live', status: 'pending', pendingSession: { id: 'cs_0123456789abcdef0123', externalId: 'ext_fixed' } })
  })

  it('completes a pending session after polling', async () => {
    await grantRecordsConsent()
    const provider = liveProvider([{ status: 'pending', subject: null }, { status: 'completed', subject: 'u_0123456789abcdef' }])
    await startConnection(['labs'], { provider, navigate: () => {}, ...deps })
    const c = await completePendingConnection(null, { provider, ...deps })
    expect(c).toMatchObject({ status: 'connected', subject: 'u_0123456789abcdef' })
    expect(c.pendingSession).toBeUndefined()
    expect(provider.getSession).toHaveBeenCalledTimes(2)
  })

  it('maps terminal session states to an error', async () => {
    await grantRecordsConsent()
    const provider = liveProvider([{ status: 'expired', subject: null }])
    await startConnection(['labs'], { provider, navigate: () => {}, ...deps })
    expect(await completePendingConnection(null, { provider, ...deps })).toMatchObject({ status: 'error', lastError: expect.stringMatching(/expired/i) })
  })

  it('records a friendly error when the snapshot fails', async () => {
    await grantRecordsConsent()
    const provider = demoProvider()
    await startConnection(['labs'], { provider, ...deps })
    ;(provider.fetchSnapshot as any).mockRejectedValueOnce(new RecordsHttpError('The records service is busy. Try again in a minute.', 429, 30, 'rate_limited'))
    expect(await syncSnapshot({ provider, ...deps })).toMatchObject({ status: 'error', lastError: expect.stringContaining('30 seconds') })
  })

  it('disconnect deletes everything and declines consent', async () => {
    await grantRecordsConsent()
    await startConnection(['labs'], { provider: demoProvider(), ...deps })
    await disconnectAndDelete()
    expect(await db.medicalRecords.count()).toBe(0)
    expect((await getConnection()).status).toBe('disconnected')
    expect((await getHealthProfile()).privacy.consentLedger.find((c) => c.purpose === 'medical-records')?.state).toBe('declined')
  })
})
```

```ts
// app/src/records/returnHandler.test.ts
import { describe, expect, it } from 'vitest'
import { readReturnParams } from './returnHandler'

describe('readReturnParams', () => {
  it('detects a valid return', () => {
    expect(readReturnParams('?records=return&session=cs_0123456789abcdef0123')).toEqual({ isReturn: true, sessionId: 'cs_0123456789abcdef0123' })
  })
  it('drops malformed session ids but keeps the return flag', () => {
    expect(readReturnParams('?records=return&session=<script>')).toEqual({ isReturn: true, sessionId: null })
  })
  it('ignores unrelated queries', () => {
    expect(readReturnParams('?preview=onboarding')).toEqual({ isReturn: false, sessionId: null })
  })
})
```

- [ ] **Step 2: Run to verify they fail, implement both modules, run to verify they pass**

Run: `cd app && npx vitest run src/records/connect.test.ts src/records/returnHandler.test.ts` → 10 passed.

- [ ] **Step 3: Commit**

```bash
git add app/src/records
git commit -m "Orchestrate FinchNode connections, polling, refresh and disconnect"
```

### Task 20: Records tab and screens

**Files:**
- Modify: `app/src/components/TabBar.tsx`, `app/src/state/appStore.ts`, `app/src/App.tsx`, `app/src/main.tsx`
- Create: `app/src/screens/RecordsScreen.tsx`, `app/src/components/RecordsCategoryList.tsx`, `app/src/components/RecordsReturnHandler.tsx`, `app/src/styles/records.css`

**Interfaces:**
- `Tab` gains `'records'`; `TABS` inserts `{ id: 'records', label: 'Records', icon: 'M6 4h9l4 4v12H6z M9 12h6M9 16h6' }` before settings.
- `appStore` gains `recordsCategory: RecordCategory | null`, `setRecordsCategory`, `recordsReturn: { sessionId: string | null } | null`, `setRecordsReturn`.
- `main.tsx`: before rendering, `const ret = readReturnParams(window.location.search); if (ret.isReturn) { stripReturnParams(); useApp.getState().setRecordsReturn({ sessionId: ret.sessionId }) }`.
- `App.tsx`: render `<RecordsScreen />` for `tab === 'records'`; render `<RecordsReturnHandler />` (no UI of its own; it runs `completePendingConnection` once when `recordsReturn` is set, switches `tab` to `'records'`, then clears `recordsReturn`).
- `RecordsScreen` reads the connection via `useLiveQuery(getConnection)`, counts via `useLiveQuery(countByCategory)`, relay settings via `getSetting(SK.recordsRelayUrl)` + `getSecureSecret(SECURE_SECRET_KEYS.recordsRelayToken)`, and renders the four states from spec C5 with these exact strings:
  - Heading: "Your medical records"
  - Intro: "Bring conditions, medications, labs and more from your provider into Lunara. They stay in this browser, encrypted, and are never sent anywhere else."
  - Consent checkbox: "I understand that connecting sends my chosen categories to FinchNode (and to my relay in live mode), and that the records are stored only in this browser."
  - Buttons: "Try with sample data", "Connect my provider" (disabled hint: "Add a relay URL in Settings to connect a real provider."), "Refresh", "Disconnect and delete".
  - Demo banner: "Sample data from FinchNode's fictional Northstar Health. Nothing here is about you."
  - Pending: "Finishing your connection" / "Cancel".
  - Error card shows `lastError` with "Try again" (calls `syncSnapshot` or `completePendingConnection` depending on `pendingSession`) and "Disconnect".
  - Source card: organization, "Last synced {date}", `syncStatus === 'partial'` → "Some categories were not available" with the warnings, `skipped > 0` → "{n} items could not be read".
- `RecordsCategoryList` props `{ category: RecordCategory; onBack(): void }`: header with `CATEGORY_LABELS[category]`, rows: primary line = `name`/`substance`, secondary = category-specific detail (`dosage · status`, `status · onset {date}`, `value unit · {date}` with `referenceRange` muted, `reaction · severity`, `status · {date}`), tertiary = `sourceName`. Empty state: "Nothing in this category from your provider."
- Every user-triggered action wraps in try/catch and sets a local `status` string; never `alert()`.

- [ ] **Step 1: Wire the tab, store and return handler; build the screens**

Write the components following the interface above. Reuse existing classes: `.page`, `.card`, `.section-label`, `.cta`, `.overlay` (for the category list). Put new rules in `records.css` under a `.records-` prefix (banner, source card, count grid `grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`, row layout). Import `records.css` in `main.tsx`.

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

**Interfaces:**
- `privacy/destinations.ts` exports `PRIVACY_DESTINATIONS: { destination: string; when: string; sent: string; offByDefault: true }[]` with the six rows from spec section 8 (verbatim text) — the single source used by the UI and copied into `PRIVACY.md`.
- `PrivacyTable` renders that array as a responsive table (`<table class="privacy-table">`, stacked rows under 560px).
- Settings gains two cards:
  - "Medical records": relay URL input (validated `https://` or localhost, saved to `SK.recordsRelayUrl` on blur), relay token password input (saved to the vault key `records-relay-token`; shows "Saved" / "Not set", never echoes the value), current mode line, link button "Open Records".
  - "Privacy and data": `<PrivacyTable />` plus a paragraph "Full details in PRIVACY.md in the repository." The existing "Delete all data" handler additionally calls `clearRecords()` and `destroySecureVault()`.
- DoctorReport gains `includeProviderRecords` (default `false`) next to the other opt-ins, labelled "Records from your provider". When on, render a section "Records from your provider" with three sub-lists (active conditions, active medications, allergies) from `listRecords(...)`, each row `name — status — date — source`, and a footnote "Imported via FinchNode on {lastSyncAt}. Not verified by Lunara." When the connection is demo, prefix the footnote with "Sample data. ".

- [ ] **Step 1: Implement the three changes**

- [ ] **Step 2: Verify**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`; in the browser: set a relay URL, confirm it persists after reload; open the doctor's report with the demo connection, toggle the provider-records section, print preview shows it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add records settings, the privacy table, and provider records in the doctor report"
```

### Task 22: Records relay Worker

**Files:**
- Create: `workers/records-relay/package.json`, `workers/records-relay/wrangler.toml`, `workers/records-relay/src/index.js`, `workers/records-relay/src/index.test.js`, `workers/records-relay/README.md`

**Interfaces:** routes and validation from spec C2. `export default { fetch(request, env) }`. Env: `FINCHNODE_API_KEY` (secret), `ALLOWED_ORIGINS`, `RELAY_CLIENT_TOKEN` (optional), `FINCHNODE_BASE_URL` (default `https://api.finchnode.com/api/v1`). `package.json` mirrors `workers/backup/package.json` with name `@lunara/records-relay-worker`. `wrangler.toml`: `name = "lunara-records-relay"`, `main = "src/index.js"`, `compatibility_date = "2026-01-01"`, `[vars] ALLOWED_ORIGINS = "http://localhost:5173"`, and a comment `# wrangler secret put FINCHNODE_API_KEY`.

- [ ] **Step 1: Write the failing tests**

```js
// workers/records-relay/src/index.test.js
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = { FINCHNODE_API_KEY: 'ck_test_placeholder', ALLOWED_ORIGINS: 'https://app.example', RELAY_CLIENT_TOKEN: 'tok' }
const origin = { origin: 'https://app.example', 'x-lunara-relay-token': 'tok' }
let upstream

beforeEach(() => {
  upstream = vi.fn(async () => new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: 'later', status: 'pending', object: 'connect_session' }), { status: 201, headers: { 'content-type': 'application/json' } }))
  globalThis.fetch = upstream
})

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

  it('requires the client token when configured', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://app.example/?records=return&session=', externalId: 'abcdefghijklmnop' }, { origin: 'https://app.example' })
    expect(res.status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('creates a connect session with an allowlisted body and bearer key', async () => {
    const res = await call('POST', '/v1/connect/sessions', { categories: ['labs', 'claims'], returnUrl: 'https://app.example/?records=return&session=', externalId: 'abcdefghijklmnop', evil: true })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'cs_0123456789abcdef0123', url: 'https://connect/x', expiresAt: 'later', status: 'pending' })
    const [url, init] = upstream.mock.calls[0]
    expect(url).toBe('https://api.finchnode.com/api/v1/connect/sessions')
    expect(init.headers.authorization).toBe('Bearer ck_test_placeholder')
    expect(init.headers['idempotency-key']).toBe('abcdefghijklmnop')
    expect(JSON.parse(init.body)).toEqual({ categories: ['labs'], returnUrl: 'https://app.example/?records=return&session=', externalId: 'abcdefghijklmnop', syncMode: 'one-time', durationDays: 365 })
  })

  it('rejects return urls outside the allowed origins and bad ids', async () => {
    expect((await call('POST', '/v1/connect/sessions', { categories: ['labs'], returnUrl: 'https://evil.example/', externalId: 'abcdefghijklmnop' })).status).toBe(400)
    expect((await call('GET', '/v1/connect/sessions/nope')).status).toBe(400)
    expect((await call('GET', '/v1/users/u_zz/records')).status).toBe(400)
  })

  it('proxies session state and snapshots with no-store and passes rate-limit headers', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', grantedCategories: ['labs'], warnings: [] }, categories: ['labs'] }), { status: 200 }))
    const s = await call('GET', '/v1/connect/sessions/cs_0123456789abcdef0123')
    expect(await s.json()).toEqual({ id: 'cs_0123456789abcdef0123', status: 'completed', subject: 'u_0123456789abcdef', expiresAt: null, sync: { status: 'complete', grantedCategories: ['labs'], warnings: [] } })
    upstream.mockResolvedValueOnce(new Response('{"object":"health_record"}', { status: 200, headers: { 'ratelimit-remaining': '9', 'retry-after': '1' } }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records?categories=labs,vitals')
    expect(upstream.mock.calls[1][0]).toBe('https://api.finchnode.com/api/v1/users/u_0123456789abcdef/records?categories=labs%2Cvitals')
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(r.headers.get('ratelimit-remaining')).toBe('9')
  })

  it('forwards upstream errors without leaking the key', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'consent_expired', message: 'x' } }), { status: 410 }))
    const r = await call('GET', '/v1/users/u_0123456789abcdef/records')
    expect(r.status).toBe(410)
    expect(await r.text()).not.toContain('ck_test')
  })
})
```

- [ ] **Step 2: Run to verify they fail, implement `src/index.js`, run to verify they pass**

Run: `cd workers/records-relay && pnpm install && pnpm test` → 6 passed. Implementation notes: build `categories` with a fixed allowlist array of the seven categories; `timingSafeEqual` via `crypto.subtle.digest` comparison of SHA-256 of both tokens; forward only the whitelisted response fields for sessions; snapshots are streamed through as-is with `content-type: application/json` and `cache-control: private, no-store`; copy `retry-after`, `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset` from upstream when present; a 403 for disallowed origins on every method.

- [ ] **Step 3: README**

Write `workers/records-relay/README.md` following spec C2's README bullet list, with a "What the relay can and cannot see" section and the exact `wrangler` commands.

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

Sections: "Summary" (three sentences), "What leaves your browser" (the table generated from `PRIVACY_DESTINATIONS`, same wording), "What is stored and how" (Dexie tables; sealed records and secrets; the browser-managed key; PIN and device unlock are screen gates), "Threat model" (spec section 8 paragraph), "Medical records via FinchNode" (demo vs live, the relay, FinchNode's own consent receipts and how to revoke at the source), "Deleting your data" (Disconnect and delete; Delete all data; clearing site data), "No tracking" (no analytics, cookies, third-party scripts; CSP enforced by `_headers`).

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

- **Spec coverage:** A1 → T6; A2 → T1–T3; A3 → T4; A4 → T5; A5 → T7; A6 → T12; B1 → T9; B2/B3 → T10–T11; C1 → T16; C2 → T22; C3 → T13–T15; C4 → T17–T18; C5 → T20–T21; C6 → T16/T19/T20; D → T21/T23; testing section → each task; phasing → three phases with a final verification in T23. Phase 4 (adversarial review) is run by the orchestrator, not this plan.
- **Type consistency:** `RecordsConnection`, `MedicalRecord`, `RecordsProvider`, `RecordsSnapshot`, `SealedBlob`, `getSealingKey`, `putSnapshot`, `listRecords`, `getConnection`, `clearRecords`, `normalizeCategories`, `recordId`, `RecordsHttpError` are defined once (T1, T2, T13, T16, T17) and used with those names in T18–T21.
- **Known judgement calls left to the implementer:** exact class names in `app.css` for T11/T12; which Onboarding step ids belong to the Apple Health import in T6; the shape of the hand-written FinchNode fixture in T15 (must satisfy the vendored schema).
