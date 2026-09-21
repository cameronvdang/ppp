# PPP release verification

Date: 2026-09-11. Branch: `feat/web-app-finchnode`.

All twelve implementation tasks are complete, with one commit per task through
the writable scratch Git clone. Each commit includes the requested co-author
trailer. The branch is preserved locally. No push or deployment was performed.

## Task status

| Task | Result | Verification |
| --- | --- | --- |
| 1. Code and identifier rename | Passed | Guard failed before changes; 500 app tests, TypeScript, relay 46, backup 5, reminders 22 passed afterward. |
| 2. Packages, brand and documentation | Passed | Offline workspace install, 500 app tests, TypeScript, build and rename sweep passed. |
| 3. Manifest, splash images and shortcuts | Passed | Manifest test failed before changes; 3 tests passed afterward. TypeScript/build passed. Six images have the requested dimensions, each below 15 KiB; six startup links are built. |
| 4. Install state | Passed | Missing-module test failed first; 10 detection/listener/dismissal tests and TypeScript passed. |
| 5. Today and Settings install card | Passed | TypeScript and production build passed. Browser behavior is listed below for review. |
| 6. Phone layout | Passed | TypeScript/build passed; built CSS has no fixed `.page` width above 320px. Actual interactive selectors were checked against the source. |
| 7. Lazy loading and chunks | Passed | All chunks below 500 KiB; 511 app tests and TypeScript passed. |
| 8. Shared personalized forecast | Passed | Missing-module test failed first; 2 focused tests, all 513 app tests and TypeScript passed. The two-start fixture yields August 26, 2026, with 7 days of uncertainty. |
| 9. ICS builder | Passed | Missing-module test failed first; 8 builder tests and TypeScript passed, including invalid dates, UTF-8 folding and year rollover. |
| 10. Forecast and reminder mappings | Passed | Missing-module tests failed first; all 26 calendar tests and TypeScript passed, including the CRLF golden file. |
| 11. Calendar export and UI | Passed | Missing-module test failed first; all 550 app tests, TypeScript, production build and chunk checks passed. Cancellation, MIME, fallback, privacy and no-network tests passed. |
| 12. Final sweep | Passed | All final root commands below passed; rename, historical-file preservation, built manifest, splash links and golden-file bytes were checked. |

## Final commands

All commands exited with status 0. TypeScript emitted no output.

| Command from repository root | Final result |
| --- | --- |
| `pnpm --filter @ppp/app test` | `Test Files 56 passed (56)`; `Tests 550 passed (550)` |
| `cd app && npx tsc --noEmit` | No output; exit 0. |
| `cd app && npx vite build && node scripts/check-chunks.mjs` | Production PWA generated; `all chunks under 500 kB`. |
| `cd workers/records-relay && pnpm test` | `Test Files 1 passed (1)`; `Tests 46 passed (46)` |
| `cd workers/backup && pnpm test` | `Test Files 1 passed (1)`; `Tests 5 passed (5)` |
| `cd workers/reminders && pnpm test` | `Test Files 1 passed (1)`; `Tests 22 passed (22)` |

The seeded estimate audit remains passing. The largest emitted JavaScript chunk
is about 306 KiB, below the script's 500 × 1024-byte limit.

The rename sweep found only attribution and its upstream URL, legacy-import
handling and tests, the guard's own expressions, historical documents and
explicitly labelled historical links. No files under `docs/superpowers` changed.
The seven historical audit documents have exactly the required note prepended;
`docs/finchnode/README.md` has only the instructed browser-name replacement.

## Decisions and deviations

- Task 1 also renamed worker package/configuration/README files because its guard
  scans all worker files. Leaving those changes until Task 2 would fail Task 1.
- The backup Worker initially had no tests, so its required command failed.
  Added five tests for opaque storage, rejected uploads and deletion without
  changing its implementation.
- The offline store has no Node type package. Added minimal declarations for
  filesystem/path operations used by tests. The ICS byte-count test uses
  `TextEncoder` instead of `Buffer`, preserving the intended UTF-8 assertion.
  Offline installs used the dependency tree's existing store location.
- Imported `mobile.css` in Task 5 so the install card was styled immediately.
  Task 6 then extended that stylesheet. Date hit-area rules target buttons,
  leaving calendar legend swatches alone.
- The entry chunk was 531 KiB after lazy loading, so Task 7 needed the optional
  React/ReactDOM/Dexie vendor split. Records category content is also lazy.
- Applied every plan amendment. Task 10's category-title test additionally needed
  `withReminderGlobals`, the same helper Settings uses: changing only the global
  flag leaves each plan's preview mode private. Private titles remain neutral.
- Expired recurring series are omitted instead of emitting a start after their
  recurrence end. Reminder exports also carry an epoch-minute sequence. Added
  validation for impossible dates, invalid recurrence values and nonfinite event
  metadata so invalid input cannot be partially delivered.
- Independent review found that a bare return after share cancellation still
  produced a success notice. The helper now returns a cancellation outcome and
  the export result has an optional `cancelled` flag. Existing three-argument
  calls and injected `Promise<void>` share functions remain compatible. Both
  UIs stay silent, and cancellation does not download. The scoped re-review was
  clean, and Task 11 was amended before final verification.
- Task 12 specifies no commit subject. Its commit uses the task heading,
  `Final verification and documentation sweep`.

Existing development profiles with a PIN must clear site data because the PIN
hash domain changed. A deployed records relay must be redeployed together with
the app because its authentication header changed. These rollout notes are also
in the Task 1 commit body.

## Browser checks for the reviewer

Browser use and binding a local port were unavailable in this environment; the
following checks remain manual.

1. At **320×568** and **375×812**, inspect Today, Calendar, Records, Settings and
   the log sheet for horizontal overflow. Inspect 44px hit areas on chips,
   calendar/date cells and buttons; tab items should retain their larger size.
   Check both cycle and pregnancy Today views.
2. In phone landscape, check compact tab labels, scrollable sheets and overlays,
   plus left/right safe areas. Emulate `display-mode: standalone` to check top
   padding, hidden install cards and the Settings installed message.
3. In Chromium, verify the card appears only after `beforeinstallprompt`.
   Exercise acceptance and dismissal. Verify **Not now** persists on Today for
   14 days while Settings still offers installation.
4. Emulate an iPhone UA and an iPadOS desktop UA with touch. Verify the Share
   glyph and the two Add to Home Screen instructions. Desktop Safari/Firefox
   without an install event should show no install offer.
5. On a real iOS device, add PPP to the home screen and inspect title, icon,
   launch splash and full-screen presentation. After one successful load,
   verify the cached shell opens offline.
6. Open `/?action=log`: today's log sheet opens once. Open `/?tab=records`:
   Records is selected. Verify launch parameters are removed while unrelated
   query parameters/hash and records-return handling are preserved.
7. With no usable forecast/reminders, verify disabled Calendar buttons and their
   reasons. With two recent period starts, export from Today and Settings;
   inspect three versus six cycles, saved discreet/descriptive preferences,
   widened future period windows and suppressed fertility when ineligible.
8. Enable reminders and import both exported `.ics` files into a calendar app.
   Check all-day end dates, local timed reminders, recurrence and display alarms.
   Re-import with changed preferences/times and inspect update behavior.
9. On a phone, check the share sheet; on desktop, check `.ics` downloads. Cancel
   sharing and verify no notice or fallback download. Simulate a delivery failure
   and verify `Could not create the calendar file.` appears.
10. Inspect network activity while exporting: no calendar upload, subscription
    URL or new destination should be contacted by PPP.
