> Written when the product was named Lunara; the product is now PPP.

# Feature-depth delivery map

Updated: 2026-09-11 for the web fork.

The feature inventory below retains the earlier product-depth assessment, with
platform boundaries updated for Phase 1. Aileron, palette, and layout work
(Phase 2, Tasks 9–12), and FinchNode records, relay, and privacy work (Phase 3,
Tasks 13–23) remain planned. See the
[web capability boundary](WEB_CAPABILITY_BOUNDARY.md) and
[implementation plan](superpowers/plans/2026-09-11-lunara-web-finchnode.md).

## Target and status language

Lunara's target is an original, premium-quality reproductive-health companion
with comparable product depth. It is not a counterfeit interface and does not
claim literal Flo parity.

Status terms:

- **Verified locally** — implemented and covered by the current TypeScript
  build and/or automated tests.
- **Implemented** — meaningful end-to-end code exists, but physical-device,
  accessibility, failure-state, or release validation remains.
- **Foundation** — core types, engine, or UI exist; the full user workflow is
  incomplete.
- **Missing** — no complete implementation exists.
- **External** — completion requires a platform account, credential, service,
  licensed content, or specialist review.
- **Excluded** — intentionally outside the requested scope.
- **Removed in the web fork** — the native capability or bridge is no longer
  included; any retained browser counterpart is listed separately.

The 2026-07-26 results of 151 tests, Capacitor sync, and native debug builds are
historical, not evidence for the current web build. Current verification uses
`pnpm test` and `pnpm build` from the repository root; the estimate audit must
stay at zero violations. Browser/device behavior still needs validation beyond
automated tests.

## Adaptive setup and durable profile

| Capability | Status | Current boundary |
|---|---|---|
| Versioned local health profile | Verified locally | Schema v2 separates durable profile context from dated daily logs |
| Goal-conditioned onboarding graph | Verified locally | Cycle, TTC, pregnancy, and perimenopause choose different paths; a single primary mode is stored |
| Local-storage purpose consent | Verified locally | Onboarding records versioned local-health-storage and assistant-sharing decisions |
| Minimum-age gate | Foundation | Age 13 minimum and age bands exist; region-aware minimum age, guardian/legal policy, and age-change consequences remain |
| Cycle baseline | Verified locally | Regularity, up to three period starts, confidence, usual cycle length, and bleeding duration |
| Contraception-aware branch | Verified locally | Hormonal contexts receive a separate bleeding question and forecast suppression |
| TTC setup | Foundation | Trying-since date and fertility evidence education exist; discontinuation history, prenatal-vitamin plan, and test preferences remain |
| Pregnancy setup | Verified locally | Clinician EDD, LMP, conception, day-3/day-5 transfer, source authority, provisional status, and number of babies |
| Perimenopause setup | Foundation | Mode and relevant symptom questions exist; surgery, hormone-therapy, last-bleed, and transition-specific history remain |
| Tracker personalization | Verified locally | User chooses tracking areas; full category reordering and visibility remain editable later |
| Privacy/permission education | Foundation | Local and AI boundaries are explained; full browser notification and device-unlock denial, retry, and revocation paths are not all in onboarding; native health-import UI is removed |
| Review summary and correction | Verified locally | Summary reflects forecast eligibility and missing context; a richer purpose-by-purpose edit/review page remains useful |

This is intentionally not a five-screen funnel. Irrelevant modules are removed
by branch rules, while prediction-critical and consent-critical questions stay.

## Logging and local data

| Capability | Status | Current boundary |
|---|---|---|
| Searchable daily logger | Verified locally | Dense category sections and search support the observed tracker depth |
| Explicit complete check-in | Verified locally | Missing or partial days are not treated as symptom-free |
| Flow | Verified locally | Light, medium, heavy, and clots |
| Symptoms and ratings | Verified locally | Broad taxonomy plus optional severity and routine-impact detail |
| Mood | Verified locally | Broad mood/mental-health entry set |
| Discharge | Verified locally | None, watery, creamy, sticky, egg-white, spotting, unusual, clumpy white, and gray |
| Sexual and intimacy logs | Verified locally | Canonical multi-select model with legacy single-value compatibility |
| Pregnancy and ovulation tests | Verified locally | Typed pregnancy result plus OPK positive/negative; results remain observations |
| Digestion, activity, and lifestyle | Verified locally | Typed multi-select values |
| BBT, sleep, steps, water, weight, and notes | Verified locally | Stored as dated measurements or notes |
| Medication/contraception adherence events | Foundation | Tracker events exist; a first-class dated regimen, dose, pack/change schedule, and history model is still missing |
| Tracker visibility/reordering | Verified locally | Stored locally |
| Edit/delete history and provenance | Foundation | Current value editing works; audit history and source provenance are incomplete |
| Local import/export | Verified locally | Plain and passphrase-encrypted daily logs, filtered settings, and content bookmarks; canonical profile/regimen/adherence and medical-record transfers are planned for Task 18 |
| Local wipe | Verified locally | Settings can clear device data |
| Encrypted core database at rest | Missing | Existing logs and profiles remain plaintext in browser Dexie/IndexedDB; vault secrets are sealed separately, and sealed medical-record bodies are planned for Phase 3 |
| Zero-knowledge backup relay | Foundation | Client encryption and opaque blob relay exist; recovery UX, production abuse controls, and deployment are not release-ready |

