# Lunara Web: privacy-first browser app with FinchNode medical records

Date: 2026-09-10
Status: implemented on `feat/web-app-finchnode` (2026-09-11); reviewed by Codex gpt-6-astra, hardened in Phase 4
Branch: `feat/web-app-finchnode`
Upstream: https://github.com/Blueturboguy07/lunara (AGPL-3.0). This fork keeps the
license, the name, and attribution.

## 1. Goal

Turn Lunara from a Capacitor-wrapped phone app into a **browser-first web app**
that:

1. runs entirely in the browser with no Lunara-hosted account or user database;
2. lets a user pull their own medical records (conditions, medications, labs,
   vitals, allergies, immunizations, demographics) from their provider through
   **FinchNode**, and keeps those records on the device, encrypted at rest;
3. uses the **Aileron** typeface and a **baby pink + baby red** palette;
4. is privacy-first by construction: every byte that leaves the browser is
   opt-in, purpose-scoped, and listed in one place the user can read.

## 2. Non-goals (v1)

- No iOS/Android shells, widgets, HealthKit or Health Connect. They are removed,
  not maintained in parallel.
- No cross-device sync, accounts, analytics, or telemetry of any kind.
- No FinchNode `encounters`, `documents`, `claims` categories, no continuous
  sync or webhooks. Snapshot reads only.
- Records are never sent to the optional AI assistant in v1.
- No product rename or new logo. Only palette and type change.
- No clinical interpretation of imported records. They are displayed and
  included in the doctor's report; the cycle engines do not consume them.

## 3. Assumptions made without user input

The user asked for autonomous execution. These calls were made and can be
reversed later:

| Decision | Choice | Alternative considered |
| --- | --- | --- |
| Where FinchNode's server-side API key lives | A tiny self-hostable Cloudflare Worker relay (matches Lunara's existing `workers/` pattern) | Bring-your-own key in the browser (rejected: FinchNode forbids browser-held keys) |
| Default records mode | FinchNode's public synthetic **demo** API, so the feature works with zero setup | Live-only (rejected: nothing to demo without credentials) |
| Native shells | Deleted from the tree | Kept but unbuilt (rejected: dead code, misleading README) |
| Fifth tab | Add **Records** to the tab bar | Bury it in Settings (rejected: it is a headline feature) |
| "Baby red" | Soft coral-red family anchored on `#F08080` | Pure pastel red `#FF6B6B` (harsher on pink surfaces) |
| Font loading | `@fontsource/aileron` npm package (CC0, self-hosted, no CDN) | Downloading the Open Foundry zip (same font, manual vendoring) |

## 4. Architecture

```text
Browser (single origin, no cookies, no third-party scripts)
├── React 18 + Vite 6 + TypeScript (unchanged product layer)
├── Dexie / IndexedDB  ── daily logs, profile, cycles, settings   (unchanged)
│                       ── medicalRecords (sealed), recordsConnection (new)
├── src/platform/*      ── web adapters replacing src/native/*
│     vault (WebCrypto key in IndexedDB), unlock (PIN + WebAuthn),
│     notifications (Notifications API, in-session), print, runtime
├── src/records/*       ── FinchNode integration (new)
│     providers: demo (direct, CORS) | relay (self-hosted Worker)
│     normalizers: FHIR R4 → MedicalRecord, FinchNode normalized → MedicalRecord
│     store: sealed rows in Dexie, consent + connection state
└── Service worker (vite-plugin-pwa): app-shell precache only.
    Never caches api.finchnode.com or the relay.

workers/records-relay (Cloudflare Worker, stateless, optional)
    holds FINCHNODE_API_KEY; proxies connect-session + snapshot reads;
    stores nothing; exact Origin allowlist plus required client-token authentication;
    one owner with a dedicated FinchNode application.

External, only when the user opts in:
    api.finchnode.com/demo/v1   (synthetic, no auth)
    <your relay>  →  api.finchnode.com/api/v1   (live, patient-authorized)
    existing optional: AI provider (BYOK), backup relay, reminder email worker
```

## 5. Section A: web-first platform

### A1. Remove the native layer

Delete: `app/ios/`, `app/android/`, `app/capacitor.config.ts`, every
`@capacitor/*` dependency, the `native:*` scripts, `workers/oauth-callback/`
(it only serves iOS/Android app-link associations), `docs/NATIVE_ARCHITECTURE.md`,
and `src/native/bridge.ts`, `health.ts`, `widgets.ts`.

Keep and relocate to `src/platform/`, preserving the exported function names
and types so screens change as little as possible:

| Old module | New module | Web behaviour |
| --- | --- | --- |
| `native/runtime.ts` | `platform/runtime.ts` | `initializeRuntime()` sets `data-runtime="web"`, registers the PWA service worker and starts the persisted reminder scheduler. `nativeTap()` keeps its name (call sites untouched) and uses `navigator.vibrate` when present. |
| `native/secureVault.ts` | `platform/secureVault.ts` | See A2. `persistence: 'indexeddb-webcrypto'`. |
| `native/biometrics.ts` | `platform/deviceUnlock.ts` | WebAuthn platform authenticator (Touch ID, Face ID, Windows Hello). See A3. |
| `native/notifications.ts` | `platform/notifications.ts` | Notifications API. See A4. |
| `native/reportExport.ts` | `platform/reportExport.ts` | `window.print()` only; keep its tests. |
| `native/healthImport.ts` | `lib/healthImport.ts` | Keep the pure grouping/apply functions and their tests (future file-based import). Drop `importAppleHealthPeriodHistory` and every bridge call. Settings loses the HealthKit/Health Connect UI. |

`main.tsx` stops unregistering service workers. Onboarding removes only the Apple
Health subsection inside cycle-history and its import-only state/helpers; keep
all StepIds, including cycle-history and the height/weight biometrics step. Keep
default healthData permission and a not-requested health-import decision.
Settings removes the complete Device health & native services section, enables
web device-unlock enrollment and reminder handling, and wipes through
`destroySecureVault()` after stopping the scheduler. Assistant/Settings persistence
labels use the browser-vault type; retained print tests pass only browserPrint.

### A2. Secure vault on the web

- One non-extractable `AES-GCM` 256-bit `CryptoKey` generated on first use and
  stored in a dedicated IndexedDB database `lunara-keys` (CryptoKey objects
  are structured-cloneable; the raw key bytes are never exposed to JS). Generate
  a candidate before the transaction, then re-read and insert only if absent
  in one readwrite transaction, resolving with the stored winner. Close handles
  and invalidate key memos on `versionchange`. Shared vault lifecycle locks
  cover sealed writes; destruction takes the exclusive lock. A blocked delete
  rejects; the wipe UI says "Close other Lunara tabs and try again."
- `setSecureSecret / getSecureSecret / deleteSecureSecret / clearSecureSecrets`
  seal values with that key into a `secrets` store. AI keys and the relay
  client token live here, never in the `settings` table or exports.
- New `src/crypto/sealed.ts`: `seal(key, payload) → SealedBlob {v:1, iv, data}`
  and `open(key, blob)`. This is the key-based sibling of the existing
  passphrase-based `encryptJSON`, and is what the records store uses.
- Honest UI label in Settings: "Encrypted with a browser-managed key. Anyone
  who can run code on this site in your browser could read it; your PIN gates
  the screen, not the key." Wiping data deletes `lunara-keys` too.

### A3. Device unlock (WebAuthn)

- Enrol: `navigator.credentials.create` with `authenticatorAttachment:
  'platform'`, `userVerification: 'required'`, `rp.id = location.hostname`,
  random user handle. Store the credential id (base64url) in settings.
- Unlock: `navigator.credentials.get` with `allowCredentials` = that id and
  `userVerification: 'required'`. Accept only a non-null public-key credential
  whose raw ID matches the enrolled ID; the PIN remains the fallback. This
  screen gate does not cryptographically protect the encryption key.
- No signature verification and no server: this is a device gate at the same
  trust level as the PIN. Say so in the Settings copy.
- Feature-detect with `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`;
  hide the option when false.
- Initial locking happens once when App becomes ready; later profile/consent
  updates never re-lock an unlocked session. A `hasPinRef` enables synchronous
  locking on `visibilitychange` → hidden. PinLock increments a lock generation
  on hide/re-lock and unmount, resets partial entry, and accepts asynchronous
  PIN/WebAuthn success only for that generation while visible. Never start
  automatic WebAuthn while hidden. Device-unlock enrollment requires a PIN;
  disabling it or removing the PIN clears its flag and credential.

### A4. Reminders on the web

Browsers cannot schedule a future notification without a push server, which
Lunara does not have. Keep the reminder engine and its settings, and implement
delivery as **in-session reminders**: while any Lunara tab is open, a timer
materializes the next due occurrences and shows them via
`registration.showNotification` (or `new Notification` fallback). The Settings
copy states the limitation plainly and points to the optional email-reminder
worker for unattended reminders. `initializeRuntime()` calls
`startReminderScheduler()`: restore persisted preferences without requesting
permission, materialize the next 24 h, repeat every 60 minutes and when visible,
and reschedule when preferences change. Disabled/denied reminders cancel timers;
wipe stops the scheduler first. Stable notification `tag`s deduplicate an
occurrence across tabs. Use `getRegistration()` with a 2-second bounded wait,
then the permitted Notification fallback; never wait indefinitely for a worker.
Validate times with `/^(?:[01]\d|2[0-3]):[0-5]\d$/`.

### A5. PWA and offline

