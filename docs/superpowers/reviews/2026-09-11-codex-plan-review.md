## Blocking findings

1. **The live relay has no required authentication or per-user authorization.**

   **Evidence:** [Spec C2](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/specs/2026-09-10-lunara-web-finchnode-design.md:276) makes `RELAY_CLIENT_TOKEN` optional. Task 22 authorizes requests using an allowed `Origin` and, optionally, that shared token. FinchNode scopes records to the **application**, not the browser user (`docs/finchnode/finchnode-developer-api.openapi.yaml:12`, `:365`). A non-browser caller can supply an allowed Origin; every token holder can request any known subject belonging to the FinchNode app.

   **Exact fix:** Replace Task 22’s “`RELAY_CLIENT_TOKEN` (optional)” and the corresponding optional-token language in spec C1/C2 and Task 21 with:

   > “The v1 live relay supports one owner using a dedicated FinchNode application. `RELAY_CLIENT_TOKEN` is a required, high-entropy secret configured using `wrangler secret put`; never place it in `[vars]`. Missing configuration returns 503; missing or incorrect client credentials return 401 before upstream access. Exact Origin validation is an additional browser restriction, not authentication. A shared deployment serving independent users requires per-user authentication and session/subject ownership checks before live use.”

2. **URL prefix checks accept hostile hosts, and changing the relay can send its existing token and subject to another operator.**

   **Evidence:** Spec C2 says return URLs “must start with an allowed origin” (`:272`); [Task 16](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:1848) accepts URLs starting with `http://localhost`. These rules admit strings such as `https://app.example.evil/` and `http://localhost.evil/`. Task 21 saves a new relay URL independently of the token and connection.

   **Exact fix:** Replace Task 16’s base-URL validation sentence, spec C2’s return-URL condition, and Task 21’s relay-URL save sentence with:

   > “Parse URLs using `new URL`. Allow HTTPS, or HTTP only when `hostname` is exactly `localhost` or `127.0.0.1`. Reject username/password, query strings and fragments in relay base URLs. Validate return URLs by exact parsed origin equality with both the request Origin and an `ALLOWED_ORIGINS` entry; enforce the upstream 2048-character limit. Bind saved tokens and live connections to the canonical relay URL. Changing or importing a different relay URL disables the old connection and requires a token to be entered for that endpoint before sending requests. Reject non-HTTPS Hosted Connect redirect URLs and URLs containing credentials. Add hostile-prefix and endpoint-change tests.”

3. **The return flow cannot append a session ID after creation, and it accepts unrelated or replayed session IDs.**

   **Evidence:** [Task 19](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:2114) says the ID is appended to `returnUrl` “after startConnect”; however, FinchNode receives `returnUrl` in the creation request. The vendored API provides no update-return-URL route. `completePendingConnection` accepts the argument before the locally stored session, without requiring equality, pending state, or consent. Its malformed-ID test converts invalid IDs into the same value as an absent ID.

   **Exact fix:** Replace Task 19’s return-URL, pending-session resolution and URL-parser instructions, plus spec C1’s return paragraph, with:

   > “Send `${location.origin}/?records=return` when creating the session; do not append an ID after creation. Persist the returned session ID locally before navigating. On return, capture and remove the return parameters synchronously before rendering or awaiting anything. Completion requires current medical-records consent and a locally stored live pending session bound to the current relay. A supplied session ID must exactly match that pending session; reject malformed, duplicate, mismatched and unsolicited IDs without polling. Only an absent ID may use the pending-session fallback. Add `invalidSession` to `ReturnParams` so malformed input cannot silently become the fallback case. Test consumed-session replay, return after disconnect, and return without a pending session.”