## Forecasts and safety policy

| Capability | Status | Current boundary |
|---|---|---|
| Robust cycle forecast | Verified locally | Recent median, bounded data-quality exclusions, history-derived uncertainty, and explicit methodology |
| Period range | Verified locally | Point date is accompanied by an estimated window |
| Calendar ovulation/fertile range | Verified locally | Informational estimate only; never a safe-day or contraceptive claim |
| OPK evidence | Verified locally | Positive OPK is described as suggestive, not confirmation |
| BBT-shift evidence | Verified locally | Sustained shift is retrospective support; sparse-data thresholds need clinical hardening |
| Prediction policy layer | Verified locally | Pregnancy suppresses cycle forecasts; hormonal contraception suppresses fertility forecasts; irregular/PCOS/peri context widens uncertainty |
| “Why this estimate” explanation | Verified locally | Today exposes source, range, evidence, exclusions, and reasons |
| Pregnancy dating engine | Verified locally | Preserves input method and clinician/art/user authority; calculated dates are provisional |
| Deterministic safety rules | Verified locally | Explicit bleeding, pregnancy/pelvic-pain, postmenopausal-bleeding, and self-harm combinations produce sourced care levels |
| Safety workflow integration | Foundation | Engine is tested; not every logger, report, article, and assistant entry point invokes it |
| Pregnancy-chance probability | Not implemented by design | Lunara uses qualitative timing; it does not fabricate a numeric probability |
| Future symptom forecast | Missing | No validated prospective symptom model |
| Diagnosis or contraceptive mode | Excluded | Lunara is not a medical device and predictions must not be used to prevent pregnancy |

## Today, calendar, and goal modes

| Capability | Status | Current boundary |
|---|---|---|
| Today phase renderer | Verified locally | Empty-history, period, follicular/fertile/ovulatory, luteal/late, suppressed, and pregnancy states |
| Date strip and quick actions | Verified locally | Date-aware logging shortcuts and insight cards |
| Calendar | Verified locally | Month/year navigation, period editing, logged and estimated markers |
| Cycle mode | Verified locally | Period/cycle-day/ovulation/fertile/late states with uncertainty |
| TTC mode | Foundation | Fertile range, OPK/BBT context, timing guidance, test plan, and detail screen; full prospective protocol and reminders remain |
| Pregnancy mode | Foundation | Source-aware gestational timeline, Today/detail surfaces, original weekly content, checklist, FAQs, and warning copy; appointments, tests, postpartum/loss flows, and clinical review remain |
| Perimenopause mode | Foundation | Original non-diagnostic burden snapshot, symptom domains, trend windows, observations, and relief notebook; stage inference is deliberately absent |
| Historical mode/regimen eras | Foundation | Analytics exposes an annotation hook; dated contraception, pregnancy, postpartum, and treatment histories are not yet captured |
| True menopause-stage diagnosis | Excluded | No public screen can justify reproducing a proprietary score or diagnosing stage |

## Trends, reports, and clinician handoff

| Capability | Status | Current boundary |
|---|---|---|
| Six- and twelve-cycle statistics | Verified locally | Separate bounded windows with sample size, median/average, range, and descriptive slope |
| Bleeding trend | Verified locally | Consecutive logged-flow dates form episodes; missing days are not filled |
| Tracking completeness | Verified locally | Any-entry and explicit-complete-check-in coverage are reported separately |
| Symptom-by-phase summary | Verified locally | Complete check-ins only; association is not presented as cause |
| Pattern cards | Verified locally | Deterministic phase, day-cluster, and co-occurrence rules with evidence and minimum thresholds |
| BBT/OPK observation series | Verified locally | Plotting series only; no exact ovulation confirmation |
| Cycle report UI | Verified locally | Methodology, data sufficiency, patterns, bleeding, phase summaries, and fertility observations |
| Doctor summary | Implemented | Print/save-as-PDF view, methodology, data range, and opt-in sensitive sections |
| Native PDF/share bridge | Removed in the web fork | Native document-generation and sharesheet integration is not included |
| Browser report and file sharing | Implemented | Reports use browser print/save-as-PDF; JSON file export uses Web Share where supported with a download fallback |
| Imported-source provenance/conflict UI | Missing | Pure health-import helpers retain source fields; native health access is removed and FinchNode record workflows are planned for Phase 3 |

## Reminders and platform