- `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
- Manifest: name Lunara, `display: standalone`, theme/background from the new
  palette, icons generated from `app/brand/` (192, 512, maskable).
- Workbox: precache the built app shell and fonts. Runtime routes:
  `NetworkOnly` for FinchNode, every cross-origin destination (including relay,
  AI and backup), and same-origin `/api/` and `/v1/` routes. Matcher callbacks
  are self-contained: inline `url.hostname === 'api.finchnode.com'`; the
  cross-origin callback uses `url.origin !== self.location.origin`. Test the
  serialized callbacks and built `dist/sw.js`, including CacheStorage inspection
  and the return navigation serving only the precached shell.
- `public/_headers` with `Content-Security-Policy` (`default-src 'self'`,
  `connect-src 'self' https://api.finchnode.com https://api.openai.com
  https://api.anthropic.com http://localhost:* http://127.0.0.1:*`,
  `img-src 'self' data: blob:`, `frame-ancestors 'none'`), `Referrer-Policy:
  no-referrer`, `Permissions-Policy` denying camera/mic/geolocation.
  README explains that a custom relay or Ollama host must be appended.

### A6. Responsive layout

The phone layout has a five-column mobile tab grid
`repeat(5, minmax(0, 1fr))` once Records is added. At
`@media screen and (min-width: 900px)`, `.tabbar-inner` becomes
`display: flex; flex-direction: column`; `main` has `min-width: 0` and `.page`
remains the centered 760px content container. Center `.overlay`, `.sheet` and
`.health-overlay` with explicit viewport bounds, disable their transform
animations, and preserve scrolling in their body containers. Reuse
`.sheet-backdrop`; other scrims are inside `#root` below dialogs. Import
records.css before desktop.css; desktop.css stays last among screen styles.

DoctorReport and CycleReportScreen each have a `.print-root` wrapper. Print CSS
hides all content under `#root` except the print root, its contents and structural
ancestors; hides controls/scrims; and resets position, transform, overflow,
height/max-height and animation so pages paginate. Provider records exist in the
report only when ticked; export is disabled while requested data loads or fails.
Verify portrait and landscape printing with no underlying screen content.

## 6. Section B: design system

### B1. Typography

`@fontsource/aileron` weights 300, 400, 600, 700, 800 imported in `main.tsx`.
Tokens:

```css
--font-sans:    'Aileron', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-display: 'Aileron', system-ui, sans-serif;   /* replaces the serif */
--tracking-tight: -0.02em;   /* Aileron is already narrow; the old -0.035em crushes it */
```

Display headings (including existing weight-500 `.page h1`, `.page h2` and
`.overlay-head h2`) use `--weight-display: 800`; body 400; labels 600. Replace
direct Avenir/Iowan declarations in health.css with font tokens and inspect
computed styles, including the effective onboarding CTA override.

### B2. Palette

Replace the mineral-paper/teal/coral system in `tokens.css` with:

```css
/* Baby pink surfaces */
--pink-50:  #FFF7F8;  --pink-100: #FFEEF1;  --pink-200: #FCDDE3;
--pink-300: #F4C2C2;  /* baby pink */         --pink-400: #EFA9B3;  --pink-500: #E58E9C;
/* Baby red actions and cycle signal */
--red-200:  #FBC4C4;  --red-300: #F5A0A0;   --red-400: #F08080;  /* baby red */
--red-500:  #E86464;  --red-600: #D64D4D;   --red-700: #C0393B;  --red-800: #9E2C2E;
/* Warm ink */
--ink-950: #2E1B1F; --ink-900: #3A2226; --ink-800: #4F3238; --ink-650: #6F4E56;
--ink-500: #8E6E76; --ink-300: #BFA6AB;
/* Semantic */
--bg: var(--pink-50);          --card: rgba(255,255,255,0.86);
--cta-bg: var(--red-700);      --cta-fg: #FFFFFF;
--period: var(--red-500);      --fertile: var(--red-300);
--phase-follicular: var(--pink-300); --phase-luteal: var(--pink-400);
--chart-bbt: var(--red-800); /* separate dark chart series */
--danger: var(--red-800);      --warning: #C9862B;   --success: #5E8C6A;
```

Compatibility: the existing `--rose-*`, `--coral-400`, `--teal-*`,
`--yellow-*`, `--clay-*`, `--paper-*` names stay defined as **aliases** onto the
new scales (teal → pink-400/500, yellow → warning, clay → pink-300, paper →
pink-50..200) so the 7,800-line `app.css` does not need a rewrite. Charts that
relied on teal-vs-rose contrast (BBT/OPK series, fertile vs period markers)
get explicit new semantic tokens above. Update `.phase-fertile`,
`.phase-ovulation`, `.cal-day.*`, `.date-cell.*`, `.bbt-line`, `.bbt-point`,
health.css local palette variables and literal gradients. Apply CTA tokens to
`.cta` and `.page.onboarding .ob-shell-footer .cta`, preserving secondary, yellow
and disabled variants; inspect the final cascade, not just token tests.