4. **In-flight work can recreate records after Cancel, Disconnect, or Delete all data.**

   **Evidence:** [Task 19](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:2117) polls and writes without cancellation or a connection-generation check. `disconnectAndDelete()` only clears tables and changes consent. Spec C5’s Cancel only clears `pendingSession`. Task 20 runs completion in a component effect, while `app/src/main.tsx:27` enables React StrictMode.

   **Exact fix:** Replace Task 19’s disconnect instruction and Task 20’s “runs `completePendingConnection` once” instruction with:

   > “Give each connection attempt a persisted generation identifier. Deduplicate completion and refresh by generation, including StrictMode remounts. Every asynchronous completion must check the current generation and consent inside the same transaction that commits records or connection state. Cancel, disconnect and wipe invalidate the generation before aborting requests, polling and timers; stale completions must perform no writes, including error writes. Cancel returns to a usable disconnected state. Coordinate invalidation across tabs. Test disconnect/wipe while fetch or sealing is suspended, concurrent refreshes, and duplicate return-handler execution.”

5. **The key store can create two different keys across tabs, and reports successful deletion while deletion is blocked.**

   **Evidence:** [Task 2’s `loadOrCreate`](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:272) reads, generates and writes in separate transactions. Two tabs can both observe no key and memoize different keys; the final write wins, leaving some ciphertext unreadable after reload. `deleteKeyStore()` explicitly resolves on `onblocked` (`:300`).

   **Exact fix:** Replace Task 2’s `loadOrCreate` and `deleteKeyStore` implementation instructions with:

   > “Generate a candidate key outside IndexedDB transactions, then use one readwrite transaction to re-read `MAIN_KEY` and insert the candidate only if no key exists. Resolve with the actual stored winner after transaction completion. Close open database handles on versionchange. A blocked delete must not resolve successfully or permit the UI to report a completed wipe. Coordinate key creation, sealed writes and vault destruction across tabs, and invalidate cached keys on destruction. Tasks 3, 17 and 21 must use this shared lifecycle coordination. Add simultaneous independent-client creation and blocked-delete tests.”

6. **Exports still contain the backup recovery secret and will export/import device-unlock configuration.**

   **Evidence:** `app/src/db/transfer.ts:5` excludes only PIN salt/hash and the legacy AI key. `app/src/screens/Settings.tsx:523` stores the recovery secret under `'recoveryCode'`. Task 4 adds a credential ID to settings, but [Task 18](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:2036) does not extend the exclusion list. This is partly a pre-existing leak that the proposed v2 export retains.

   **Exact fix:** Replace Task 18’s `SECRET_KEYS` instruction with:

   > “Exclude `SK.pinSalt`, `SK.pinHash`, `SK.aiKey`, `'recoveryCode'`, `SK.biometricLock` and `SK.deviceUnlockCredential` from both exported and imported settings. Never serialize the vault, raw keys or relay credentials. Keep a validated credential-free relay URL exportable, but importing it must not activate a connection or reuse credentials bound to another endpoint. Add plaintext-export and import tests containing every excluded key.”

7. **The v2 import instructions are incompatible with the existing transaction and mishandle empty snapshots and existing records.**

   **Evidence:** `app/src/db/transfer.ts:34` opens a transaction containing only `dailyLogs`, `settings` and `contentBookmarks`. [Task 18](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:2036) adds `putSnapshot`, which seals asynchronously and opens another transaction. It imports connection state only “when records exist” and replaces only `categoriesPresent`. Consequently, an empty category cannot clear older records, an empty connected snapshot loses its connection, and old demo/live rows can survive under a different connection.

   **Exact fix:** Replace Task 18’s `applyImport` sentence with:

   > “Validate the complete payload and version before writing. Prepare sealed record rows outside every Dexie transaction. Commit the existing imported tables and the two records tables in one transaction containing all those tables; do not call the sealing `putSnapshot` wrapper inside the existing transaction. A v1 import preserves existing medical records. A v2 import replaces the complete medical-record snapshot and connection, including explicitly empty arrays and null connections. Restore imported snapshots for local viewing with network access disabled until an explicit reconnect; do not restore pending sessions or treat an imported consent entry as current network authorization. Test v2 import over populated demo/live data, empty snapshots, null connection, unsupported versions, and transaction rollback.”

