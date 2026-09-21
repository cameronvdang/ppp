# PPP: rename, mobile-first install, and add-to-calendar

Date: 2026-09-11
Status: implemented on `feat/web-app-finchnode` (2026-09-11) through Tasks 1-16 plus review fixes; independent Claude subagent reviews, Codex execution
Branch: `feat/web-app-finchnode` (continues the Lunara-web work)
Depends on: `docs/superpowers/specs/2026-09-10-lunara-web-finchnode-design.md`

## 1. Goal

Three user requests, in one release:

1. **Rename the application everywhere to "PPP".**
2. **Make it extremely mobile-friendly.** Users will "download" it by adding it
   to their home screen, so the installed PWA must feel like a native app on
   iOS Safari and Android Chrome.
3. **Let users add it to their calendar.** Predicted period and fertile
   windows, and the reminders they already configure, become calendar events
   in the user's own calendar app, without any server.

## 2. Non-goals

- No new logo or icon artwork. The crescent mark stays; only names change.
- No renaming of the historical documents under `docs/superpowers/` (they
  record the past). The GitHub repository was out of scope at first and was
  renamed to `cameronvdang/ppp` on 2026-09-20 at the user's request; GitHub
  redirects the old URL.
- No calendar subscription URL (that needs a server) and no OAuth to Google
  or Microsoft calendars. Files only.
- No native app store packaging.
- No migration of data from an IndexedDB database named `lunara` to the new
  `ppp` name. There are no external users of the fork yet; the reviewer's
  sample data is disposable.

## 3. Assumptions made without user input

| Decision | Choice | Alternative |
| --- | --- | --- |
| Meaning of "PPP" | Used verbatim, never expanded | Inventing an expansion (rejected: unknown) |
| Internal identifiers | Renamed too (`PppDB`, `ppp-keys`, `X-PPP-Relay-Token`, `@ppp/app`) so nothing says Lunara except attribution | UI-only rename (rejected: "everywhere") |
| Upstream attribution | Kept: "PPP is based on Lunara (AGPL-3.0)" in README, PRIVACY, Settings footer; AGPL requires it | Removing it (not allowed by the license) |
| Import of old exports | Accept `app: 'lunara'` export files forever; write `app: 'ppp'` | Rejecting them (loses the upgrade path for Lunara users) |
| Calendar delivery | Local `.ics` file via share sheet or download | Google Calendar deep links (rejected: sends event data to Google via URL) |
| Calendar privacy | Discreet event titles ("PPP", "PPP +") on by default | Descriptive titles by default (rejected: shared calendars leak) |
| Forecast horizon | Next 3 cycles by default, up to 6 | Unbounded (rejected: uncertainty grows each cycle) |
| iOS splash screens | Generated from the existing splash SVGs for six common devices | Skipping (rejected: white flash on launch feels un-native) |

## 4. Section A: rename to PPP

### A1. Rule