### B3. Contrast is tested

`src/styles/tokens.test.ts` parses `tokens.css`, computes WCAG contrast, and
asserts: `--ink-900` and `--ink-650` on `--pink-50/100/200` ≥ 4.5; `--cta-fg`
on `--cta-bg` ≥ 4.5; `--red-700` on `--pink-50` ≥ 4.5 (link colour); `--period`
vs `--fertile` ≥ 1.5 (distinguishable markers). Values above were chosen to
pass; the implementer adjusts hex values, not the thresholds.

## 7. Section C: medical records via FinchNode

### C1. Two providers, one interface

```ts
interface RecordsProvider {
  mode: 'demo' | 'live'
  startConnect(input: { categories: RecordCategory[]; returnUrl: string; externalId: string }): Promise<ConnectStart>
  getSession(sessionId: string): Promise<ConnectSessionState>
  fetchSnapshot(subject: string, categories: RecordCategory[]): Promise<RecordsSnapshot>
}
```

**Demo provider** (`src/records/providers/demo.ts`) talks directly to
`https://api.finchnode.com/demo/v1` (CORS `*`, no auth, 120 req/min):

- `startConnect` → `POST /connect/sessions` `{ external_user_id, categories }`
  returns a simulated completed session; no redirect.
- `fetchSnapshot` → `GET /patients/patient-demo-001/records?categories=a,b,c`.
  The body's `record` map holds **raw FHIR R4 resources** per category
  (`Patient`, `MedicationRequest`, `Condition`, `AllergyIntolerance`,
  `Observation`, `DiagnosticReport`, `Immunization`). See
  `docs/finchnode/demo-records-sample.json`.
- Every record is tagged `synthetic: true` and the UI shows a persistent
  "Sample data from FinchNode's fictional Northstar Health" banner.

**Relay provider** (`src/records/providers/relay.ts`) talks to the user's
canonical relay URL (setting `SK.recordsRelayUrl`) with required
`X-Lunara-Relay-Token` from a vault entry bound to that exact URL. This relay
supports one owner using a dedicated FinchNode application:

- `POST {relay}/v1/connect/sessions` → relay calls FinchNode
  `POST /api/v1/connect/sessions` with `{ categories, syncMode: 'one-time',
  durationDays: 365, returnUrl, externalId }` and returns `{ id, url, expiresAt }`.
  `externalId` is a random 16-byte base64url token generated in the browser
  and stored with the pending session; it carries no PII.
- Before creation, persist mode, categories, a new integer `generation`, relay
  binding and the random external ID plus exact creation body for ambiguous
  retries. Demo also persists its subject before synchronization.
- Browser stores returned `pendingSession {id, externalId, categories, startedAt}`
  on the live connection before navigating to an HTTPS, credential-free Hosted
  Connect URL. Its binding is the connection's `relayBaseUrl`.
- Send exactly `returnUrl = ${location.origin}/?records=return`. Capture and strip
  return parameters synchronously before rendering or awaiting anything.
  `ReturnParams` includes `invalidSession: boolean`: malformed or duplicate IDs
  are invalid, distinct from an absent ID. Require current medical-records consent
  and a stored live pending session bound to the current relay. A supplied ID must
  exactly equal its ID. Otherwise poll nothing and show "This link does not match
  a connection you started." Only an absent ID uses the pending-session fallback.
- Poll every 2 s for at most 60 s, honoring Retry-After within that deadline,
  while the session is not terminal or `sync.status` is `queued`/`syncing`.
  Failed/reauthorization states take the explicit error path. Completion requires
  a subject and ready sync; use selected ∩ granted categories, never an empty filter.
  Consumed-session replay, returns after disconnect and unsolicited returns do
  not resume anything. A module-level in-flight promise keyed by pending session
  ID deduplicates StrictMode return-handler runs.

- `fetchSnapshot` → `GET {relay}/v1/users/{subject}/records?categories=…`
  returns FinchNode's `HealthRecord` (normalized `MedicationRecord`,
  `ConditionRecord`, `ObservationRecord`, …; see the vendored OpenAPI).

### C2. Relay Worker (`workers/records-relay/`)

Modelled on `workers/backup/`. Stateless; no KV, no R2, no logs of bodies.
The v1 live relay supports one owner using a dedicated FinchNode application.
`RELAY_CLIENT_TOKEN` is a required, high-entropy secret configured with
`wrangler secret put`, never `[vars]`. Missing configuration returns 503;
missing/incorrect credentials return 401 before any upstream call. Exact Origin
validation is an additional browser restriction, not authentication. Independent
users require per-user authentication and session/subject ownership checks before
live use on a shared deployment.