8. **Session completion, granted categories, and snapshot completeness are conflated, causing premature success and destructive partial refreshes.**

   **Evidence:** The API distinguishes session status from `SyncState.status`, which includes `queued`, `syncing`, `failed` and `reauthorization_required` (`finchnode-developer-api.openapi.yaml:540–606`). Task 16 discards sync status. Task 19 fetches immediately on session completion and keeps the originally requested categories. Task 17 deletes every refreshed category even when the snapshot is partial or `not_started`.

   **Exact fix:** Replace Task 16’s session-state mapping and Task 19’s completion/snapshot instructions, updating spec C6 and Task 17 consistently, with:

   > “Retain session sync status, granted/available/missing categories and failure metadata. Use the intersection of locally selected and actually granted categories for subsequent reads; an empty grant must never become an omitted category filter. While session sync is queued or syncing, continue bounded polling. Handle failed and reauthorization-required states explicitly. Preserve snapshot completeness metadata in `RecordsSnapshot`. Complete snapshots replace their authorized categories; partial snapshots upsert received records without deleting previously stored records merely because they are missing; not-started snapshots do not erase records or report a completed import. Delete categories whose consent was removed. Mark retained records as previously cached and distinguish unavailable/not-selected categories from a successful empty category. Add narrowed-grant, queued-sync, partial-refresh and empty-complete-refresh tests.”

9. **The connection state machine has missing initialization and unrecoverable retry paths.**

   **Evidence:** Task 19 describes demo `syncSnapshot(subject)`, although the declared function accepts `ConnectDeps` and reads subject/categories from storage. It only handles errors inside `syncSnapshot`; failures in creation or polling have no prescribed persisted transition. Terminal sessions retain a pending session, and Task 20’s retry then polls that same terminal session. `syncSnapshot` never throws, yet `startConnection` has only successful return variants.

   **Exact fix:** Replace [Task 19’s orchestration comments](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:2111) and Task 20’s error-button instruction with:

   > “Before demo synchronization, persist mode, subject, selected categories and connection generation, then call `syncSnapshot(deps)`. Add an `'error'` result to `startConnection` and return it when synchronization fails. Handle creation, polling and snapshot errors through the same sanitized persisted error path. Require consent and an enabled, correctly bound connection before every network operation. Terminal sessions clear pending state and offer Start again, which creates a new attempt; timeouts retain a resumable pending session; snapshot failures retain the subject and previous records for Refresh. Preserve the same external ID and creation body when retrying an ambiguous creation failure. Apply request deadlines and respect Retry-After within the polling deadline.”

10. **Empty or omitted category filters can broaden access, and provider tests permit importing unselected categories.**

   **Evidence:** The authenticated categories parameter says “Omit for all authorized categories” (`finchnode-developer-api.openapi.yaml:402`). Both creation contracts require nonempty category arrays when supplied. Task 22’s final test requests `/records` without categories. Task 16’s labs/vitals tests return the full seven-category fixture and never assert filtering.

   **Exact fix:** Replace Task 22’s category-building instruction and Task 16’s snapshot-normalization sentences with:

   > “Require a nonempty, unique list drawn from Lunara’s seven categories on creation and snapshot routes. Reject absent, empty, malformed or unsupported category requests before fetching upstream; never forward an omitted filter. Apply the selected/granted category boundary again before normalization and persistence, even if the response contains extra categories. Disable both connect buttons when no categories are selected. Update the Worker test containing `claims` to expect rejection, add categories to its upstream-error request, and assert that provider tests requesting labs/vitals return only labs/vitals.”

11. **Browser printing does not isolate the report from the underlying application.**

   **Evidence:** `app/src/App.tsx:119` renders `main` alongside the report overlay. Print CSS in `app/src/styles/app.css:4120` hides navigation and `.no-print`, but not `main` or unrelated overlays. `app/src/styles/reports.css:265` only hides report controls. Task 6 makes `window.print()` the sole report-export path; Task 21 promises opt-in sensitive sections.

   **Exact fix:** Replace Task 21’s doctor-report rendering instruction, supplementing Task 6’s report-export migration, with:

   > “Give DoctorReport and CycleReportScreen an explicit printable-report root. During printing, hide all other app-root children and scrims; reset the report’s position, transform, height limits and overflow for paginated output. Render provider records only when their checkbox is enabled, and disable export while requested report data is loading or failed. Verify that underlying screens and unchecked sensitive sections are absent from both portrait and landscape print output.”