Replace every product mention of "Lunara" with "PPP" except where the word
refers to the upstream project: the attribution sentence, the upstream URL,
`docs/finchnode/README.md`'s note, and the historical `docs/superpowers/*`
files. Historical audit docs (`docs/RESEARCH.md`, `docs/*_AUDIT.md`,
`docs/FLO_SCREEN_CATALOG.md`, `docs/CURRENT_PROGRESS_AND_ROADMAP.md`,
`docs/FEATURE_PARITY.md`) get a one-line note at the top ("Written when the
product was named Lunara; the product is now PPP.") and are otherwise left
alone.

### A2. Surfaces

| Surface | Before | After |
| --- | --- | --- |
| `<title>`, manifest `name`/`short_name`, `apple-mobile-web-app-title` | Lunara | PPP |
| Headings, aria labels, notification titles, "Lunara AI" | Lunara | PPP |
| Settings footer | "Lunara is open source (AGPL-3.0) and not affiliated with Flo Health Inc." | "PPP is open source (AGPL-3.0), based on Lunara, and not affiliated with Flo Health Inc." |
| Packages | `@lunara/app`, `@lunara/*-worker` | `@ppp/app`, `@ppp/*-worker`; root `name: "ppp"` |
| Wrangler names | `lunara-backup`, `lunara-reminders`, `lunara-records-relay`, bucket `lunara-backups` | `ppp-backup`, `ppp-reminders`, `ppp-records-relay`, `ppp-backups` |
| Hostnames in worker config and tests | `lunara.app` | placeholder `ppp.example` (PPP owns no domain yet; operators replace it) |
| Relay header | `X-Lunara-Relay-Token` | `X-PPP-Relay-Token` (relay, provider, tests, README, CSP notes) |
| Dexie class and DB names | `LunaraDB`, `lunara`, `lunara-keys`, `lunara-secrets` | `PppDB`, `ppp`, `ppp-keys`, `ppp-secrets` |
| Web Lock names, notification tags | `lunara-vault-lifecycle`, `lunara-daily:*`, `lunara-records-refresh`, `lunara-relay-settings`, `lunara-v3-migration` | `ppp-` prefix |
| WebAuthn `rp.name` / `user.name` | Lunara / lunara-local | PPP / ppp-local |
| Crypto domain strings | `lunara-pin:`, `lunara-blob-id:` | `ppp-pin:`, `ppp-blob-id:` (existing PINs and backup ids are not preserved; no users) |
| Export payload | `app: 'lunara'` | writes `'ppp'`, imports accept `'lunara'` or `'ppp'` |
| File names | `lunara-backup-*.json`, `lunara-encrypted-*.json` | `ppp-backup-*.json`, `ppp-encrypted-*.json` |
| Component and CSS | `LunaraMark`, `.lunara-crescent`, `.lunara-brand-button`, SVG ids `lunara-*` | `PppMark`, `.ppp-crescent`, `.ppp-brand-button`, `ppp-*` |
| Brand files | `app/brand/lunara-*.svg` | `app/brand/ppp-*.svg` (content unchanged) |
| Docs | README, PRIVACY, worker READMEs, `WEB_CAPABILITY_BOUNDARY` | PPP, with the attribution sentence |
| Dev config | `.claude/launch.json` names | `ppp-preview`, `ppp-dev` |

A test asserts that `grep -ri lunara app/src workers` matches only the
attribution sentence and the legacy import check.

## 5. Section B: extremely mobile-friendly

### B1. Installability

- Manifest additions: `id: '/'`, `scope: '/'`, `display: 'standalone'`,
  `display_override: ['standalone', 'minimal-ui']`, `orientation: 'portrait'`,
  `lang: 'en'`, `categories: ['health', 'lifestyle']`,
  `prefer_related_applications: false`, and two `shortcuts`:
  "Log today" → `/?action=log` and "Records" → `/?tab=records`, each with the
  192px icon.
- `index.html` head: `apple-mobile-web-app-capable`,
  `apple-mobile-web-app-status-bar-style=default`,
  `apple-mobile-web-app-title=PPP`, `mobile-web-app-capable`,
  `format-detection=telephone=no`, `<link rel="apple-touch-icon">`, and six
  `apple-touch-startup-image` links (iPhone SE, iPhone 13/14, 14 Plus, 14 Pro
  Max, iPad 10.2", iPad Pro 11") generated at build time by
  `app/scripts/splash.mjs` (uses `sharp`, already in the pnpm store) from
  `app/brand/ppp-splash-portrait.svg` into `app/public/splash/`.
- App start reads `?action=log` (opens today's log sheet) and `?tab=<tab>`
  (selects the tab), then strips the query the same way the records return
  does.

### B2. Install prompt

`src/platform/install.ts` exposes `getInstallState()` and
`subscribeInstallState(listener)`:

```ts
type InstallMode = 'installed' | 'prompt' | 'ios-instructions' | 'unsupported'
interface InstallState { mode: InstallMode; prompt?: () => Promise<'accepted' | 'dismissed'> }
```

- `installed` when `matchMedia('(display-mode: standalone)').matches` or
  `navigator.standalone === true`.
- `prompt` after a captured `beforeinstallprompt` event (Chromium).
- `ios-instructions` on iOS Safari (`/iPhone|iPad|iPod/` in the UA, or
  Macintosh + `maxTouchPoints > 1`) that is not standalone.
- `unsupported` otherwise (desktop Safari, Firefox): show nothing.

`InstallCard` renders on Today above the daily insights with copy "Add PPP to
your home screen" and either a button "Add to home screen" (prompt mode) or
the two-step iOS instruction "Tap Share, then Add to Home Screen" with the
share glyph. Dismissal stores `SK.installCardDismissedAt`; the card returns
after 14 days. Settings gets a permanent "Home screen" row with the same
state. In `installed` mode both disappear.

### B3. Touch and layout

- Global rules in `base.css`: `button, [role=button], a, .chip, .tabbar-item
  { touch-action: manipulation }`; `input, select, textarea { font-size: max(16px,
  1em) }` (prevents iOS zoom); `#root { min-height: 100dvh }`;
  `-webkit-text-size-adjust: 100%`; `overscroll-behavior-y: contain` on `main`.
- Minimum 44×44px hit areas on tab bar items, chips, calendar day cells, date
  strip cells, the PIN pad, quick actions. Where a visual is smaller, use
  padding or a `::before` hit-area extension.
- Safe areas: `env(safe-area-inset-*)` on the tab bar (exists), overlays,
  sheets and the install card. In `@media (display-mode: standalone)`, the
  top of `main` gets `padding-top: max(var(--safe-top), 12px)`.
- Landscape phones (`max-height: 500px`): tab bar compact, sheets scroll.
- 320px width (iPhone SE): no horizontal overflow anywhere. A test builds the
  app and asserts no CSS declares a fixed pixel width above 320 on `.page`.
- Performance: `AssistantScreen` (and the Anthropic SDK it imports) load via
  `React.lazy` so the main chunk drops below 500 kB; `DoctorReport`,
  `CycleReportScreen` and the records screens also lazy-load. A test asserts
  the largest emitted chunk is under 500 kB.

## 6. Section C: add to calendar

### C1. Format and delivery

- `.ics` files generated in the browser by `src/calendar/ics.ts` (pure). Two
  exports: **forecast** (`ppp-forecast.ics`) and **reminders**
  (`ppp-reminders.ics`). Delivery through `shareOrDownload(name, contents,
  'text/calendar')`: on iOS/Android the share sheet offers Calendar; on
  desktop the file downloads and opens in the default calendar app.
- Nothing is sent anywhere. The privacy table gains the row "Your calendar
  app | User taps Add to calendar | An .ics file with estimated dates or
  reminder times, generated on this device | Yes".

### C2. Forecast events

- Reuse the personalized forecast exactly as Today computes it: extract the
  body of Today's live query into `src/lib/personalizedForecast.ts`
  (`computePersonalizedForecast(date)`), used by Today and by the export.
- Eligibility comes from `PersonalizedPrediction.eligibility`: no period
  events when `periodForecast` is false; no fertile or ovulation events when
  `fertileWindow` / `ovulationForecast` are false (pregnancy or hormonal
  contraception).
- Nothing is exported when `prediction.nextPeriodStart` is null (the
  eligibility flag alone is not enough; it is true for anyone not pregnant).
  Cycle 1's period window is `nextPeriodStart ± prediction.uncertaintyDays`
  (the profile-adjusted value); fertile and ovulation windows come from the
  engine. Cycles 2..N shift by `prediction.averageCycleLength` days and widen
  the period window by `uncertaintyDays` per extra cycle. N defaults to 3,
  max 6.
- Events are all-day. Titles: discreet mode (default) "PPP" (period), "PPP +"
  (fertile), "PPP ○" (ovulation); descriptive mode "Period expected",
  "Fertile window (estimate)", "Ovulation (estimate)". Description always
  ends with "Estimate from PPP, ±N days. Not for contraception."
- UIDs are stable and opaque in both modes so re-importing or switching modes
  replaces rather than duplicates: `ppp-a-<n>@ppp.local` (period),
  `ppp-b-<n>@ppp.local` (fertile), `ppp-c-<n>@ppp.local` (ovulation).
  `SEQUENCE` is the epoch minute of export. Discreet mode also omits the
  `X-PPP-KIND` property and the contraception sentence from descriptions;
  the Settings card carries that disclaimer instead.

### C3. Reminder events

- Each enabled `ReminderPlan` becomes one timed `VEVENT` with a 15-minute
  duration and `VALARM` (`TRIGGER:PT0M`, `ACTION:DISPLAY`), using floating
  local time (no `TZID`) so it fires at the wall-clock time wherever the user
  is. Recurrence mapping: `daily` → `FREQ=DAILY[;INTERVAL=n]`; `weekdays` →
  `FREQ=WEEKLY;BYDAY=MO,…`; `interval-days` → `FREQ=DAILY;INTERVAL=n`;
  `monthly` → `FREQ=MONTHLY;BYMONTHDAY=d`; `once` → single event; `dates` →
  `RDATE`. `endDate` → `UNTIL`. Quiet hours are not applied (calendar apps have
  their own) and the Settings copy says so.
- Titles and bodies come from the same neutral copy as notifications
  (`copyFor`): "PPP" in private-preview mode, otherwise "PPP reminder" /
  "PPP check-in" / "PPP update". Definition labels such as "Ovulation test"
  are never used; calendars are the most-shared surface.
- UIDs are stable opaque ids: `ppp-r-<index>@ppp.local`, where index is the
  plan definition's position in `REMINDER_DEFINITIONS`; plans without a
  definition use `ppp-r-h<fnv1a hash of plan.id>@ppp.local`.

### C4. UI

- Settings gains a **Calendar** card: "Add cycle forecast to calendar"
  (with a "Discreet titles" switch, default on, and a "Cycles" choice 3/6),
  "Add reminders to calendar", and the copy "Your calendar app imports the
  file. Nothing is sent to PPP. Re-importing updates the same events."
  Buttons disable with a reason when nothing is eligible ("Log two period
  starts first", "Turn on a reminder first").
- Today's phase hero gets an "Add to calendar" quick action when a period
  forecast is eligible; it exports the forecast with the saved preferences.
- Preferences persist in settings keys `calendarDiscreet` ('1' default) and
  `calendarCycles` ('3').

### C5. Errors

`shareOrDownload` rejection (share cancelled) is silent; other failures show
"Could not create the calendar file." No partial files: the builder throws on
invalid input before any download starts.

## 7. Privacy

- No new network destination. The `.ics` leaves the device only through the
  user's share or download action.
- Discreet titles by default because calendars are often shared with
  partners, family, or employers.
- Reminder bodies follow the notification neutrality rule.
- PRIVACY.md gains a "Calendar files" section and the table row above.

## 8. Testing

- Rename: a vitest that greps `app/src` and `workers` for `lunara` and allows
  only the attribution sentence and the legacy import literal; all existing
  suites pass after the rename (identifiers in tests updated).
- Install: `install.ts` mode detection under stubbed `matchMedia`,
  `navigator.standalone`, UA strings, and a synthetic `beforeinstallprompt`;
  dismissal expiry; manifest test extended for `id`, `scope`, `shortcuts`.
- Mobile: chunk-size test on the build output; splash script produces six
  files with the expected dimensions.
- Calendar: `ics.ts` escaping, 75-octet folding, CRLF, all-day `DTEND`
  exclusivity, `RRULE`/`RDATE`/`UNTIL`, `VALARM`; forecast events for 1, 3
  and 6 cycles, suppression by eligibility, discreet vs descriptive titles,
  stable UIDs; reminder events for every recurrence type; a golden-file test
  for one full forecast export.
- Reviewer browser pass at 375px and 320px, installed-mode emulation, share
  sheet on the phone if available, and an `.ics` import into a calendar app.

## 9. Phasing

One Codex run in task order: rename (Tasks 1–3), mobile (Tasks 4–8), calendar
(Tasks 9–12). Then an independent Claude subagent performs the adversarial
review; Codex applies accepted findings; the orchestrator verifies in the
browser.

## 10. Risks

- The rename touches 85 files; a missed identifier breaks a lock, tag, or
  header silently. The grep test and the full suites are the guard.
- iOS has no install API; the instruction card is the best available.
- Extrapolated cycles 2..N are less reliable than cycle 1; the description
  says so and the default is 3 cycles.
- Floating-time reminders shift if the user travels; documented.

## 11. Addendum: phases and per-day symptoms (2026-09-11)

The user asked that PPP track phases and let users note symptoms such as
diarrhea or nausea on specific days. What exists: a per-day log with a
Digestion section (nausea, bloating, diarrhea, constipation, and more) plus
symptom and mood sections; Today's hero shows period, fertile-window and
ovulation states; the calendar marks period, fertile and ovulation days.
Gaps: the follicular and luteal phases are never named, the daily log does
not say which phase its day is in, and the calendar does not show which days
have notes.

Design:

- A pure phase engine (`engine/phase.ts`) names the phase of any date:
  period, follicular, fertile window (estimate), ovulation (estimate), luteal,
  or plain "Cycle day N" when estimates are unavailable or suppressed by
  hormonal contraception or pregnancy. It derives from logged flow runs plus
  the personalized prediction, so it never contradicts Today.
- Today shows the phase name with the cycle day; the daily log sheet shows the
  phase of the day being edited; the calendar tints follicular and luteal days
  lightly, keeps its period/fertile/ovulation markers, and adds a dot on days
  with any symptom, digestion or mood note, with legend entries for each.
- Tapping a calendar day still opens that day's log, which is where symptoms
  are noted. No schema or taxonomy changes.
- Copy always says "estimate"; nothing is presented as confirmed ovulation.

Plan: `docs/superpowers/plans/2026-09-11-ppp-phases-symptoms.md` (Tasks 13–15).

## 12. Addendum: plain-language UI (2026-09-11)

The user asked for less verbose UI copy with no technical jargon; the Settings
sentence "Credentials are encrypted with a non-extractable browser-managed key
stored in IndexedDB…" was the example. Architecture detail on the interface
reveals more than a user needs and reads as noise.

Design:

- Every sentence in the main UI is short (aim for 12 words, never more than
  20; the consent sentence may reach 24) and describes an outcome, not a
  mechanism: "Encrypted on this device", "Your PIN locks the screen".
- Implementation vocabulary is banned from screens, components and the
  in-app privacy table (a guard test enforces a list: IndexedDB, WebCrypto,
  non-extractable, AES, browser-managed, pseudonymous, subject ID, external ID,
  return URL, client token, single-owner, vault, sealed, service worker, PWA,
  FHIR, RRULE, PRIVACY.md, repository, metadata, allowlist, canonical, BYOK,
  API, .ics). The relay is called "your connector" in the UI, with fields
  "Connector address" and "Connector key".
- Honesty is preserved: "encrypted on this device" is said only about records
  and saved keys; predictions are always "estimates"; consent text still says
  what is sent and where.
- Everything removed from the UI moves to `PRIVACY.md`, which keeps the full
  technical account, and the in-app "Privacy and data" card keeps a plain
  version of the destinations table.

Plan: `docs/superpowers/plans/2026-09-11-ppp-copy.md` (Task 16).

## 13. Addendum: remove machine-generated UI patterns (2026-09-12)

The user asked to remove eyebrows and "general AI subtitles", and to research
the common tells of AI-generated interfaces so all of them are removed. The
tells, from published guides on the subject (TeneX Studio, 925 Studios,
Developers Digest, solodesign.cc, Inspire Studio) plus this reviewer's own
inspection:

1. A small uppercase, letter-spaced label ("eyebrow" or "kicker") above every
   headline, sometimes as a pill.
2. A tagline subline under every title that restates or decorates it.
3. Repetitive block anatomy: label, headline, subline, arrow button.
4. Rows of exactly three equal cards with icon, title and two-line blurb.
5. Arrow glyphs (→ ↗ ›) inside button and link text; "Learn more" pills.
6. Em dashes in copy.
7. Lofty or motivational microcopy ("Read, ask, notice", "Your time, your
   rhythm", "A clearer map of your changing body") and soft adjectives
   ("gentle", "calm", "quietly", "companion").
8. Decorative gradient heroes with orbiting shapes (kept here only where they
   carry the cycle ring; no new ones).

Design: delete patterns 1 to 7 everywhere in the app UI; keep every fact by
folding it into a sentence-case heading or the first sentence; group labels in
Settings and Records become normal sentence-case headings; the copy guard
gains checks for the banned classes, glyphs, adjectives and uppercase styles.
Plan: `docs/superpowers/plans/2026-09-12-ppp-declutter.md` (Task 17).

## 14. Addendum: offline-ready home-screen app (2026-09-13)

The user asked that PPP, once added to the home screen, work essentially
offline. State of play: the build already ships a service worker that
precaches the complete shell (every script, style, font, icon and splash
image; 43 entries) and serves navigations from it with outdated-cache
cleanup, and all tracking data is local in IndexedDB. Measured gaps: nothing
asks the browser to keep the data (eviction risk on low storage), the
network-only features fail with generic errors when offline, and the app
never tells the user it is ready to work offline.

Design:

- Ask for persistent storage (`navigator.storage.persist()`) once onboarding
  is complete; show the answer in Settings as "Kept on this device".
- One online-state module; provider records, the assistant and backup upload
  check it first and show "You are offline. This needs a connection." The
  Records screen and assistant show a one-line offline notice.
- Settings gains an "Offline" group: "Works offline: Ready" when a worker
  controls the page and the shell is stored, plus the storage row above.
- The worker config becomes explicit (navigation fallback, clientsClaim,
  skipWaiting, cleanup, `woff` in the precache glob) and a build-time check
  fails if any shell file is missing from the precache or a network-only rule
  disappears.
- Copy stays plain: "downloaded", "works offline", "kept on this device";
  never worker or cache terms.
- Verified by the orchestrator by stopping the preview server and reloading
  the installed shell.

Plan: `docs/superpowers/plans/2026-09-13-ppp-offline.md` (Tasks 18–19).