| Route | Upstream | Notes |
| --- | --- | --- |
| `OPTIONS *` | — | Exact origin allowlist; allow the token header. |
| `POST /v1/connect/sessions` | `POST /api/v1/connect/sessions` | Allowlisted body; require nonempty unique supported `categories`, validated `returnUrl`, and `externalId` matching `^[A-Za-z0-9_-]{16,64}$`. Adds `syncMode: 'one-time'`, `durationDays: 365`, `Idempotency-Key: externalId`. Returns `id, url, expiresAt, status`. |
| `GET /v1/connect/sessions/:id` | `GET /api/v1/connect/sessions/:id` | ID matches `^cs_[a-f0-9]{20}$`; return `id, status, subject, sync` (including status, granted/available/missing categories, warnings and failure), `expiresAt`. |
| `GET /v1/users/:subject/records` | `GET /api/v1/users/:subject/records?categories=` | Subject matches `^u_[a-f0-9]{16}$`; require one nonempty unique supported category list; stream snapshot with no-store. |

Both category routes reject absent, empty, duplicate, malformed or unsupported
values with 400 rather than filtering. Parse URLs with `new URL`. Relay base URLs
allow HTTPS, or HTTP only for exact hostname `localhost` or `127.0.0.1`; reject
credentials, query strings and fragments; canonicalize without trailing slashes.
Return URLs must have a parsed origin exactly equal to both the request Origin
and an `ALLOWED_ORIGINS` entry, have no credentials, and be at most 2048 characters.
Never use prefix matching. Changing/importing a different saved relay URL sets
the live connection to `disconnected`, invalidates its generation, clears pending
state, keeps records viewable, disables refresh, and deletes the old token from
the vault. Require a newly saved token bound to the new endpoint before requests.

Config: required secrets `FINCHNODE_API_KEY` and `RELAY_CLIENT_TOKEN`; vars
`ALLOWED_ORIGINS`, `FINCHNODE_BASE_URL` (default
`https://api.finchnode.com/api/v1`). Compare SHA-256 token digests over all bytes
with no early-return byte comparison. Validate Origin on actual requests too.
Use complete vendored error envelopes (`type`, `code`, `message`, `requestId`) and
sanitized equivalents for local failures. Copy and expose `Retry-After` and
`RateLimit-Limit/Remaining/Reset` with `Access-Control-Expose-Headers`; include
`Vary: Origin` and no-store on sessions, snapshots and errors. Bound body size and
upstream request time; handle malformed JSON and network failure without leaking
secrets. Browser HTTP uses `credentials: 'omit'`, `cache: 'no-store'`,
`redirect: 'error'` and request deadlines.

README covers a dedicated FinchNode app, category allowlisting, both
`wrangler secret put FINCHNODE_API_KEY` and `wrangler secret put RELAY_CLIENT_TOKEN`,
`ALLOWED_ORIGINS`, deployment, and saving URL plus required token in Settings.
The trusted relay operator can see subject IDs and record bodies in transit;
the relay stores nothing.

### C3. Internal model

`src/records/types.ts`:

```ts
type RecordCategory = 'demographics' | 'medications' | 'conditions' | 'allergies'
                    | 'labs' | 'vitals' | 'immunizations'
interface RecordCoding { system: string | null; code: string | null; display: string | null }
interface MedicalRecordBase {
  id: string            // live: `${mode}:${category}:${upstream rec_… ID}`; demo: FHIR ID
  category: RecordCategory
  sourceRecordId: string | null
  sourceName: string | null      // provider/organization
  date: string | null            // ISO date used for sorting; category-specific meaning
  codes: RecordCoding[]
  syncedAt: string
  synthetic: boolean
}
// One interface per category mirroring FinchNode's normalized shape:
// DemographicRecord {name, birthDate, gender, address, phone, email}
// MedicationRecord  {name, dosage, frequency, status, startDate, endDate, prescriber, reason}
// ConditionRecord   {name, status, verificationStatus, severity, onsetDate, recordedDate}
// ObservationRecord {name, value, unit, status, date, referenceRange, interpretation}  (labs, vitals)
// AllergyRecord     {substance, reaction, severity, status, verificationStatus, recordedDate}
// ImmunizationRecord{name, code, status, date, manufacturer, lotNumber}
type MedicalRecord = DemographicRecord | MedicationRecord | ConditionRecord
                   | ObservationRecord | AllergyRecord | ImmunizationRecord

interface RecordsConnection {
  id: 'primary'
  mode: 'demo' | 'live'
  status: 'disconnected' | 'pending' | 'connected' | 'error'
  generation: number                    // monotonically increasing local invalidation token
  relayBaseUrl: string | null            // canonical endpoint; null for demo
  importedAt?: string                    // imported snapshot is viewable locally
  categories: RecordCategory[]
  subject?: string                       // live u_… or demo patient-demo-001
  pendingSession?: { id: string; externalId: string; categories: RecordCategory[]; startedAt: string }
  sources: { system: string; organization: string | null; lastSyncedAt: string | null }[]
  consentReceiptIds: string[]
  creationAttempt?: { externalId: string; categories: RecordCategory[]; returnUrl: string }
  grantedCategories: RecordCategory[]
  availableCategories: RecordCategory[]
  missingCategories: RecordCategory[]
  sync?: { status: SyncStatus }
  failure?: { code: string; message: string; retryable: boolean } | null
  additionalItems: number
  skipped?: number
  connectedAt?: string
  lastSyncAt?: string
  syncStatus?: 'complete' | 'partial' | 'not_started'
  warnings: { code: string; message: string; category?: RecordCategory | null }[]
  lastError?: string
  recoveryAction?: 'start-again' | 'check-again' | 'refresh'
}
type SyncStatus = 'not_started' | 'queued' | 'syncing' | 'complete' | 'partial'
                | 'failed' | 'reauthorization_required'
// ConnectSessionState and RecordsSnapshot both retain sync.status, grantedCategories,
// availableCategories, missingCategories and failure. RecordsSnapshot additionally
// retains meta completeness as syncStatus: 'complete' | 'partial' | 'not_started'.
```