12. **The existing PIN effect re-locks on ordinary profile writes, and asynchronous unlocks can outlive a hide/re-lock event.**

   **Evidence:** `app/src/App.tsx:92` depends on the entire live-query `flags` object and executes `setLocked(true)` whenever a PIN exists. Records consent writes the health profile, which that query observes. Task 6 only replaces the native visibility listener. `app/src/components/PinLock.tsx:38` and `:55` can later call `setLocked(false)` without checking visibility or whether the lock attempt is still current.

   **Exact fix:** Replace Task 6’s App/PinLock migration instruction with:

   > “Separate initial lock setup and PIN-presence changes from other live-query updates; observing a new profile object must not re-lock an already unlocked session. Cache PIN presence for a synchronous visibility-hidden lock. Increment a lock-attempt generation on hide/re-lock and unmount; PIN hashing and WebAuthn results may unlock only the current generation while the document is visible. Reset partial PIN entry on re-lock and avoid automatically initiating WebAuthn while hidden. Test a consent/profile update while unlocked and delayed PIN/WebAuthn success after a hide event.”

13. **Task 6 leaves concrete TypeScript failures and gives incorrect HealthKit step-removal guidance.**

   **Evidence:** `AssistantScreen.tsx:118` compares vault persistence to `'memory'`; Task 3 narrows it to `'indexeddb-webcrypto'`. An in-memory type check confirmed TS2367 after the prescribed import change. The retained browser test in `native/reportExport.test.ts` still supplies `bridge`, which the replacement dependency type removes. Onboarding’s Apple Health card is inside **`cycle-history`**, at `Onboarding.tsx:969`; there is no HealthKit-specific step ID. Its `biometrics` step means height/weight (`:1367`).

   **Exact fix:** Replace Task 6’s AssistantScreen, report-test and Onboarding bullets with:

   > “In AssistantScreen and Settings, replace all persistence-versus-`'memory'` branches with the browser-vault label. Rewrite the retained browser report test to supply only `{ browserPrint }`; remove its bridge mock and assertion. Remove no Onboarding StepIds. Keep `cycle-history` and the body-measurement `biometrics` step. Remove only the Apple Health subsection within cycle-history, `importApplePeriodsDuringOnboarding`, its four health-import state variables, `onboardingHealthPermission`, and import-only helpers/imports such as `recentCycleLength`, `getPeriodStarts` and `toEpochDay` when no longer used. Use default healthData permission and a not-requested health-import ledger entry until Task 18 adds medical-records consent.”

14. **Repointing Settings imports leaves device unlock hidden and web reminders disabled.**

   **Evidence:** `Settings.tsx:784` renders the biometric toggle only under `isNative`. Its enable handler rejects `!current.enrolled` before enrollment (`:378`). Reminder permission and scheduling remain inside `isNative` branches (`:561`, `:580`), while the web branch forces permission to `not-requested`. Task 6 supplies `isNative = false`.

   **Exact fix:** Replace Task 6’s Settings bullet with:

   > “Remove `profileHealthPermission`, the health/widget state and initialization results, `syncHealthData`, `recordHealthImportDecision`, `importApplePeriods`, and the complete ‘Device health & native services’ section. Remove native gating from device unlock and reminder delivery. Show device unlock when the platform authenticator is available; enabling requires a PIN and calls enrollment before any enrolled check, then saves `SK.biometricLock`. Disabling, or removing the PIN, clears both that flag and the stored credential. Run web permission, scheduling, cancellation and notification-consent updates through the existing reminder handler. Replace every native-only status message. Call `destroySecureVault()` in the existing wipe handler in this task, rather than waiting until Task 21.”