| Capability | Status | Current boundary |
|---|---|---|
| Reminder-plan engine | Verified locally | Once, dates, daily, weekdays, interval, and monthly recurrence; IANA time zones, DST handling, quiet hours, snooze/completion, and bounded materialization |
| Reminder kinds | Verified locally | Cycle, period, pregnancy, BBT/OPK/tests, medication, contraception, prenatal vitamin, water, sleep, weight, movement, and journaling |
| Privacy-safe notification copy | Verified locally | Private and broad-category preview modes exclude results, fertility status, medication names, and pregnancy detail |
| Native notification adapter | Removed in the web fork | Native scheduling and native notification action callbacks are removed |
| Browser in-session reminders | Implemented | Notifications API delivery needs permission and an open Lunara tab; suspension can delay delivery and closing all tabs stops it; completion/snooze action callbacks are not wired |
| Reminder settings and persistence | Implemented | Presets, per-plan enable/time controls, quiet hours, preview privacy, local migration/persistence, and permission requests remain; the browser scheduler restores and refreshes saved plans |
| Capacitor iOS and Android shells | Removed in the web fork | Native projects and native build scripts are removed |
| Browser PWA shell | Implemented | Production assets are precached for offline use after the initial load and service-worker installation; network API traffic is not runtime-cached |
| Keychain/Keystore vault | Removed in the web fork | Native secret-store bridges are removed |
| Browser WebCrypto vault | Implemented | Secrets are sealed in IndexedDB with a non-extractable browser-managed key; no hardware-backed claim, and same-origin code can read them |
| Native biometric bridge | Removed in the web fork | Native Face ID/Touch ID and Android authentication bridges are removed |
| PIN and WebAuthn device unlock | Implemented | PIN remains a local screen gate; device unlock requires a PIN, enrollment, and browser/platform support; neither gate protects the vault key cryptographically |
| HealthKit/Health Connect import | Removed in the web fork | Native permission/import bridges and UI are removed; pure import helpers remain for future file-based workflows |
| iOS/Android widgets | Removed in the web fork | Native widget extensions and snapshot publishing are removed |
| Native store distribution | Removed in the web fork | App Store/Play signing and native release workflows are outside this browser fork |
| Static web deployment | Implemented | Build app/dist and serve over HTTPS; configure response headers on the host and validate supported browser behavior |

## Content and assistant

| Capability | Status | Current boundary |
|---|---|---|
| Searchable local articles | Verified locally | Small original offline library with bookmarks |
| Original pregnancy/TTC/peri guides | Foundation | Useful local content exists; it is not a comprehensive reviewed corpus |
| Audio, video, and courses | Missing | Requires original or licensed media, transcripts, accessibility, and editorial review |
| OpenAI assistant | Implemented | BYO project key, official API transport, `store: false`, and explicit context-category toggles; requires network, billing, and provider access |
| Anthropic assistant | Implemented | BYO API key or claude setup-token credential path, selected tracker context, and browser transport; provider access and CORS rules apply |
| Ollama assistant | Missing | No dedicated Ollama provider/UI exists; transport code accepts a custom OpenAI Responses-compatible base URL, but Ollama compatibility is not established and exact-origin CSP permission plus browser CORS are required |
| Secret storage for API keys | Implemented | Browser vault seals keys in IndexedDB; saved credentials are excluded from exports and backups; PIN/device unlock only gate the screen |
| Urgent-message interception | Foundation | Deterministic safety interception exists; comprehensive clinical evaluation and localized crisis handling remain external |
| Reviewed retrieval corpus and eval program | Missing / External | Requires editorial versioning, clinician governance, red-team cases, monitoring, and incident response |

## Deliberately excluded

The requested scope includes the AI assistant and excludes:

- Community / Secret Chats
- Partner sharing or synchronization
- Symptom Checker
- Guided Journey

These are not backlog omissions. A limited warning-sign safety router is still
required because any health app needs a safe response to explicitly reported
urgent symptoms; it does not diagnose a condition or reproduce a Symptom
Checker.

## Historical native release blockers

The list below is preserved from the 2026-07-26 native-app assessment. Its
native SQLite, notification-action, health-import, device-build, and store
requirements are not the current web roadmap. Current work follows the
[web design spec](superpowers/specs/2026-09-10-lunara-web-finchnode-design.md)
and implementation plan linked above; the clinical, accessibility, and privacy
review concerns remain relevant.

1. Migrate core health data from Dexie/WebView storage to encrypted native
   SQLite with versioned migration and rollback tests.
2. Complete first-class contraception/medication regimen history and persist
   native notification action completion/snooze across lifecycle restarts.
3. Wire safety evaluation consistently through logger, pregnancy, reports, and
   assistant entry points.
4. Finish health-import provenance, deduplication, conflict, revocation, and
   deletion behavior.
5. Validate notifications, biometrics, HealthKit, Health Connect, widgets,
   lifecycle, offline launch, and networking on physical iOS and Android
   devices.
6. Conduct clinical/editorial review of fertility, pregnancy, bleeding,
   perimenopause, and assistant content.
7. Complete accessibility, localization, privacy/legal, security, and data-loss
   audits.
8. Add signed release builds, store declarations, and App Store/Play review.