Normalizers are pure, field-validated and fixture-tested. Both accept the effective
category list and drop records outside it before persistence. Live IDs must match
`^rec_[a-f0-9]{24}$`; preserve the separate nullable `sourceRecordId`, skip/count
malformed records without stable IDs, fill absent nullable fields with null and
normalize observation values to string/finite-number/null (safe JSON display
conversion for other values). Handle null, object-only and nested demographics
separately; deduplicate upstream IDs and never persist the nested records array.

FHIR R4 handles Patient, MedicationRequest/Statement, Condition, AllergyIntolerance,
Observation, DiagnosticReport (selected labs conclusion) and Immunization. Blood
pressure is systolic/diastolic only for LOINC 8480-6/8462-4 with compatible units, located by code regardless of order: the
sample is exactly `124/78`. Other components remain labeled values. One-sided
reference ranges use only the supplied bound; missing dates become null.

V1 does not display `medicationAdministrations`, `medicationDispenses`,
`diagnosticReports`, or other extra arrays in the live HealthRecord data. FHIR
DiagnosticReport resources already inside the demo labs category retain their lab
mapping. Count extra-array items separately from malformed/skipped supported records;
the source card says "n additional items from your provider are not shown yet".
The partial live fixture has no immunizations, lists them in missingCategories,
and lists only the other six categories in availableCategories.

### C4. Storage, encryption, consent

- Dexie version 4 adds `medicalRecords: 'id, category, date'` and
  `recordsConnection: 'id'`, preserving every v3 table.
- Rows are `{ id, category, date, sealed: SealedBlob }`. Medical-record bodies
  and vault secrets are sealed. Record IDs/categories/dates and connection
  metadata (organizations, warnings, subjects, pending-session IDs and receipts)
  are plaintext; existing daily logs and health profiles are not sealed.
- `startConnection`, cancel, `disconnectAndDelete` and wipe increment the persisted
  `generation`. Every async completion/refresh captures it; the single transaction
  that commits records or connection state re-reads connection and current consent
  and performs no writes, including error writes, if generation changed or consent
  is no longer granted. This works across tabs without BroadcastChannel. Keep a
  disconnected, nonpersonal generation tombstone through clears/wipe to prevent
  reuse of old generation numbers; invalidation precedes aborting fetch/polling.
- Seal rows before the transaction under shared vault lifecycle coordination;
  decryption follows reads outside transactions. `putSnapshot(records,
  categoriesToReplace, patch)` commits with the generation/consent guard in one
  transaction including recordsConnection, medicalRecords, settings and
  healthProfiles. Complete snapshots replace effective categories. Partial
  snapshots replace effective ∩ meta.availableCategories only; missing categories
  retain cached rows and display "not refreshed". Not-started snapshots write no
  records or completed-import timestamp. Categories whose selection/consent was
  removed are deleted in the consent-change transaction.
- Disconnect deletes records and identifying connection state, preserves the
  generation tombstone, and writes a declined medical-records ledger entry.
  Cancel invalidates pending work and returns to a usable disconnected state.
  Live consent can also be revoked at the source portal.
- `ConsentPurpose` gains `'medical-records'`; onboarding seeds not-requested.
  Connect requires granted consent and at least one selected category; live also
  requires a saved token bound to the canonical relay URL.
- Export v2 includes dailyLogs, settings, contentBookmarks, healthProfiles,
  regimenRecords, missedDoseEvents, opened medicalRecords and recordsConnection
  without pendingSession/creationAttempt. Record bodies are plaintext inside the
  export payload; passphrase encryption protects the file only when chosen.
  Exclude `SK.pinSalt`, `SK.pinHash`, `SK.aiKey`, `'recoveryCode'`,
  `SK.biometricLock`, `SK.deviceUnlockCredential` on both export and import.
  Never serialize the vault, raw keys or relay credentials; a validated
  credential-free relay URL stays exportable.