15. **In-session reminders are never restored at startup and stop after their initial 24-hour materialization window.**

   **Evidence:** The only existing `syncReminderPlans` caller is `Settings.tsx:584`. Task 5 schedules one batch limited to 24 hours; only the separate legacy daily timer re-arms. Task 6’s runtime does not restore reminder preferences. `showReminder()` waits indefinitely on `serviceWorker.ready` when no registration becomes ready.

   **Exact fix:** Replace Task 5’s timer-behavior paragraph and Task 6’s runtime initialization instruction with:

   > “Start one reminder scheduler per browser profile after app initialization. Load persisted preferences without requesting permission, refresh the materialization window as time advances and when preferences or visibility change, and coordinate tabs so an occurrence is delivered once. Cancel existing timers when permission is lost or preferences are disabled. Wipe stops scheduling before clearing data. Use an existing service-worker registration or a bounded registration wait, then fall back to Notification when permitted. Validate times with `/^(?:[01]\\d|2[0-3]):[0-5]\\d$/`. Test startup restoration, delivery beyond 24 hours, multiple tabs, denied permission, missing service-worker registration and wipe.”

16. **Tasks 4 and 5’s tests fail on the stated Node 24 runtime before testing their implementations.**

   **Evidence:** The tests assign directly to `globalThis.navigator` at [plan lines 532 and 742](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:532). On this repository’s Node `v24.13.1`, `navigator` is a getter-only configurable property; strict assignment was reproduced as `TypeError: Cannot set property navigator … which has only a getter`.

   **Exact fix:** Replace the global setup/cleanup in Tasks 4 and 5 with:

   > “Use `vi.stubGlobal('navigator', value)`, `vi.stubGlobal('window', value)`, `vi.stubGlobal('PublicKeyCredential', value)` and `vi.stubGlobal('Notification', value)` as applicable. Restore originals with `vi.unstubAllGlobals()` in `afterEach`; do not assign to or delete Node globals directly. Task 19 must also restore its stubbed location. Use asynchronous timer advancement in tests exercising the service-worker Promise path.”

17. **The PWA guard tests the original callback, not the generated worker, and the callback captures unavailable module state.**

   **Evidence:** [Task 7](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:1116) uses `NEVER_CACHE_HOSTS` inside `urlPattern`; its test invokes the original function with its closure intact. Re-evaluating that callback without the module scope produces `ReferenceError`. **Generation risk:** the PWA package is not yet installed, so its emitted worker was not directly inspected in this review.

   **Exact fix:** Replace Task 7’s first matcher with:

   ```ts
   urlPattern: ({ url }) => url.hostname === 'api.finchnode.com',
   ```

   Replace its cache-test instruction with:

   > “Keep generated-worker callbacks self-contained. Test both the serialized matcher and the built service worker, including FinchNode, an arbitrary relay, AI, backup and same-origin API requests. Assert that every configured runtime strategy is NetworkOnly and that no sensitive response enters CacheStorage. Verify the return navigation serves the shell without caching a session-specific response. In Task 16’s HTTP helper, set `credentials: 'omit'`, `cache: 'no-store'` and reject unexpected fetch redirects.”

18. **The desktop stylesheet cannot produce the promised rail and correctly centered dialogs, and the fifth tab wraps on mobile.**

   **Evidence:** All the named tab selectors exist, but `.tabbar-inner` is `display: grid; grid-template-columns: repeat(4, 1fr)` (`app.css:2739`). Task 12 changes `flex-direction` without changing display. Its `translateX(-50%)` is overridden by existing `animation: … both`; both dialog keyframes end at zero translation (`app.css:3969`). The body scrim sits outside the isolated root (`base.css:64`), while Sheet already has a real backdrop. Task 20 never changes the four-column grid.

   **Exact fix:** Replace Task 12’s stylesheet instructions and Task 20’s navigation styling instruction with:

   > “Use `@media screen and (min-width: 900px)`. Set `.tabbar-inner { display: flex; flex-direction: column; }` and `main { min-width: 0; }`; keep `.page` as the centered 760px content container. Center `.overlay`, `.sheet` and `.health-overlay` with explicit viewport bounds and disable or replace their transform animations. Preserve scrolling in `.overlay-body`, `.sheet-body` and `.health-scroll`. Reuse `.sheet-backdrop`; place other dialog scrims inside the root below their dialogs, rather than using `body::after`. Import records.css before desktop.css and keep desktop.css last among screen styles. When adding Records, change the mobile tab grid to `repeat(5, minmax(0, 1fr))`. Verify scrolling, backdrop behavior and portrait/landscape printing.”

