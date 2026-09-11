# Lunara Web: privacy-first browser app with FinchNode medical records

Date: 2026-09-10
Status: draft for review
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
    stores nothing; CORS-locked to ALLOWED_ORIGINS; optional shared client token.

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
| `native/runtime.ts` | `platform/runtime.ts` | `initializeRuntime()` sets `data-runtime="web"`, registers the PWA service worker. `nativeTap()` keeps its name (call sites untouched) and uses `navigator.vibrate` when present. |
| `native/secureVault.ts` | `platform/secureVault.ts` | See A2. `persistence: 'indexeddb-webcrypto'`. |
| `native/biometrics.ts` | `platform/deviceUnlock.ts` | WebAuthn platform authenticator (Touch ID, Face ID, Windows Hello). See A3. |
| `native/notifications.ts` | `platform/notifications.ts` | Notifications API. See A4. |
| `native/reportExport.ts` | `platform/reportExport.ts` | `window.print()` only; keep its tests. |
| `native/healthImport.ts` | `lib/healthImport.ts` | Keep the pure grouping/apply functions and their tests (future file-based import). Drop `importAppleHealthPeriodHistory` and every bridge call. Settings loses the HealthKit/Health Connect UI. |

`main.tsx` stops unregistering service workers.

### A2. Secure vault on the web

- One non-extractable `AES-GCM` 256-bit `CryptoKey` generated on first use and
  stored in a dedicated IndexedDB database `lunara-keys` (CryptoKey objects
  are structured-cloneable; the raw key bytes are never exposed to JS).
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
  `userVerification: 'required'`. Success resolves the lock; the PIN remains
  the fallback exactly as today.
- No signature verification and no server: this is a device gate at the same
  trust level as the PIN. Say so in the Settings copy.
- Feature-detect with `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`;
  hide the option when false.
- `PinLock` re-locks on `visibilitychange` → hidden when a PIN is set
  (replaces the Capacitor `appStateChange` listener).

### A4. Reminders on the web

Browsers cannot schedule a future notification without a push server, which
Lunara does not have. Keep the reminder engine and its settings, and implement
delivery as **in-session reminders**: while any Lunara tab is open, a timer
materializes the next due occurrences and shows them via
`registration.showNotification` (or `new Notification` fallback). The Settings
copy states the limitation plainly and points to the optional email-reminder
worker for unattended reminders.

### A5. PWA and offline

- `vite-plugin-pwa` with `registerType: 'autoUpdate'`.
- Manifest: name Lunara, `display: standalone`, theme/background from the new
  palette, icons generated from `app/brand/` (192, 512, maskable).
- Workbox: precache the built app shell and fonts. Runtime routes:
  `NetworkOnly` for `https://api.finchnode.com/*` and for any origin equal to
  the configured relay or AI provider. A unit test asserts the generated
  workbox config contains no caching strategy for those hosts.
- `public/_headers` with `Content-Security-Policy` (`default-src 'self'`,
  `connect-src 'self' https://api.finchnode.com https://api.openai.com
  https://api.anthropic.com http://localhost:* http://127.0.0.1:*`,
  `img-src 'self' data: blob:`, `frame-ancestors 'none'`), `Referrer-Policy:
  no-referrer`, `Permissions-Policy` denying camera/mic/geolocation.
  README explains that a custom relay or Ollama host must be appended.

### A6. Responsive layout

The current shell is a 520px phone column with a bottom tab bar. Add one
desktop breakpoint at `min-width: 900px`:

- Tab bar becomes a left rail (icons + labels), `main` gets `max-width: 760px`
  centred with the rail beside it.
- Overlays (`.overlay`, `.sheet`) render as centred dialogs with a scrim
  instead of full-bleed.
- Everything else is untouched; the phone layout stays the default below 900px.

## 6. Section B: design system

### B1. Typography

`@fontsource/aileron` weights 300, 400, 600, 700, 800 imported in `main.tsx`.
Tokens:

```css
--font-sans:    'Aileron', system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-display: 'Aileron', system-ui, sans-serif;   /* replaces the serif */
--tracking-tight: -0.02em;   /* Aileron is already narrow; the old -0.035em crushes it */
```

Display headings use weight 800; body 400; labels 600.

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
--danger: var(--red-800);      --warning: #C9862B;   --success: #5E8C6A;
```

Compatibility: the existing `--rose-*`, `--coral-400`, `--teal-*`,
`--yellow-*`, `--clay-*`, `--paper-*` names stay defined as **aliases** onto the
new scales (teal → pink-400/500, yellow → warning, clay → pink-300, paper →
pink-50..200) so the 7,800-line `app.css` does not need a rewrite. Charts that
relied on teal-vs-rose contrast (BBT/OPK series, fertile vs period markers)
get explicit new semantic tokens above.

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
  startConnect(input: { categories: RecordCategory[]; returnUrl: string }): Promise<ConnectStart>
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
relay URL (setting `SK.recordsRelayUrl`) with optional `X-Lunara-Relay-Token`
from the secure vault:

- `POST {relay}/v1/connect/sessions` → relay calls FinchNode
  `POST /api/v1/connect/sessions` with `{ categories, syncMode: 'one-time',
  durationDays: 365, returnUrl, externalId }` and returns `{ id, url, expiresAt }`.
  `externalId` is a random 16-byte base64url token generated in the browser
  and stored with the pending session; it carries no PII.
- Browser stores `pendingSession {id, externalId, categories, startedAt}` in
  `recordsConnection`, then `location.assign(url)` to FinchNode Hosted Connect.
- Return: `returnUrl = ${location.origin}/?records=return&session={id}`. On
  load `main.tsx` detects `records=return`, hands off to
  `RecordsReturnHandler`, which strips the query from the URL immediately,
  then polls `GET {relay}/v1/connect/sessions/{id}` (2 s, max 60 s) until
  `status === 'completed'` and `subject` is non-null, or a terminal status
  (`abandoned | canceled | expired | failed`) which is shown as a plain error.
  If the query lacks a session id, the stored `pendingSession` is used.
- `fetchSnapshot` → `GET {relay}/v1/users/{subject}/records?categories=…`
  returns FinchNode's `HealthRecord` (normalized `MedicationRecord`,
  `ConditionRecord`, `ObservationRecord`, …; see the vendored OpenAPI).

### C2. Relay Worker (`workers/records-relay/`)

Modelled on `workers/backup/`. Stateless; no KV, no R2, no logs of bodies.

| Route | Upstream | Notes |
| --- | --- | --- |
| `OPTIONS *` | — | CORS preflight, origins from `ALLOWED_ORIGINS` |
| `POST /v1/connect/sessions` | `POST /api/v1/connect/sessions` | Body allowlist: `categories` (subset of `RECORD_CATEGORIES`), `returnUrl` (must start with an allowed origin), `externalId` (`^[A-Za-z0-9_-]{16,64}$`). Adds `syncMode`, `durationDays`, `Idempotency-Key: externalId`. Returns only `id, url, expiresAt, status`. |
| `GET /v1/connect/sessions/:id` | `GET /api/v1/connect/sessions/:id` | `:id` must match `^cs_[a-f0-9]{20}$`. Returns `status, subject, sync.status, sync.grantedCategories, sync.warnings, expiresAt`. |
| `GET /v1/users/:subject/records` | `GET /api/v1/users/:subject/records?categories=` | `:subject` must match `^u_[a-f0-9]{16}$`. Pass-through body; sets `Cache-Control: private, no-store`. |

Config: secret `FINCHNODE_API_KEY`; vars `ALLOWED_ORIGINS`, optional
`RELAY_CLIENT_TOKEN` (when set, requests must carry it in
`X-Lunara-Relay-Token`; constant-time compare), `FINCHNODE_BASE_URL`
(default `https://api.finchnode.com/api/v1`). Upstream 4xx/5xx are forwarded
with FinchNode's `error` envelope; `Retry-After` and `RateLimit-*` headers
pass through. Tests use vitest with a stubbed `fetch`.