- Validate the complete import/version, seal rows first, then commit all imported
  tables in one transaction; no nested putSnapshot/sealing inside it. V1 preserves
  existing medical records. V2 replaces the entire record snapshot and connection,
  including empty arrays and null. Imported connections get importedAt, a fresh
  local generation, no pending/creation state and disconnected status for local
  viewing; importing a URL never activates a connection. The restored consent
  ledger is the user's decision. Explicit connect can reuse that granted decision;
  refresh still requires the current relay binding, saved token and enabled
  connection. Endpoint changes delete the old token as above.
- Wipe stops reminders, invalidates records work, then clears data and destroys
  the vault under the exclusive lifecycle lock. Blocked destruction shows the
  close-other-tabs message and never reports success.

### C5. UI

Tab bar gains **Records** (five tabs: Today, Insights, Trends, Records,
Settings). `RecordsScreen`:

1. **Disconnected**: one-paragraph explanation, the "what leaves this device"
   card, category checklist (all seven checked), consent checkbox, two
   buttons: "Try with sample data" (demo) and "Connect my provider" (live;
   disabled until a relay URL and matching token are saved in Settings). Both
   buttons require consent and at least one category.
2. **Pending**: spinner + "Finishing your connection"; Cancel increments generation,
   clears pending state and returns to disconnected with cached records viewable.
3. **Connected**: source card (organization, last synced, mode badge, synthetic
   banner when demo), one summary card per category with counts, tapping a
   category opens a list (`RecordsCategoryList`) with a compact row per record
   (name, key value, date, source). Actions: Refresh, Disconnect & delete.
4. **Error**: friendly last error; terminal sessions offer "Start again", timeouts
   with pending state offer "Check again", and snapshot failures retain subject
   and records for "Refresh". Disconnected/imported snapshots remain viewable.

Settings gains a "Medical records" section: canonical relay URL, token required
for live mode (stored with its URL binding in the vault), mode indicator, and a
link to Records. Changing the URL disconnects live mode and deletes the old token.
Settings also gains a "Privacy & data" section rendering the same table as `PRIVACY.md`.

`DoctorReport` gains an opt-in section "Records from your provider" (off by
default) listing active conditions, active medications, and allergies with
source and date, rendered only when ticked. Disable export while requested data
loads or has failed, and use the isolated print root from A6. Introduction and
consent copy explain exports, encrypted backup uploads and optional report inclusion
as well as the fact that records are not sent to the AI assistant.

### C6. Error handling

All creation, polling and snapshot failures use one sanitized persisted error
path, guarded by generation and consent in the commit transaction. Never persist
raw response bodies or stack traces. Demo 429 says "FinchNode's sample API is busy,
try again in a minute"; honor Retry-After and bounded request/poll deadlines.
Terminal sessions clear pending state and offer Start again. Timeouts retain the
pending session for Check again; snapshot errors keep subject and prior records
for Refresh. Retry an ambiguous creation with the same external ID and exact body.
`startConnection` returns `'connected' | 'redirected' | 'error'`.

Retain `sync.status`, granted/available/missing categories and failure on session
and snapshot models. Continue polling nonterminal or queued/syncing sessions;
failed and reauthorization-required sync set `status: 'error'`, with friendly
reauthorization copy: "Your provider needs you to sign in again. Start again to
reconnect." Effective categories are selected ∩ granted; an empty intersection
makes no snapshot request. C4 governs complete/partial/not-started replacement.
Show missing categories as not refreshed, distinguish unavailable/not-selected
from a successfully refreshed empty category, and disclose unsupported item counts.

Invalid, mismatched, unsolicited and replayed return links make no requests or
state writes; show "This link does not match a connection you started." URL
parameters are captured and stripped synchronously before any render/await.

## 8. Section D: privacy model

`PRIVACY.md` (root) and the in-app "Privacy & data" section state, in one
table, every network destination, what is sent, when, and how to turn it off:

| Destination | When | What is sent | Off by default? |
| --- | --- | --- | --- |
| FinchNode demo API | User taps "Try with sample data" | Chosen categories and a random external ID | Yes |
| Your relay → FinchNode | User taps "Connect my provider" / Refresh | Chosen categories, random external ID, return URL; then subject ID; required client token goes only to your relay | Yes |
| AI provider (BYOK) | User sends a message | The message plus only the ticked categories | Yes |
| Backup relay | User explicitly uploads via the backup action | Client-encrypted backup blob, including imported records | Yes |
| Reminder worker | User enters an email | Email + time only, no health words | Yes |
| Anything else | Never | — | — |