19. **The live normalizer’s “copy the fields” rule does not safely represent the actual contract.**

   **Evidence:** The upstream observation `value` is unconstrained (`finchnode-developer-api.openapi.yaml:787`), whereas Task 13 permits only string/number/null. Demographics may be null or an object with nested records (`:934`); emitting the object and every nested record can duplicate IDs. [Task 15](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:1742) passes `rec.sourceRecordId ?? index` to a string-only fallback parameter and supplies no stable missing-ID rule.

   **Exact fix:** Replace Task 15’s mapping paragraph with:

   > “Validate fields explicitly rather than spreading upstream objects. For live records, require a valid upstream `rec_…` ID and use it as the stable local identity; preserve the separate nullable `sourceRecordId` field. Skip and count malformed records without a stable ID. Normalize observation values to string/finite-number/null using an explicit safe display conversion for other JSON values. Handle demographics null, object-only and nested records separately; deduplicate by upstream record ID without persisting the nested records array inside a demographic row. Fill absent nullable fields with null. Test object-valued observations, duplicate/nested demographics, malformed records and missing arrays. The partial fixture must not simultaneously claim immunizations are missing and contain an immunization record; adjust its expected count accordingly.”

20. **The FHIR normalizer can display a reversed or unrelated pair of measurements as blood pressure.**

   **Evidence:** [Task 14](/Users/camerondang/Documents/Council/Engineering/period-app/docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md:1656) formats any two numeric components as `"v/v"`. The vendored sample identifies systolic and diastolic components using LOINC `8480-6` and `8462-4` (`demo-records-sample.json:359`, `:374`). The test only checks a digit/slash pattern, so reversed values pass.

   **Exact fix:** Replace Task 14’s component-formatting rule and BP assertion with:

   > “Format blood pressure as systolic/diastolic only when the components identify LOINC 8480-6 and 8462-4; locate them by code rather than array order and check compatible units. Render other components as labeled values. Assert the sample value is exactly `124/78`, add a reversed-component fixture, and verify that an unrelated two-component observation remains labeled. Format one-sided reference ranges without interpolating undefined bounds. Include malformed-resource and missing-date tests.”

## Non-blocking findings

1. **The typography and palette tasks miss effective CSS declarations and some hard-coded colors.**

   **Evidence:** Task 9 targets display headings at weight 700, but `.page h1`, `.page h2` and `.overlay-head h2` use 500 (`app.css:41`, `:48`, `:2844`). `health.css:33`, `:85` directly name Avenir/Iowan. The effective onboarding CTA overrides `.cta` at `app.css:7093`. Health colors and the fertile gradient remain literal teal (`health.css:7`, `app.css:911`).

   **Exact fix:** Replace Task 9’s heading-search sentence and Task 11’s “or whatever `app.css` names them” sentence with:

   > “Set display-heading rules, including current weight-500 headings, to `--weight-display`. Replace direct Avenir/Iowan font declarations in health.css with font tokens. Target `.cta` and `.page.onboarding .ob-shell-footer .cta`, preserving secondary, yellow and disabled variants. Update `.phase-fertile`, `.phase-ovulation`, `.cal-day.*`, `.date-cell.*`, `.bbt-line`, `.bbt-point`, and health.css’s local palette variables and literal gradients. Use a separate dark chart-series token for BBT. Inspect final computed styles; a passing token test alone does not verify the CSS cascade.”