README covers: create a FinchNode app (free tier), allowlist categories in the
FinchNode console, `wrangler secret put FINCHNODE_API_KEY`, set
`ALLOWED_ORIGINS`, deploy, paste the relay URL into Lunara → Settings →
Medical records. Also states what the relay can see (pseudonymous subject ids,
record bodies in transit, never stored) and that the relay operator must be
someone the user trusts, ideally themselves.

### C3. Internal model

`src/records/types.ts`:

```ts
type RecordCategory = 'demographics' | 'medications' | 'conditions' | 'allergies'
                    | 'labs' | 'vitals' | 'immunizations'
interface RecordCoding { system: string | null; code: string | null; display: string | null }
interface MedicalRecordBase {
  id: string            // `${mode}:${category}:${sourceRecordId}` — stable across refreshes
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
type MedicalRecord = …union…

interface RecordsConnection {
  id: 'primary'
  mode: 'demo' | 'live'
  status: 'disconnected' | 'pending' | 'connected' | 'error'
  categories: RecordCategory[]
  subject?: string                       // u_… pseudonymous; live only
  pendingSession?: { id: string; externalId: string; categories: RecordCategory[]; startedAt: string }
  sources: { system: string; organization: string | null; lastSyncedAt: string | null }[]
  consentReceiptIds: string[]
  connectedAt?: string
  lastSyncAt?: string
  syncStatus?: 'complete' | 'partial' | 'not_started'
  warnings: { code: string; message: string; category?: RecordCategory | null }[]
  lastError?: string
}
```

Normalizers are pure and fixture-tested:

- `src/records/normalize/fhir.ts`: FHIR R4 → `MedicalRecord[]`. Handles
  `Patient`, `MedicationRequest` + `MedicationStatement`, `Condition`,
  `AllergyIntolerance`, `Observation` (routes to labs vs vitals by
  `category.coding.code`, flattens `component` for blood pressure into
  `value: "120/80"`), `DiagnosticReport` (one record whose `value` is the
  conclusion), `Immunization`. Unknown resource types are skipped and counted.
- `src/records/normalize/finchnode.ts`: FinchNode `HealthRecord.data` → the
  same model. `demographics` may be a single object with an optional
  `records[]`; both handled.

### C4. Storage, encryption, consent

- Dexie version 4 adds `medicalRecords: 'id, category, date'` and
  `recordsConnection: 'id'`.
- Row shape `{ id, category, date, sealed: SealedBlob }`. Only the id,
  category and date are plaintext for indexing; the record body is sealed with
  the vault key from A2. `listRecords(category?)` opens rows on read.
- `putSnapshot(records, connectionPatch)` runs in one transaction: delete all
  rows for the refreshed categories, insert the new set, update connection.
  Refresh is therefore idempotent.
- `disconnectAndDelete()` deletes both tables' rows, writes a `declined`
  ledger entry, and shows FinchNode's note that live consent can also be
  revoked at the source portal.
- `ConsentPurpose` gains `'medical-records'`. Onboarding seeds it as
  `not-requested`; the Records screen asks for it (checkbox with the
  "what leaves this device" summary) before the first connect, and records it
  in the ledger. Connect buttons stay disabled until granted.
- `db/transfer.ts`: export `v: 2` adds `medicalRecords` (opened, plaintext
  inside the file; the file itself is passphrase-encrypted when the user
  chooses that) and `recordsConnection` minus `pendingSession`. Import accepts
  `v: 1` and `v: 2`.
- Settings "Delete all data" also clears both tables and `lunara-keys`.

### C5. UI

Tab bar gains **Records** (five tabs: Today, Insights, Trends, Records,
Settings). `RecordsScreen`:

1. **Disconnected**: one-paragraph explanation, the "what leaves this device"
   card, category checklist (all seven checked), consent checkbox, two
   buttons: "Try with sample data" (demo) and "Connect my provider" (live;
   disabled with a hint until a relay URL is set in Settings).