Threat model: Lunara has no hosted user database; the stateless single-owner
relay stores no records, although explicit encrypted backup uploads are hosted
by the chosen backup service. Sealed record bodies and vault secrets protect
against casual inspection of those stored values; plaintext metadata, logs and
profiles remain outside that encryption boundary. Export files contain opened
records unless the user chooses file encryption. Records never enter AI context
in v1 and enter reports only when ticked. Does **not** protect against
malicious same-origin JavaScript, a compromised browser profile, or the
FinchNode/relay operator seeing records in transit. No analytics, no
third-party scripts, no cookies, no fingerprinting; the CSP in A5 enforces the
first two.

## 9. Testing

- Existing behavior tests and the estimate audit remain green; use the locked
  TypeScript 5.9.3 with resolveJsonModule and `lib: ['ES2024', 'DOM', 'DOM.Iterable']`,
  preserving target/module. Run tsc during the FHIR task and final verification.
- Key store: independent clients race to the same stored key; blocked deletion
  rejects. Close raw inspection handles after transaction completion. Test
  disconnect/wipe during suspended fetch/sealing, generation guards across tabs,
  concurrent refresh deduplication, and StrictMode duplicate return handling.
- Providers/orchestration: required token and exact URL bindings; hostile prefixes;
  replay/no-pending/mismatched returns; narrowed grants, queued sync, partial
  refresh retaining missing rows, complete empty refresh clearing rows,
  not-started no writes, sanitized errors, terminal/retry/timeout recovery.
- Normalizers: explicit malformed/null/object/nested fixtures, category boundaries,
  extra-array disclosure, exact/reversed BP, unrelated components, compatible
  units, one-sided ranges, missing dates. Partial fixture metadata agrees with data.
- Store/import: real v3→v4 migration preserving every table, absent getConnection
  inside liveQuery makes no writes; v1 preservation; populated/empty/null v2 full
  replacement, unsupported versions and rollback; every secret excluded on both
  paths; fresh-database profile/regimen/adherence round trip.
- Browser adapters: WebAuthn null/wrong-type/wrong-ID, no profile-triggered relock,
  delayed unlock after hide; scheduler startup, beyond 24 h, multi-tab tags,
  disabled/denied permission, missing worker and wipe. Use vi.stubGlobal and
  vi.unstubAllGlobals; advance promise/timer paths asynchronously on Node 24.
- Worker: 503 missing config, 401 missing/incorrect tokens with no upstream calls,
  actual-request Origin checks, both strict category routes, hostile return URLs,
  malformed JSON/oversized bodies/network failures, full error envelopes,
  browser-visible Retry-After and no-store. Inspect serialized/built SW matchers
  and CacheStorage for FinchNode, arbitrary relay, AI, backup and same-origin API.
- Browser pass: onboarding → demo → category lists → opt-in report → export/import
  → wipe; inspect computed typography/palette, mobile five-tab grid, desktop rail,
  scroll/scrim behavior, portrait/landscape print isolation, PWA shell/install and
  network destinations. Assert behavior rather than fixed test totals.

## 10. Phasing (one Codex run per phase, review between)

1. **Platform**: A1–A5. Ends with Capacitor gone, `pnpm test`, `tsc`, `vite
   build` green, README rewritten for the web.
2. **Design**: B1–B3 and A6. Ends with the palette and font live, contrast
   test green, screenshots at 390px and 1280px.
3. **Records**: C1–C6, D. Ends with demo connect working end-to-end in the
   browser, relay Worker tested, `PRIVACY.md` written.
4. **Hardening**: Codex adversarial review of the whole diff, fixes, final
   browser pass.

## 11. Risks and open questions

- FinchNode's demo `POST /connect/sessions` shape (`external_user_id`) differs
  from the authenticated API (`externalId`); the two providers are kept
  separate for that reason.
- Hosted Connect may add return parameters. Only an absent session parameter may
  fall back to a consented, current-relay live pending session; invalid/mismatched
  values never do. Replay and asynchronous invalidation are explicitly guarded.
- Open-question decision: live v1 assumes one owner and a dedicated FinchNode app.
  A shared deployment needs per-user authentication plus ownership checks.
- Open-question decision: extra arrays, including medicationAdministrations,
  medicationDispenses and diagnosticReports, are excluded from v1 display and
  counted in the source-card disclosure. Do not imply a complete display of all
  provider items.
- IndexedDB connection metadata and existing logs/profiles are plaintext. The
  vault is a browser-managed key boundary; PIN/WebAuthn only gate the screen.
  Exports include health profiles, regimen/adherence data and opened records;
  imported connections are local views until explicitly connected, with relay
  binding and token checks. Partial snapshots preserve missing categories.
- `vite-plugin-pwa` and Vite 6 compatibility is expected (0.21+); verify at
  install time.
- The remaining Capacitor-era CSS variables (`--safe-top`, `--tabbar-height`)
  are kept; they resolve to 0 in browsers.
- Baby pink surfaces limit how many distinguishable chart hues exist; the
  contrast test enforces the two that matter (period vs fertile).