2. **The privacy copy contradicts exports, backup transport and the actual demo request.**

   **Evidence:** Task 20 says records “are never sent anywhere else.” Task 18 includes them in `collectExport`, and `app/src/lib/backup.ts:12` encrypts that entire payload for backup. Spec section 8 says demo sends “Category list only,” but Task 16 sends `external_user_id` too.

   **Exact fix:** Replace Task 20’s introduction with:

   > “Bring conditions, medications, labs and more from your provider into Lunara. Records are encrypted in this browser and are not sent to the AI assistant. They are included when you export a backup or explicitly upload an encrypted backup, and you can choose to include them in a report.”

   Replace Task 21’s “verbatim” privacy-table instruction with:

   > “Correct the demo row to ‘Chosen categories and a random external ID.’ State that encrypted backup uploads include imported records and are initiated by the backup action. Carry these same statements into PRIVACY.md and the consent explanation.”

3. **Some sensitive connection metadata remains plaintext despite the broad encryption language.**

   **Evidence:** Task 17 stores `RecordsConnection` directly. That object contains provider organizations, warnings, subject/session identifiers and consent receipts (Task 13, `:1582`). Only medical-record bodies are sealed.

   **Exact fix:** Replace Task 23’s storage-description instruction with:

   > “List the encryption boundary precisely: medical-record bodies and vault secrets are sealed; record IDs/categories/dates and connection metadata—including organizations, warnings, subjects and pending-session identifiers—remain plaintext in IndexedDB. Existing daily logs and health profiles are also not sealed. Do not describe the entire local database as encrypted.”

4. **The WebAuthn test title promises a check that neither the test nor implementation performs.**

   **Evidence:** Task 4’s test says “authenticates only when the stored credential is asserted,” but supplies only the expected credential. The implementation returns `Boolean(assertion)` (`plan:686`).

   **Exact fix:** Replace that return statement’s instruction with:

   > “Return authenticated only for a non-null public-key credential whose raw ID matches the stored credential ID. Add null, wrong-type and wrong-ID cases. Continue to describe this as a local screen gate without server signature verification; do not claim it cryptographically protects the stored encryption key.”

5. **The relay’s rate-limit headers are not explicitly exposed to browser JavaScript, and its error/security tests are incomplete.**

   **Evidence:** Task 22 copies Retry-After and RateLimit headers but never requires `Access-Control-Expose-Headers`; Task 16 reads Retry-After. Worker tests only cover a missing token and use incomplete error envelopes. The upstream envelope requires `type`, `code`, `message`, `requestId` (`finchnode-developer-api.openapi.yaml:1145`).

   **Exact fix:** Replace Task 22’s header-copy sentence with:

   > “Copy and expose Retry-After and RateLimit-Limit/Remaining/Reset using `Access-Control-Expose-Headers`; include `Vary: Origin`. Apply no-store to session, snapshot and error responses. Use complete vendored error envelopes in fixtures and sanitized equivalent envelopes for local errors. Test incorrect tokens, missing/disallowed Origin on actual requests, malformed JSON, oversized bodies, upstream network failure and browser-visible Retry-After. Implement a full fixed-length digest comparison without an early-return byte comparison.”

6. **The new export format retains the old backup’s omission of canonical health-profile and regimen data.**

   **Evidence:** `LunaraDB` includes `healthProfiles`, `regimenRecords` and `missedDoseEvents` (`schema.ts:367–378`), but neither the current export nor Task 18’s v2 shape includes them. The medical-records consent ledger resides in `healthProfiles`.

   **Exact fix:** Replace Task 18’s `ExportPayload` description with:

   > “In addition to the stated fields, include the canonical healthProfiles, regimenRecords and missedDoseEvents tables in v2, with explicit validation and transaction membership. Historical consent may be restored for audit purposes but does not enable network access. Continue accepting v1 files without these tables. Add a fresh-database round trip containing a health profile and regimen/adherence records.”

7. **The plan’s version label is stale, but its proposed ES2024 setting is compatible with the actual lockfile.**

   **Evidence:** The plan says TypeScript 5.6; `pnpm-lock.yaml:79` locks **5.9.3**, which is also installed. Current `tsconfig.json:4` uses ES2022, so `Object.groupBy` needs the proposed newer library declaration.

   **Exact fix:** Replace Task 14’s conditional lib advice and the plan’s TypeScript version label with:

   > “Use the locked TypeScript 5.9.3. Add `resolveJsonModule: true` and set `lib` to `['ES2024', 'DOM', 'DOM.Iterable']`; keep the existing target/module settings. Run tsc as part of this task, not only vitest. If intentionally supporting TypeScript 5.6 instead, replace the test’s Object.groupBy with an ES2022-compatible grouping loop.”