2. **Pending**: spinner + "Finishing your connection" with a cancel that clears
   `pendingSession`.
3. **Connected**: source card (organization, last synced, mode badge, synthetic
   banner when demo), one summary card per category with counts, tapping a
   category opens a list (`RecordsCategoryList`) with a compact row per record
   (name, key value, date, source). Actions: Refresh, Disconnect & delete.
4. **Error**: last error text + Retry + Disconnect.

Settings gains a "Medical records" section: relay URL, optional relay token
(stored in the vault), mode indicator, and a link to the Records tab. Settings
also gains a "Privacy & data" section rendering the same table as `PRIVACY.md`.

`DoctorReport` gains an opt-in section "Records from your provider" (off by
default) listing active conditions, active medications, and allergies with
source and date.

### C6. Error handling

- Network/CORS failures → connection `status: 'error'` with a plain message;
  never a stack trace. Demo 429 → "FinchNode's sample API is busy, try again
  in a minute" using `Retry-After` when present.
- Session terminal states map to friendly copy; `expired` offers "Start again".
- A snapshot with `meta.syncStatus === 'partial'` stores what arrived and
  surfaces `warnings` on the source card.
- Normalizer never throws on a single bad resource; it skips and increments a
  `skipped` count shown in the source card's details.
- The return handler removes `records=return` from the URL before doing
  anything else so a reload cannot replay it.

## 8. Section D: privacy model

`PRIVACY.md` (root) and the in-app "Privacy & data" section state, in one
table, every network destination, what is sent, when, and how to turn it off:

| Destination | When | What is sent | Off by default? |
| --- | --- | --- | --- |
| FinchNode demo API | User taps "Try with sample data" | Category list only | Yes |
| Your relay → FinchNode | User taps "Connect my provider" / Refresh | Category list, random external id, return URL; then the pseudonymous subject id | Yes |
| AI provider (BYOK) | User sends a message | The message plus only the ticked categories | Yes |
| Backup relay | User enables backup | Client-encrypted blob | Yes |
| Reminder worker | User enters an email | Email + time only, no health words | Yes |
| Anything else | Never | — | — |

Threat model in the doc: protects against a hosted-service breach (nothing is
hosted), against the relay operator reading stored data (it stores nothing),
and against casual disk access (sealed rows). Does **not** protect against
malicious same-origin JavaScript, a compromised browser profile, or the
FinchNode/relay operator seeing records in transit. No analytics, no
third-party scripts, no cookies, no fingerprinting; the CSP in A5 enforces the
first two.

## 9. Testing

- Existing 186 vitest tests keep passing; the estimate audit stays at zero
  violations.
- New unit tests: FHIR normalizer (fixture from the demo sample plus
  hand-written edge cases: BP components, missing dates, unknown types),
  FinchNode normalizer (fixture built from the OpenAPI schema), `sealed.ts`
  round-trip, records store put/list/disconnect and export/import v1→v2
  (using `fake-indexeddb`), `deviceUnlock` and `secureVault` with mocked
  `navigator.credentials` / real Node WebCrypto, tokens contrast test, PWA
  runtime-caching guard, relay Worker route tests with stubbed `fetch`
  (allowlist, id validation, token check, header pass-through).
- Manual verification (reviewer, in the browser): onboarding → Records demo
  connect → category lists → doctor report section → export/import → wipe;
  desktop and mobile widths; Lighthouse PWA installable; no requests to
  unexpected hosts in the network panel.

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
- Hosted Connect's exact return behaviour (whether it appends its own query
  params) is undocumented; the stored `pendingSession` fallback covers it.
- `vite-plugin-pwa` and Vite 6 compatibility is expected (0.21+); verify at
  install time.
- The remaining Capacitor-era CSS variables (`--safe-top`, `--tabbar-height`)
  are kept; they resolve to 0 in browsers.
- Baby pink surfaces limit how many distinguishable chart hues exist; the
  contrast test enforces the two that matter (period vs fertile).