8. **Several tests and verification steps are weaker than their names or claimed coverage.**

   **Evidence:** Task 3’s raw IndexedDB inspection never closes its database handle (`plan:380`). Task 15’s nested-demographics test only inspects the general fixture. Task 17’s tests never open an actual v3 database and upgrade it. Task 8 refers to nonexistent Task 24; the plan ends at Task 23.

   **Exact fix:** Replace the corresponding test/verification instructions with:

   > “Close the raw secrets database after the inspection transaction completes. Give the demographics test explicit null, object-only and nested fixtures. Add a real v3-to-v4 fake-indexeddb migration test that preserves every existing table, plus a liveQuery test proving absent-connection reads perform no writes. Replace ‘Task 24’ in Task 8 with ‘Task 23’. Describe expected checks by behavior rather than fixed test totals that become stale as coverage grows.”

## Verified OK

- Both the 469-line spec and 2,455-line plan were read fully; the review made no file changes.
- The current repository passes `tsc --noEmit`; planned implementations and their new tests do not yet exist, so they were not reported as executed.
- `LunaraDB`, its seven v3 tables, the referenced settings/profile helpers, and the existing native migration source files exist.
- Adding Dexie version 4 with the two new tables is valid; existing rows need no record-sealing migration because the records table is new.
- Preparing ciphertext before a standalone write transaction, and fetching rows before decryption, avoids awaiting WebCrypto inside the transaction.
- `getHealthProfile()` is explicitly read-only; `ensureHealthProfile()` already persists bootstrap state outside liveQuery.
- All six existing `nativeTap()` calls use no arguments; the proposed no-argument adapter fits them.
- `initializeNativeRuntime` is called from main.tsx; both report screens use the expected `exportCurrentReport` function.
- `.tabbar`, `.tabbar-inner`, `.tabbar-item`, `.is-active`, `.tabbar-label`, `.overlay`, `.sheet`, `.page`, `.card`, `.section-label` and `.cta` exist.
- All four PWA icon paths referenced by Task 7 already exist in `app/public/icons`.
- FinchNode live route names, Bearer authentication, session/subject/record ID patterns, `one-time`, 365-day duration and Idempotency-Key usage match the vendored contract.
- Lunara’s seven categories are valid subsets of both APIs; demo `external_user_id` and live `externalId` correctly differ.
- The demo sample contains the expected 12 resources, including three labs and one blood-pressure observation; the quoted patient, medication and A1c assertions match it.
- Node 24 provides `Object.groupBy`; JSON-module imports are compatible with the current bundler module resolution after enabling `resolveJsonModule`.
- All specified palette contrast pairs pass numerically; period/fertile contrast is approximately 1.618:1.
- The existing assistant context collector reads logs/settings only; the proposed separate records tables do not automatically enter AI requests.
- The backup Worker package supplies the proposed Wrangler/Vitest package pattern; the workspace already includes `workers/*`.

## Open questions

- **Will a relay ever serve independent users?** Assume one owner and a dedicated FinchNode application. A shared service changes the authorization design substantially; a shared token alone is insufficient.
- **Should v1 display the API’s additional `medicationAdministrations`, `medicationDispenses` and `diagnosticReports` arrays?** Assume they are excluded from display initially, explicitly counted/disclosed as unsupported rather than silently presented as a complete medication/lab import. The contract includes these arrays at `finchnode-developer-api.openapi.yaml:949–968`, but the plan supplies no mapping rules for them.

Codex session ID: 01a08f56-3d85-7bb2-bcf7-1516c4b31f1a
Resume in Codex: codex resume 01a08f56-3d85-7bb2-bcf7-1516c4b31f1a
