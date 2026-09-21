# PPP Rename, Mobile Install, and Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the product to PPP everywhere, make the PWA feel native when added to a phone's home screen, and let users export cycle forecasts and reminders to their own calendar as `.ics` files.

**Architecture:** The rename is mechanical but total, guarded by a grep test. Mobile work adds manifest/meta polish, an install-state module with a Today card, touch/layout CSS, and lazy-loaded heavy screens. Calendar export is a pure `.ics` builder fed by the same personalized forecast Today uses (extracted into a shared module) and by the existing reminder plans, delivered through the existing share-or-download helper.

**Tech Stack:** React 18, Vite 6, TypeScript 5.9, Dexie 4, vitest 2, vite-plugin-pwa 1.3, sharp (splash generation, dev only).

**Spec:** `docs/superpowers/specs/2026-09-11-ppp-rename-mobile-calendar-design.md`

## Global Constraints

- Branch `feat/web-app-finchnode`; baseline is commit 8b8088e with 498 app tests and 46 relay tests passing, `tsc --noEmit` and `vite build` clean. Never regress these.
- Commit through the writable scratch clone (`git --git-dir=/tmp/lunara-phase1-commits/.git --work-tree="$PWD" …`) with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; one commit per task.
- "Lunara" may remain only in: the attribution sentence ("based on Lunara"), the upstream URL, the legacy import literal `'lunara'` in `db/transfer.ts` and `db/transferValidation.ts`, `docs/finchnode/README.md`, and everything under `docs/superpowers/`. Historical docs get the one-line note from spec A1.
- No new network destinations. The `.ics` file is generated locally and leaves only through the user's share or download action.
- Copy style: plain sentences, no exclamation marks, no medical claims. "PPP" is never expanded.
- Tests that need `window`/`navigator`/`matchMedia` use `vi.stubGlobal` and `vi.unstubAllGlobals()`.
- **The Amendments section at the end of this plan overrides any task text it names.** Read it before starting each task.

---

## File structure

```
app/index.html                         PPP title, iOS meta, apple-touch-icon, splash links
app/pwa.config.ts                      PPP names, id/scope/display_override/orientation/shortcuts
app/scripts/splash.mjs                 NEW generate public/splash/*.png from brand/ppp-splash-portrait.svg
app/scripts/check-chunks.mjs           NEW fail if any dist/assets/*.js exceeds 500 kB
app/public/splash/                     NEW six PNGs (committed)
app/src/rename.test.ts                 NEW grep guard
app/src/platform/install.ts            NEW install state (installed | prompt | ios-instructions | unsupported)
app/src/components/InstallCard.tsx     NEW Today card + Settings row body
app/src/styles/mobile.css              NEW touch targets, safe areas, standalone tweaks, landscape
app/src/lib/personalizedForecast.ts    NEW computePersonalizedForecast(date) extracted from Today
app/src/calendar/ics.ts                NEW pure .ics builder
app/src/calendar/forecastEvents.ts     NEW forecast → all-day events
app/src/calendar/reminderEvents.ts     NEW reminder plans → timed events with RRULE/VALARM
app/src/calendar/export.ts             NEW exportForecastCalendar(), exportRemindersCalendar()
app/src/db/transfer.ts                 shareOrDownload(name, contents, mime)
app/src/screens/Settings.tsx           Calendar card, Home screen row, footer attribution
app/src/screens/Today.tsx              InstallCard, "Add to calendar" quick action, uses personalizedForecast
app/src/main.tsx                       ?action=log and ?tab= handling, mobile.css import
app/src/App.tsx                        React.lazy for AssistantScreen, DoctorReport, CycleReportScreen, RecordsScreen
PRIVACY.md, README.md, docs/WEB_CAPABILITY_BOUNDARY.md, workers/*/README.md   PPP + calendar + install
```

---

# Phase A: rename

### Task 1: Rename in code with a grep guard

**Files:**
- Create: `app/src/rename.test.ts`
- Modify: every file under `app/src` and `workers/*/src` that contains `lunara`/`Lunara` (85 files repo-wide; `grep -ril lunara app/src workers` lists the code ones). Rename `app/src/components/LunaraMark.tsx` → `PppMark.tsx`.

**Interfaces:**
- Produces the renamed identifiers from spec A2: `PppDB` (class in `db/schema.ts`, `new Dexie('ppp')`), `KEY_DB_NAME = 'ppp-keys'`, secrets DB `'ppp-secrets'`, lock names `'ppp-vault-lifecycle'`, `'ppp-relay-settings'`, `'ppp-v3-migration'`, tags `ppp-daily:` / `ppp-records-refresh`, header `x-ppp-relay-token` (relay Worker, `providers/relay.ts`, tests, README), WebAuthn `rp.name: 'PPP'`, `user.name: 'ppp-local'`, crypto domain strings `ppp-pin:` and `ppp-blob-id:`, export `app: 'ppp'`, file names `ppp-backup-`/`ppp-encrypted-`, component `PppMark`, CSS `.ppp-crescent`, `.ppp-brand-button`, SVG ids `ppp-*`.
- `db/transfer.ts` `validatePayload` accepts `p.app === 'lunara' || p.app === 'ppp'` and `collectExport` writes `'ppp'`.
- `engine/reminders.ts` `copyFor` becomes `export function copyFor` with titles "PPP" / "PPP reminder".

- [ ] **Step 1: Write the failing guard test**

```ts
// app/src/rename.test.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [resolve(__dirname), resolve(__dirname, '../../workers')]
const SKIP = /node_modules|dist|\.wrangler|__fixtures__/
const ALLOWED = [/based on Lunara/, /app === 'lunara'/, /'lunara'\s*\|\|/, /github\.com\/Blueturboguy07\/lunara/, /rename\.test\.ts/]

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (SKIP.test(full)) continue
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx|js|css|json|toml|md|html|svg)$/.test(name)) yield full
  }
}

describe('rename guard', () => {
  it('leaves no product mention of Lunara outside the allowed attribution lines', () => {
    const offenders: string[] = []
    for (const root of ROOTS) for (const file of walk(root)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/lunara/i.test(line) && !ALLOWED.some((re) => re.test(line))) offenders.push(`${file.replace(resolve(__dirname, '../..') + '/', '')}:${i + 1}: ${line.trim().slice(0, 100)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see the current offenders**

Run: `cd app && npx vitest run src/rename.test.ts`
Expected: FAIL with a long offender list. Keep the list as the checklist.

- [ ] **Step 3: Rename**

Apply, in this order, checking each with `grep -rn`:
1. `git mv app/src/components/LunaraMark.tsx app/src/components/PppMark.tsx`; rename the export and every import.
2. Identifiers from the Interfaces list (exact strings; keep the `ppp-` prefix lowercase, `PppDB`/`PppMark` PascalCase).
3. User-facing strings: `Lunara` → `PPP` in JSX, aria labels, notification copy (`copyFor`, `scheduleDailyReminder` title), `StartupErrorBoundary`, onboarding, assistant ("PPP AI"), settings footer (spec A2 sentence), article content in `content/articles.ts` (product mentions only; keep article facts).
4. Comments and JSDoc: same replacement.
5. Tests: update expected strings/tags (`ppp-daily:`, header names, DB names, `app: 'ppp'`), and add one test in `db/transfer.test.ts` that a v1 payload with `app: 'lunara'` still imports.
6. Worker sources and their tests: `workers/backup/src`, `workers/reminders/src`, `workers/records-relay/src` (header `x-ppp-relay-token`, error copy, comments).

- [ ] **Step 4: Verify**

Run: `cd app && npx vitest run && npx tsc --noEmit && (cd ../workers/records-relay && pnpm test) && (cd ../workers/backup && pnpm test) && (cd ../workers/reminders && pnpm test)`
Expected: rename guard passes; all suites pass. `grep -rn "x-lunara\|lunara-keys\|LunaraDB\|LunaraMark" app/src workers` is empty.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename the product to PPP across application and worker code"
```

### Task 2: Rename packages, workers, brand files, and docs

**Files:**
- Modify: `package.json` (root `name: "ppp"`), `app/package.json` (`@ppp/app`), `workers/*/package.json` (`@ppp/backup-worker`, `@ppp/reminders-worker`, `@ppp/records-relay-worker`), `workers/*/wrangler.toml` (`ppp-backup`, `ppp-reminders`, `ppp-records-relay`, bucket `ppp-backups`, `ALLOWED_ORIGINS` comments), root `package.json` scripts (`--filter @ppp/app`), `app/index.html` (`<title>PPP</title>`), `app/pwa.config.ts` (`name`/`short_name` "PPP", description "Private cycle, fertility, pregnancy and perimenopause companion. Your data stays in your browser."), `README.md`, `PRIVACY.md`, `docs/WEB_CAPABILITY_BOUNDARY.md`, `workers/*/README.md`, `docs/finchnode/README.md` (only "Lunara's browser" → "PPP's browser"), `.claude/launch.json` (names `ppp-preview`, `ppp-dev`, filters).
- Rename: `app/brand/lunara-*.svg` → `app/brand/ppp-*.svg` (and any SVG-internal ids `lunara-*` → `ppp-*`).
- Historical docs: prepend the note line to `docs/RESEARCH.md`, `docs/BEYOND_SCREEN_GAP_AUDIT.md`, `docs/SCREENSHOT_ONBOARDING_AUDIT.md`, `docs/FLO_SCREEN_CATALOG.md`, `docs/CURRENT_PROGRESS_AND_ROADMAP.md`, `docs/FEATURE_PARITY.md`, `docs/ADAPTIVE_ONBOARDING_ARCHITECTURE.md`:
  `> Written when the product was named Lunara; the product is now PPP.`

- [ ] **Step 1: Apply the renames**

README opening becomes: "# PPP" + "PPP is a privacy-first cycle, fertility, pregnancy and perimenopause companion that runs entirely in your browser. It is based on Lunara (AGPL-3.0, https://github.com/Blueturboguy07/lunara) and is not affiliated with Flo Health Inc." Keep the rest of the README structure, replacing product mentions.

- [ ] **Step 2: Reinstall and verify**

Run from the repo root: `pnpm install --offline` (workspace names changed), then `pnpm --filter @ppp/app test && (cd app && npx tsc --noEmit && npx vite build)`; `grep -rli lunara --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | grep -v "docs/superpowers\|docs/finchnode"` lists only files whose remaining mentions are the attribution sentence, the upstream URL, or the historical-note line (check each with `grep -n`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Rename packages, workers, brand assets and documentation to PPP"
```

# Phase B: mobile-first install

### Task 3: Manifest, iOS meta, splash screens, and launch parameters

**Files:**
- Modify: `app/pwa.config.ts`, `app/pwa.config.test.ts`, `app/index.html`, `app/package.json` (scripts `splash`, devDependency `sharp` if not resolvable), `app/src/main.tsx`, `app/src/state/appStore.ts`
- Create: `app/scripts/splash.mjs`, `app/public/splash/*.png` (generated, committed)

**Interfaces:**
- `pwaOptions.manifest` gains: `id: '/'`, `scope: '/'`, `display_override: ['standalone', 'minimal-ui']`, `orientation: 'portrait'`, `lang: 'en'`, `categories: ['health', 'lifestyle']`, `prefer_related_applications: false`, `shortcuts: [{ name: 'Log today', short_name: 'Log', url: '/?action=log', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] }, { name: 'Records', short_name: 'Records', url: '/?tab=records', icons: [...] }]`, and `includeAssets` adds `'splash/*.png'`.
- `appStore` gains `launchAction: 'log' | null` and `setLaunchAction`; `main.tsx` reads `action=log` and `tab=<today|insights|graphs|records|settings>` from the query (before stripping it with `history.replaceState`), calls `setTab` / `setLaunchAction`. `Today` opens today's log sheet once when `launchAction === 'log'` and then clears it.

- [ ] **Step 1: Extend the manifest test**

Add to `app/pwa.config.test.ts`:

```ts
it('is installable with an id, scope, portrait standalone display and two shortcuts', () => {
  expect(pwaOptions.manifest).toMatchObject({ id: '/', scope: '/', display: 'standalone', orientation: 'portrait', name: 'PPP', short_name: 'PPP' })
  expect(pwaOptions.manifest?.display_override?.[0]).toBe('standalone')
  expect(pwaOptions.manifest?.shortcuts?.map((s) => s.url)).toEqual(['/?action=log', '/?tab=records'])
})
```

- [ ] **Step 2: Implement manifest and meta**

`index.html` head, after the viewport meta:

```html
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="PPP" />
<meta name="format-detection" content="telephone=no" />
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
<link rel="apple-touch-startup-image" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/iphone-se.png" />
<link rel="apple-touch-startup-image" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/iphone-14.png" />
<link rel="apple-touch-startup-image" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/iphone-14-plus.png" />
<link rel="apple-touch-startup-image" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" href="/splash/iphone-14-pro-max.png" />
<link rel="apple-touch-startup-image" media="(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/ipad-10.png" />
<link rel="apple-touch-startup-image" media="(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" href="/splash/ipad-pro-11.png" />
```

- [ ] **Step 3: Splash generator**

```js
// app/scripts/splash.mjs
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import sharp from 'sharp'

const SIZES = [
  ['iphone-se', 750, 1334], ['iphone-14', 1170, 2532], ['iphone-14-plus', 1284, 2778],
  ['iphone-14-pro-max', 1290, 2796], ['ipad-10', 1620, 2160], ['ipad-pro-11', 1668, 2388],
]
const svg = readFileSync(resolve('brand/ppp-splash-portrait.svg'))
mkdirSync(resolve('public/splash'), { recursive: true })
for (const [name, w, h] of SIZES) {
  await sharp(svg, { density: 300 }).resize(w, h, { fit: 'cover', background: '#FFF7F8' }).png({ compressionLevel: 9 }).toFile(resolve(`public/splash/${name}.png`))
  console.log(`splash ${name} ${w}x${h}`)
}
```

If `import sharp` fails to resolve, run `pnpm add -D sharp --offline` in `app/` (the store already has 0.33.5). Add `"splash": "node scripts/splash.mjs"` to `app/package.json`, run it once, and commit the six PNGs (target under 200 kB each; raise `compressionLevel` or lower density if larger).

- [ ] **Step 4: Launch parameters**

In `main.tsx`, next to the records-return handling:

```ts
const params = new URLSearchParams(window.location.search)
const tab = params.get('tab'); const action = params.get('action')
if (tab || action) {
  if (tab && ['today', 'insights', 'graphs', 'records', 'settings'].includes(tab)) useApp.getState().setTab(tab as Tab)
  if (action === 'log') useApp.getState().setLaunchAction('log')
  params.delete('tab'); params.delete('action')
  history.replaceState(null, '', window.location.pathname + (params.size ? `?${params}` : '') + window.location.hash)
}
```

Add `launchAction`/`setLaunchAction` to the store and a `useEffect` in `Today` that calls `openSheet(localToday())` once when `launchAction === 'log'`, then `setLaunchAction(null)`.

- [ ] **Step 5: Verify**

Run: `cd app && npx vitest run pwa.config.test.ts && npx tsc --noEmit && npx vite build && ls public/splash | wc -l` → 6 files; `grep -c apple-touch-startup-image dist/index.html` → 6.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Make PPP installable: manifest identity, iOS meta and splash screens, launch shortcuts"
```

### Task 4: Install state module

**Files:**
- Create: `app/src/platform/install.ts`
- Test: `app/src/platform/install.test.ts`
- Modify: `app/src/db/schema.ts` (`SK.installCardDismissedAt: 'installCardDismissedAt'`)

**Interfaces:**

```ts
export type InstallMode = 'installed' | 'prompt' | 'ios-instructions' | 'unsupported'
export interface InstallState { mode: InstallMode; prompt?: () => Promise<'accepted' | 'dismissed'> }
export function detectInstallMode(env: { standaloneMedia: boolean; navigatorStandalone: boolean; userAgent: string; maxTouchPoints: number; hasPromptEvent: boolean }): InstallMode
export function getInstallState(): InstallState
export function subscribeInstallState(listener: (state: InstallState) => void): () => void
export function startInstallListener(): void            // called from initializeRuntime(); captures beforeinstallprompt (preventDefault) and appinstalled
export function isDismissalActive(dismissedAt: string | undefined, now: Date, days = 14): boolean
```

`detectInstallMode` order: installed (standaloneMedia || navigatorStandalone) → prompt (hasPromptEvent) → ios-instructions (`/iPhone|iPad|iPod/.test(ua)` or (`/Macintosh/.test(ua)` && maxTouchPoints > 1)) → unsupported.

- [ ] **Step 1: Write the failing test**

```ts
// app/src/platform/install.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectInstallMode, getInstallState, isDismissalActive, startInstallListener, subscribeInstallState } from './install'

const base = { standaloneMedia: false, navigatorStandalone: false, userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/120', maxTouchPoints: 0, hasPromptEvent: false }

describe('detectInstallMode', () => {
  it.each([
    ['installed via display-mode', { ...base, standaloneMedia: true }, 'installed'],
    ['installed via navigator.standalone', { ...base, navigatorStandalone: true, userAgent: 'iPhone' }, 'installed'],
    ['prompt when the browser offered one', { ...base, hasPromptEvent: true }, 'prompt'],
    ['iOS Safari instructions', { ...base, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari' }, 'ios-instructions'],
    ['iPadOS desktop UA with touch', { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 5 }, 'ios-instructions'],
    ['desktop Safari unsupported', { ...base, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari', maxTouchPoints: 0 }, 'unsupported'],
  ])('%s', (_, env, mode) => { expect(detectInstallMode(env)).toBe(mode) })
})

describe('install listener', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('captures beforeinstallprompt and exposes a prompt that resolves the user choice', async () => {
    const listeners: Record<string, (e: any) => void> = {}
    vi.stubGlobal('window', { addEventListener: (n: string, f: any) => { listeners[n] = f }, matchMedia: () => ({ matches: false, addEventListener() {} }) })
    vi.stubGlobal('navigator', { userAgent: 'Chrome', maxTouchPoints: 0 })
    startInstallListener()
    const seen: string[] = []
    const stop = subscribeInstallState((s) => seen.push(s.mode))
    const event = { preventDefault: vi.fn(), prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'accepted' }) }
    listeners.beforeinstallprompt(event)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(getInstallState().mode).toBe('prompt')
    expect(await getInstallState().prompt!()).toBe('accepted')
    listeners.appinstalled({})
    expect(getInstallState().mode).toBe('installed')
    expect(seen).toEqual(['prompt', 'installed'])
    stop()
  })
})

describe('isDismissalActive', () => {
  it('hides the card for 14 days after dismissal', () => {
    const now = new Date('2026-09-11T00:00:00Z')
    expect(isDismissalActive(undefined, now)).toBe(false)
    expect(isDismissalActive('2026-09-01T00:00:00Z', now)).toBe(true)
    expect(isDismissalActive('2026-08-01T00:00:00Z', now)).toBe(false)
    expect(isDismissalActive('not a date', now)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement `install.ts`, run to verify it passes**

Run: `cd app && npx vitest run src/platform/install.test.ts` → 9 passed. Wire `startInstallListener()` into `initializeRuntime()` (guard `typeof window !== 'undefined'`).

- [ ] **Step 3: Commit**

```bash
git add app/src/platform/install.ts app/src/platform/install.test.ts app/src/platform/runtime.ts app/src/db/schema.ts
git commit -m "Detect home-screen install state and capture the install prompt"
```

### Task 5: Install card on Today and Settings

**Files:**
- Create: `app/src/components/InstallCard.tsx`
- Modify: `app/src/screens/Today.tsx`, `app/src/screens/Settings.tsx`, `app/src/styles/mobile.css` (created in Task 6; create it here with the card rules if Task 6 has not run)

**Interfaces:**
- `InstallCard({ variant: 'today' | 'settings' })`: subscribes to install state; returns `null` when mode is `installed` or `unsupported`, or (today variant) while `isDismissalActive(getSetting(SK.installCardDismissedAt))`. Copy: title "Add PPP to your home screen"; body "Opens full screen, works offline, and keeps everything on this phone."; prompt mode → button "Add to home screen" (calls `prompt()`); iOS mode → ordered steps "1. Tap the Share button" (with the iOS share glyph as inline SVG) "2. Choose Add to Home Screen"; today variant has a "Not now" link that writes `SK.installCardDismissedAt = new Date().toISOString()`.
- Today renders `<InstallCard variant="today" />` between the quick actions and the daily insights. Settings adds a "Home screen" section with `<InstallCard variant="settings" />`, and when installed shows "Installed on this device."

- [ ] **Step 1: Implement**

- [ ] **Step 2: Verify**

Run: `cd app && npx tsc --noEmit && npx vite build`. In the browser (reviewer): the card appears on desktop Chrome only after a `beforeinstallprompt`; emulate iOS UA to see the instructions; `display-mode: standalone` emulation hides it.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add the home-screen install card to Today and Settings"
```

### Task 6: Touch targets, safe areas, standalone and landscape rules

**Files:**
- Create: `app/src/styles/mobile.css` (imported in `main.tsx` after `records.css`, before `desktop.css`)
- Modify: `app/src/styles/base.css` (global rules), `app/src/styles/app.css` only where a selector needs a larger hit area

- [ ] **Step 1: Global rules in `base.css`**

```css
html { -webkit-text-size-adjust: 100%; }
#root { min-height: 100dvh; }
button, [role='button'], a, .chip, .tabbar-item, .quick-action, .cal-day, .date-cell, .pin-key { touch-action: manipulation; }
input, select, textarea { font-size: max(16px, 1em); }
```

- [ ] **Step 2: `mobile.css`**

```css
/* Hit areas: 44px minimum on the controls people tap most. */
.tabbar-item { min-height: 48px; }
.chip, .quick-action-circle, .pin-key, .icon-button, .calendar-toolbar button { min-width: 44px; min-height: 44px; }
.cal-day, .date-cell { position: relative; }
.cal-day::before, .date-cell::before { content: ''; position: absolute; inset: -6px; }

/* Safe areas for floating surfaces. */
.overlay, .sheet, .health-overlay { padding-left: max(16px, env(safe-area-inset-left)); padding-right: max(16px, env(safe-area-inset-right)); }
.install-card { margin: 0 16px 16px; padding: 16px; border-radius: var(--radius-card); background: var(--card); box-shadow: var(--shadow-card); }
.install-card ol { padding-left: 20px; margin: 8px 0 0; }
.install-card .cta { margin-top: 12px; }

/* Installed to the home screen: the status bar overlaps the top edge. */
@media (display-mode: standalone) {
  main { padding-top: max(var(--safe-top), 12px); }
  .install-card { display: none; }
}

/* Landscape phones: keep the tab bar small and sheets scrollable. */
@media screen and (max-height: 500px) and (orientation: landscape) {
  .tabbar { padding-top: 2px; padding-bottom: calc(var(--safe-bottom) + 2px); }
  .tabbar-label { display: none; }
  .sheet, .overlay { max-height: 100dvh; }
}

/* Narrow phones (320px): never scroll sideways. */
@media (max-width: 340px) {
  .page { padding-left: 12px; padding-right: 12px; }
  .today-quick-actions { gap: 8px; }
  .quick-action-circle { width: 56px; height: 56px; }
}
```

Adjust selectors to the real ones in `app.css` (verify each exists; where the visual element differs, target the element that receives the click).

- [ ] **Step 3: Verify**

Run: `cd app && npx tsc --noEmit && npx vite build`. Reviewer: at 320×568 and 375×812 no horizontal scrollbar on Today, Calendar, Records, Settings, and the log sheet; tab items are at least 44px tall (inspect computed height).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Tune touch targets, safe areas, standalone and landscape layouts for phones"
```

### Task 7: Lazy-load heavy screens and cap chunk size

**Files:**
- Create: `app/scripts/check-chunks.mjs`
- Modify: `app/src/App.tsx`, `app/vite.config.ts` (optional `build.rollupOptions.output.manualChunks` for `react`/`react-dom`/`dexie` as `vendor`), `app/package.json` (`"check:chunks": "node scripts/check-chunks.mjs"`)

- [ ] **Step 1: Script**

```js
// app/scripts/check-chunks.mjs
import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
const LIMIT = 500 * 1024
const dir = resolve('dist/assets')
const big = readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => [f, statSync(resolve(dir, f)).size]).filter(([, s]) => s > LIMIT)
if (big.length) { console.error('Chunks over 500 kB:', big.map(([f, s]) => `${f} ${(s / 1024).toFixed(0)} kB`).join(', ')); process.exit(1) }
console.log('all chunks under 500 kB')
```

- [ ] **Step 2: Lazy-load**

In `App.tsx`: `const AssistantScreen = lazy(() => import('./components/AssistantScreen').then((m) => ({ default: m.AssistantScreen })))` and the same for `DoctorReport`, `CycleReportScreen` (from `./screens/healthFeatures` if it re-exports; otherwise import its source file directly), and `RecordsScreen`; wrap each render in `<Suspense fallback={<div className="page page-loading" role="status" aria-label="Loading" />}>`. Confirm `@anthropic-ai/sdk` is imported only from modules reachable through `AssistantScreen`/`lib/assistant.ts` (`grep -rn "@anthropic-ai/sdk" app/src`); if `Settings.tsx` imports `lib/assistant.ts` statically, move the SDK-touching functions behind a dynamic import inside that module.

- [ ] **Step 3: Verify**

Run: `cd app && npx vite build && node scripts/check-chunks.mjs` → "all chunks under 500 kB" (if not, add the `manualChunks` vendor split and re-check). `npx vitest run` still green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Lazy-load heavy screens and enforce a 500 kB chunk limit"
```

# Phase C: add to calendar

### Task 8: Extract the personalized forecast

**Files:**
- Create: `app/src/lib/personalizedForecast.ts`
- Test: `app/src/lib/personalizedForecast.test.ts`
- Modify: `app/src/screens/Today.tsx` (use the helper; behaviour unchanged)

**Interfaces:**

```ts
export interface PersonalizedForecastResult {
  prediction: Prediction
  predictionContext: PersonalizedPrediction
  forecastDiagnostics: CycleForecastDiagnostics
  profile: HealthProfile
}
/** Exactly what Today computes for a selected date: period starts and BBT estimates up to that date, recent OPKs, profile context. */
export async function computePersonalizedForecast(date: ISODate): Promise<PersonalizedForecastResult>
```

Move the `buildCycleForecast` + `applyPredictionContext` portion of Today's live query into this function (Today keeps pregnancy dating, patterns, and the selected log in place and calls the helper for the forecast part).

- [ ] **Step 1: Write the failing test**

```ts
// app/src/lib/personalizedForecast.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, putHealthProfile } from '../db/schema'
import { computePersonalizedForecast } from './personalizedForecast'

describe('computePersonalizedForecast', () => {
  beforeEach(async () => { for (const t of db.tables) await t.clear() })

  it('returns an insufficient-data forecast with no history', async () => {
    const r = await computePersonalizedForecast('2026-09-11')
    expect(r.prediction.source).toBe('insufficient-data')
    expect(r.predictionContext.eligibility.periodForecast).toBe(false)
  })

  it('forecasts from two period starts and suppresses fertility on hormonal contraception', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    const r = await computePersonalizedForecast('2026-08-10')
    expect(r.prediction.nextPeriodStart).toBe('2026-08-26')
    expect(r.predictionContext.eligibility.periodForecast).toBe(true)
    await putHealthProfile({ reproductive: { contraception: 'combined-pill-patch-ring' } })
    const s = await computePersonalizedForecast('2026-08-10')
    expect(s.predictionContext.eligibility.fertileWindow).toBe(false)
  })
})
```

(If the engine's two-cycle forecast lands on a neighbouring date, assert with the value the engine returns after inspecting `buildCycleForecast`; do not change engine math.)

- [ ] **Step 2: Run to verify it fails, implement, refactor Today, run to verify it passes**

Run: `cd app && npx vitest run src/lib/personalizedForecast.test.ts && npx tsc --noEmit && npx vitest run` → all green, estimate audit unchanged.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Extract the personalized forecast so Today and calendar export share it"
```

### Task 9: ICS builder

**Files:**
- Create: `app/src/calendar/ics.ts`
- Test: `app/src/calendar/ics.test.ts`

**Interfaces:**

```ts
export type IsoDate = string // YYYY-MM-DD
export interface IcsAllDayEvent { uid: string; summary: string; description?: string; start: IsoDate; end: IsoDate /* inclusive */; kind?: string; sequence?: number }
export interface IcsTimedEvent { uid: string; summary: string; description?: string; date: IsoDate; time: string /* HH:MM */; durationMinutes: number; rrule?: string; rdates?: { date: IsoDate; time: string }[]; alarmMinutesBefore?: number; kind?: string; sequence?: number }
export type IcsEvent = IcsAllDayEvent | IcsTimedEvent
export function buildIcs(events: IcsEvent[], opts: { calName: string; now: Date }): string
export function escapeIcsText(value: string): string
export function foldIcsLine(line: string): string
```

- [ ] **Step 1: Write the failing test**

```ts
// app/src/calendar/ics.test.ts
import { describe, expect, it } from 'vitest'
import { buildIcs, escapeIcsText, foldIcsLine } from './ics'

const now = new Date('2026-09-11T10:00:00Z')

describe('ics builder', () => {
  it('escapes commas, semicolons, backslashes and newlines', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
  })
  it('folds lines longer than 75 octets with CRLF and a leading space, counting bytes not characters', () => {
    const folded = foldIcsLine('DESCRIPTION:' + 'é'.repeat(60))
    expect(folded.split('\r\n')[0].length).toBeLessThanOrEqual(75)
    expect(Buffer.byteLength(folded.split('\r\n')[0])).toBeLessThanOrEqual(75)
    expect(folded.split('\r\n')[1]).toMatch(/^ /)
  })
  it('writes an all-day event with an exclusive DTEND and a stable UID', () => {
    const ics = buildIcs([{ uid: 'ppp-period-0@ppp.local', summary: 'PPP', start: '2026-09-20', end: '2026-09-24', kind: 'period', sequence: 7 }], { calName: 'PPP', now })
    expect(ics).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PPP//Calendar//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:PPP\r\n')
    expect(ics).toContain('UID:ppp-period-0@ppp.local\r\n')
    expect(ics).toContain('DTSTAMP:20260911T100000Z\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20260920\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20260925\r\n')
    expect(ics).toContain('SEQUENCE:7\r\n')
    expect(ics).toContain('TRANSP:TRANSPARENT\r\n')
    expect(ics).toContain('X-PPP-KIND:period\r\n')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
  it('writes a timed floating event with RRULE, RDATE and a display alarm', () => {
    const ics = buildIcs([{ uid: 'ppp-reminder-cycle@ppp.local', summary: 'PPP reminder', description: 'Check in', date: '2026-09-12', time: '20:30', durationMinutes: 15, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', rdates: [{ date: '2026-10-01', time: '20:30' }], alarmMinutesBefore: 0 }], { calName: 'PPP', now })
    expect(ics).toContain('DTSTART:20260912T203000\r\n')
    expect(ics).toContain('DTEND:20260912T204500\r\n')
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n')
    expect(ics).toContain('RDATE:20261001T203000\r\n')
    expect(ics).toContain('BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:PPP reminder\r\nTRIGGER:PT0M\r\nEND:VALARM\r\n')
    expect(ics).not.toContain('TZID')
  })
  it('rejects invalid input before producing output', () => {
    expect(() => buildIcs([{ uid: '', summary: 'x', start: '2026-09-20', end: '2026-09-20' }], { calName: 'PPP', now })).toThrow(/uid/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', start: '2026-09-21', end: '2026-09-20' }], { calName: 'PPP', now })).toThrow(/end/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', date: '2026-09-21', time: '25:00', durationMinutes: 15 }], { calName: 'PPP', now })).toThrow(/time/i)
    expect(() => buildIcs([{ uid: 'u', summary: 'x', date: '2026-09-21', time: '09:00', durationMinutes: 15, rrule: 'FREQ=YEARLY;X=1' }], { calName: 'PPP', now })).toThrow(/rrule/i)
  })
})
```

- [ ] **Step 2: Run to verify it fails, then implement**

```ts
// app/src/calendar/ics.ts
export type IsoDate = string
export interface IcsAllDayEvent { uid: string; summary: string; description?: string; start: IsoDate; end: IsoDate; kind?: string; sequence?: number }
export interface IcsTimedEvent { uid: string; summary: string; description?: string; date: IsoDate; time: string; durationMinutes: number; rrule?: string; rdates?: { date: IsoDate; time: string }[]; alarmMinutesBefore?: number; kind?: string; sequence?: number }
export type IcsEvent = IcsAllDayEvent | IcsTimedEvent

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const RRULE = /^FREQ=(?:DAILY|WEEKLY|MONTHLY)(?:;(?:INTERVAL=\d{1,3}|BYDAY=(?:MO|TU|WE|TH|FR|SA|SU)(?:,(?:MO|TU|WE|TH|FR|SA|SU))*|BYMONTHDAY=(?:[1-9]|[12]\d|3[01])|UNTIL=\d{8}(?:T\d{6})?))*$/
const encoder = new TextEncoder()

export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: lines are at most 75 octets; continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ''
  for (const char of line) {
    const next = current + char
    const limit = out.length === 0 ? 75 : 74
    if (encoder.encode(next).length > limit) { out.push(current); current = char } else current = next
  }
  out.push(current)
  return out.map((part, i) => (i === 0 ? part : ` ${part}`)).join('\r\n')
}

function isAllDay(e: IcsEvent): e is IcsAllDayEvent { return 'start' in e }
function ymd(date: IsoDate): string { return date.replace(/-/g, '') }
function local(date: IsoDate, time: string): string { return `${ymd(date)}T${time.replace(':', '')}00` }
function utc(now: Date): string { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') }
function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function addMinutes(date: IsoDate, time: string, minutes: number): { date: IsoDate; time: string } {
  const [h, mi] = time.split(':').map(Number)
  const total = h * 60 + mi + minutes
  const dayShift = Math.floor(total / 1440), rest = ((total % 1440) + 1440) % 1440
  return { date: addDays(date, dayShift), time: `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}` }
}

function validate(e: IcsEvent): void {
  if (!e.uid || /\s/.test(e.uid)) throw new Error('Calendar event uid is required.')
  if (!e.summary.trim()) throw new Error('Calendar event summary is required.')
  if (isAllDay(e)) {
    if (!DATE.test(e.start) || !DATE.test(e.end)) throw new Error('Calendar event dates must be YYYY-MM-DD.')
    if (e.end < e.start) throw new Error('Calendar event end must not precede its start.')
  } else {
    if (!DATE.test(e.date)) throw new Error('Calendar event dates must be YYYY-MM-DD.')
    if (!TIME.test(e.time) || e.rdates?.some((r) => !DATE.test(r.date) || !TIME.test(r.time))) throw new Error('Calendar event time must be HH:MM.')
    if (!Number.isInteger(e.durationMinutes) || e.durationMinutes < 1) throw new Error('Calendar event duration must be at least one minute.')
    if (e.rrule !== undefined && !RRULE.test(e.rrule)) throw new Error('Calendar event rrule is not supported.')
  }
}

export function buildIcs(events: IcsEvent[], opts: { calName: string; now: Date }): string {
  events.forEach(validate)
  const stamp = utc(opts.now)
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PPP//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeIcsText(opts.calName)}`]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`)
    if (isAllDay(e)) lines.push(`DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(addDays(e.end, 1))}`)
    else {
      const end = addMinutes(e.date, e.time, e.durationMinutes)
      lines.push(`DTSTART:${local(e.date, e.time)}`, `DTEND:${local(end.date, end.time)}`)
      if (e.rrule) lines.push(`RRULE:${e.rrule}`)
      for (const r of e.rdates ?? []) lines.push(`RDATE:${local(r.date, r.time)}`)
    }
    lines.push(`SUMMARY:${escapeIcsText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`)
    if (e.sequence !== undefined) lines.push(`SEQUENCE:${Math.max(0, Math.trunc(e.sequence))}`)
    lines.push('TRANSP:TRANSPARENT')
    if (e.kind) lines.push(`X-PPP-KIND:${escapeIcsText(e.kind)}`)
    if (!isAllDay(e) && e.alarmMinutesBefore !== undefined) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcsText(e.summary)}`, `TRIGGER:${e.alarmMinutesBefore === 0 ? 'PT0M' : `-PT${Math.trunc(e.alarmMinutesBefore)}M`}`, 'END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldIcsLine).join('\r\n') + '\r\n'
}
```

- [ ] **Step 3: Run to verify it passes, commit**

Run: `cd app && npx vitest run src/calendar/ics.test.ts` → 5 passed.

```bash
git add app/src/calendar
git commit -m "Add a pure iCalendar builder with folding, escaping, RRULE and alarms"
```

### Task 10: Forecast and reminder events

**Files:**
- Create: `app/src/calendar/forecastEvents.ts`, `app/src/calendar/reminderEvents.ts`
- Test: `app/src/calendar/forecastEvents.test.ts`, `app/src/calendar/reminderEvents.test.ts`, `app/src/calendar/__fixtures__/forecast.golden.ics`
- Modify: `app/src/engine/reminders.ts` (export `copyFor`)

**Interfaces:**

```ts
// forecastEvents.ts
export interface ForecastEventOptions { cycles: number /* 1..6 */; discreet: boolean }
export function forecastCalendarEvents(f: { prediction: Prediction; eligibility: PersonalizedPrediction['eligibility']; diagnostics: CycleForecastDiagnostics }, opts: ForecastEventOptions): IcsAllDayEvent[]
// reminderEvents.ts
export function reminderCalendarEvents(prefs: ReminderPreferences, today: IsoDate): IcsTimedEvent[]
export function rruleFor(recurrence: ReminderRecurrence): { rrule?: string; rdates?: { date: IsoDate; time: string }[]; start: IsoDate } // time filled by caller
```

Rules (from spec C2/C3):
- Period base window = `diagnostics.periodWindow ?? (prediction.nextPeriodStart ? { start: addDays(nps, -u), end: addDays(nps, u) } : null)`; none, or `eligibility.periodForecast` false, or `prediction.averageCycleLength < 15` → no period events. Cycle n (0-based) shifts by `n * averageCycleLength` and widens by `n * uncertaintyDays` on both sides.
- Fertile: `eligibility.fertileWindow` and (`diagnostics.fertileWindowRange ?? prediction.fertileWindow`), shifted per cycle. Ovulation: `eligibility.ovulationForecast` and (`diagnostics.ovulationWindow ?? { start: ovulationDate, end: ovulationDate }`), shifted.
- Titles: discreet → `PPP`, `PPP +`, `PPP ○`; descriptive → `Period expected`, `Fertile window (estimate)`, `Ovulation (estimate)`. Description: `Estimate from PPP, ±${u + n*u} days. Not for contraception.` (fertile/ovulation: `Estimate from PPP. Not for contraception.`). UIDs `ppp-period-${n}@ppp.local` etc., `sequence` = `Math.floor(Date.now()/60000)` supplied by the caller in `export.ts` (tests pass a fixed one via an optional `sequence` option).
- Reminders: only `plan.enabled`; title `prefs.privatePreviews ? 'PPP reminder' : (REMINDER_DEFINITIONS.find((d) => d.id === plan.id)?.label ?? 'PPP reminder')`; description `copyFor(plan.kind, prefs.privatePreviews ? 'private' : plan.preview?.mode).body`; `durationMinutes: 15`; `alarmMinutesBefore: 0`; recurrence mapping: `daily` → `FREQ=DAILY` + `;INTERVAL=n` when `every > 1`; `weekdays` → `FREQ=WEEKLY;BYDAY=` (1→MO … 7→SU); `interval-days` → `FREQ=DAILY;INTERVAL=n`; `monthly` → `FREQ=MONTHLY;BYMONTHDAY=d`; `once` → no rrule, `start = date`; `dates` → `start = dates[0]`, `rdates` = rest; `endDate` → `;UNTIL=YYYYMMDDT235959`. `start` defaults to `recurrence.startDate ?? today` (for `monthly`, the first `day` on or after today).

- [ ] **Step 1: Write the failing tests**

```ts
// app/src/calendar/forecastEvents.test.ts
import { describe, expect, it } from 'vitest'
import { forecastCalendarEvents } from './forecastEvents'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-25', ovulationDate: '2026-09-11', fertileWindow: { start: '2026-09-07', end: '2026-09-12' }, uncertaintyDays: 2, cycleDay: 15, averageCycleLength: 28, source: 'basic' as const }
const diagnostics = { periodWindow: { start: '2026-09-23', end: '2026-09-27' }, ovulationWindow: { start: '2026-09-10', end: '2026-09-12' }, fertileWindowRange: { start: '2026-09-06', end: '2026-09-12' } } as any

describe('forecastCalendarEvents', () => {
  it('emits discreet period, fertile and ovulation events for one cycle', () => {
    const ev = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics }, { cycles: 1, discreet: true })
    expect(ev.map((e) => [e.uid, e.summary, e.start, e.end])).toEqual([
      ['ppp-period-0@ppp.local', 'PPP', '2026-09-23', '2026-09-27'],
      ['ppp-fertile-0@ppp.local', 'PPP +', '2026-09-06', '2026-09-12'],
      ['ppp-ovulation-0@ppp.local', 'PPP ○', '2026-09-10', '2026-09-12'],
    ])
    expect(ev[0].description).toBe('Estimate from PPP, ±2 days. Not for contraception.')
  })
  it('shifts later cycles by the cycle length and widens the period window', () => {
    const ev = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics }, { cycles: 3, discreet: false })
    const periods = ev.filter((e) => e.uid.startsWith('ppp-period-'))
    expect(periods.map((e) => [e.start, e.end])).toEqual([['2026-09-23', '2026-09-27'], ['2026-10-19', '2026-10-27'], ['2026-11-14', '2026-11-26']])
    expect(periods[2].summary).toBe('Period expected')
    expect(periods[2].description).toBe('Estimate from PPP, ±6 days. Not for contraception.')
  })
  it('omits fertility events when not eligible and everything when the period forecast is off', () => {
    expect(forecastCalendarEvents({ prediction, eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false }, diagnostics }, { cycles: 2, discreet: true }).every((e) => e.uid.startsWith('ppp-period-'))).toBe(true)
    expect(forecastCalendarEvents({ prediction, eligibility: { ...eligible, periodForecast: false }, diagnostics }, { cycles: 2, discreet: true })).toEqual([])
  })
  it('falls back to nextPeriodStart ± uncertainty when the engine has no window', () => {
    const ev = forecastCalendarEvents({ prediction, eligibility: eligible, diagnostics: { ...diagnostics, periodWindow: null } }, { cycles: 1, discreet: true })
    expect(ev[0]).toMatchObject({ start: '2026-09-23', end: '2026-09-27' })
  })
})
```

```ts
// app/src/calendar/reminderEvents.test.ts
import { describe, expect, it } from 'vitest'
import { reminderCalendarEvents, rruleFor } from './reminderEvents'
import { defaultReminderPreferences } from '../engine/reminderPreferences'

describe('rruleFor', () => {
  it.each([
    [{ type: 'daily' }, 'FREQ=DAILY'],
    [{ type: 'daily', every: 3 }, 'FREQ=DAILY;INTERVAL=3'],
    [{ type: 'weekdays', weekdays: [1, 3, 7] }, 'FREQ=WEEKLY;BYDAY=MO,WE,SU'],
    [{ type: 'interval-days', startDate: '2026-09-12', every: 21 }, 'FREQ=DAILY;INTERVAL=21'],
    [{ type: 'monthly', day: 15 }, 'FREQ=MONTHLY;BYMONTHDAY=15'],
    [{ type: 'daily', endDate: '2026-12-31' }, 'FREQ=DAILY;UNTIL=20261231T235959'],
  ])('maps %j', (recurrence, rrule) => {
    expect(rruleFor(recurrence as any).rrule).toBe(rrule)
  })
  it('maps once and dates without an rrule', () => {
    expect(rruleFor({ type: 'once', date: '2026-10-01' })).toEqual({ start: '2026-10-01' })
    expect(rruleFor({ type: 'dates', dates: ['2026-10-01', '2026-10-05'] })).toMatchObject({ start: '2026-10-01', rdates: [{ date: '2026-10-05' }] })
  })
})

describe('reminderCalendarEvents', () => {
  it('exports only enabled plans, with private titles by default and floating times', () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC' } as any)
    prefs.plans = prefs.plans.map((p, i) => ({ ...p, enabled: i < 2, localTime: '20:30' }))
    const ev = reminderCalendarEvents(prefs, '2026-09-11')
    expect(ev).toHaveLength(2)
    expect(ev[0]).toMatchObject({ uid: `ppp-reminder-${prefs.plans[0].id}@ppp.local`, summary: 'PPP reminder', time: '20:30', durationMinutes: 15, alarmMinutesBefore: 0 })
    expect(ev[0].description).not.toMatch(/period|fertile|medication|pregnan/i)
  })
  it('uses the plan label when private previews are off', () => {
    const prefs = defaultReminderPreferences({ timeZone: 'UTC' } as any)
    prefs.privatePreviews = false
    prefs.plans = prefs.plans.map((p) => ({ ...p, enabled: p.id === 'bbt' }))
    expect(reminderCalendarEvents(prefs, '2026-09-11')[0].summary).toBe('Basal temperature')
  })
})
```

(Adjust `defaultReminderPreferences` arguments to its real signature after reading it; the intent is the default seven plans.)

- [ ] **Step 2: Golden file**

After implementing, generate `__fixtures__/forecast.golden.ics` from the one-cycle discreet fixture through `buildIcs` with `now = 2026-09-11T10:00:00Z` and `sequence: 1`, commit it, and add a test that regenerating equals the file byte for byte.

- [ ] **Step 3: Run to verify, commit**

Run: `cd app && npx vitest run src/calendar` → all green.

```bash
git add -A
git commit -m "Map cycle forecasts and reminder plans to calendar events"
```

### Task 11: Export entry points, Settings card, Today action, privacy copy

**Files:**
- Create: `app/src/calendar/export.ts`
- Modify: `app/src/db/transfer.ts` (`shareOrDownload(filename, contents, mime = 'application/json')`), `app/src/db/schema.ts` (`SK.calendarDiscreet`, `SK.calendarCycles`), `app/src/screens/Settings.tsx`, `app/src/screens/Today.tsx`, `app/src/privacy/destinations.ts`, `PRIVACY.md`, `README.md`, `docs/WEB_CAPABILITY_BOUNDARY.md`

**Interfaces:**

```ts
// export.ts
export interface CalendarExportResult { events: number; skipped?: string }
export async function exportForecastCalendar(opts?: { today?: IsoDate; now?: Date; share?: typeof shareOrDownload }): Promise<CalendarExportResult>
//   reads SK.calendarDiscreet ('1' default) and SK.calendarCycles ('3' default, clamp 1..6); computePersonalizedForecast(today); forecastCalendarEvents; if none → { events: 0, skipped: 'Log two period starts first.' } without sharing; else buildIcs(..., { calName: 'PPP', now }) → share('ppp-forecast.ics', ics, 'text/calendar')
export async function exportRemindersCalendar(opts?): Promise<CalendarExportResult>
//   parseReminderPreferences from settings (REMINDER_SETTINGS_KEY); reminderCalendarEvents; if none → { events: 0, skipped: 'Turn on a reminder first.' }; else share('ppp-reminders.ics', …)
```

- `shareOrDownload`: third parameter `mime`; `File`/`Blob` use it; `.ics` shares with `title: 'PPP calendar'`.
- Settings "Calendar" card: switch "Discreet titles" (default on), segmented "Cycles" 3 | 6, buttons "Add cycle forecast to calendar" and "Add reminders to calendar", status line for `skipped` or "Calendar file ready." Copy paragraph from spec C4.
- Today: when `predictionContext.eligibility.periodForecast`, add a fourth quick action "Calendar" (calendar glyph) that calls `exportForecastCalendar()`; failures show the existing status pattern.
- `privacy/destinations.ts` gains the calendar row from spec C1; `PrivacyTable` picks it up. PRIVACY.md gains "## Calendar files" (what the file contains, discreet titles, floating reminder times, that nothing is uploaded). README gains a "Add to your calendar" subsection and, under "Run it", a "Add to your home screen" subsection (iOS: Share → Add to Home Screen; Android: the in-app button). `WEB_CAPABILITY_BOUNDARY.md` lists calendar files under "Fully local".

- [ ] **Step 1: Write the failing test**

```ts
// app/src/calendar/export.test.ts
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, setSetting, SK } from '../db/schema'
import { exportForecastCalendar, exportRemindersCalendar } from './export'

describe('calendar export', () => {
  beforeEach(async () => { for (const t of db.tables) await t.clear() })

  it('does not share when there is nothing to export', async () => {
    const share = vi.fn()
    expect(await exportForecastCalendar({ today: '2026-09-11', share })).toEqual({ events: 0, skipped: 'Log two period starts first.' })
    expect(await exportRemindersCalendar({ share })).toEqual({ events: 0, skipped: 'Turn on a reminder first.' })
    expect(share).not.toHaveBeenCalled()
  })

  it('shares a forecast file honouring the saved preferences', async () => {
    await db.dailyLogs.bulkPut([{ date: '2026-07-01', flow: 'medium' }, { date: '2026-07-29', flow: 'medium' }])
    await setSetting(SK.calendarDiscreet, '0'); await setSetting(SK.calendarCycles, '6')
    const share = vi.fn(async () => {})
    const r = await exportForecastCalendar({ today: '2026-08-10', now: new Date('2026-08-10T00:00:00Z'), share })
    expect(r.events).toBeGreaterThanOrEqual(6)
    const [name, ics, mime] = share.mock.calls[0]
    expect(name).toBe('ppp-forecast.ics'); expect(mime).toBe('text/calendar')
    expect(ics).toContain('SUMMARY:Period expected'); expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(r.events)
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement everything in the Files list, run to verify it passes**

Run: `cd app && npx vitest run && npx tsc --noEmit && npx vite build && node scripts/check-chunks.mjs`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add calendar export for forecasts and reminders with discreet titles"
```

### Task 12: Final verification and documentation sweep

- [ ] **Step 1: Run everything**

From the repo root: `pnpm --filter @ppp/app test && (cd app && npx tsc --noEmit && npx vite build && node scripts/check-chunks.mjs) && (cd workers/records-relay && pnpm test) && (cd workers/backup && pnpm test) && (cd workers/reminders && pnpm test)`. Confirm `git status` (scratch clone) is clean after the last commit and that `grep -rli lunara --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git . | grep -v "docs/superpowers\|docs/finchnode"` only lists files whose matches are attribution, the upstream URL, historical notes, or the legacy import literal.

- [ ] **Step 2: Report**

List for the reviewer: the exact browser checks (320px and 375px layouts, iOS UA install instructions, standalone emulation, forecast and reminder `.ics` downloads opened in a calendar app, shortcuts via `/?action=log` and `/?tab=records`).

---

## Plan self-review

- **Spec coverage:** A1/A2 → T1–T2; B1 → T3; B2 → T4–T5; B3 → T6–T7; C1 → T9/T11; C2 → T8/T10; C3 → T10; C4 → T11; C5 → T11 (`skipped`, silent share cancel); privacy → T11; testing → each task; phasing → one run.
- **Type consistency:** `IcsAllDayEvent`/`IcsTimedEvent`/`buildIcs` (T9) are consumed by T10/T11 with the same names; `computePersonalizedForecast` (T8) returns `prediction`, `predictionContext`, `forecastDiagnostics` used by T10/T11; `shareOrDownload(name, contents, mime)` (T11) matches the call in `export.ts`; `SK.installCardDismissedAt` (T4) is used by T5; `SK.calendarDiscreet`/`SK.calendarCycles` (T11) are read by `export.ts`.
- **Judgement calls left to the implementer:** exact `app.css` selectors for hit areas (T6); whether `manualChunks` is needed (T7); the engine's exact two-cycle forecast date in T8's test; `defaultReminderPreferences`' real signature (T10).


---

## Amendments (from the independent adversarial review; these override the task text above)

**A1 (Task 1 guard).** In `rename.test.ts` use `const SKIP = /\/(?:node_modules|dist|\.wrangler|__fixtures__)\/|\/rename\.test\.ts$/` and `const ALLOWED = [/based on Lunara/, /github\.com\/Blueturboguy07\/lunara/, /app(?:: | === )'lunara'/, /'lunara' \| 'ppp'/]`. Remove `/rename\.test\.ts/` from `ALLOWED`.

**A2 (Task 1 legacy import).** `ExportPayloadV1.app` becomes `'lunara' | 'ppp'`; `validatePayload` accepts `p.app === 'lunara' || p.app === 'ppp'` and its `legacy` object writes `app: 'ppp' as const`; `collectExport` writes `'ppp'`; `transferValidation.ts` error strings say `in PPP export.`. The Global Constraints sentence about `transferValidation.ts` holding a legacy literal is wrong; the literal lives in `db/transfer.ts` and its test.

**A3 (Task 1 hosts).** Replace the `lunara.app` host everywhere (`workers/reminders/wrangler.toml`, `workers/backup/wrangler.toml`, `workers/reminders/src/index.js`, `workers/reminders/src/templates.test.js`) with the placeholder `ppp.example` (`https://ppp.example`, `reminders@ppp.example`). It is not a domain PPP owns; add a wrangler comment saying operators must replace it.

**A4 (Task 1 identifiers missed).** Also rename: `.lunara-mark` in `app/src/styles/health-import.css` (dead selector, delete it), `LUNARA_CRESCENT_PATH` → `PPP_CRESCENT_PATH`, `copyFor` outputs `'Lunara update'`/`'Lunara check-in'` → `'PPP update'`/`'PPP check-in'`, the daily title in `platform/notifications.ts`, the print job names in `platform/reportExport.ts`, `components/DoctorReport.tsx`, `screens/CycleReportScreen.tsx`, and `workers/records-relay/README.md` header name. After this commit anyone with a PIN in a dev browser profile must clear site data (the PIN hash domain changed), and a deployed relay must be redeployed with the app (header name changed); say both in the commit body.

**A5 (Task 2).** Add `app/pwa.config.test.ts` (`name: 'PPP'`) and `PRIVACY.md` (`lunara-keys` → `ppp-keys`) to the Modify list.

**A6 (Task 3 sharp).** Run `cd app && pnpm add -D sharp@0.33.5 --offline` unconditionally before the splash script. Use `.png({ compressionLevel: 9, palette: true })`; background `#FFF8FA` (matches the SVG).

**A7 (Task 4).** `getInstallState()` returns `{ mode: 'unsupported' }` when `typeof window === 'undefined' || typeof window.matchMedia !== 'function'`. Expected test count is 8, not 9.

**A8 (Task 6).** Step 1 becomes only `html { -webkit-text-size-adjust: 100%; }` and `[role='button'], a, .chip, .cal-day, .date-cell { touch-action: manipulation; }` (base.css already covers buttons, inputs, overscroll and the root height; do not add `#root { min-height: 100dvh }`). In Step 2 drop `.tabbar-item`, `.pin-key` and `.quick-action-circle` from the 44px rule (already large); keep `.chip`, `.icon-button`, `.calendar-toolbar button`, and the `.cal-day`/`.date-cell` hit-area extension. Replace the safe-area rule with `.overlay, .sheet, .health-overlay { padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); }`.

**A9 (Task 7).** Create `app/src/lib/assistantModels.ts` holding `AssistantProvider`, `ANTHROPIC_MODELS`, `DEFAULT_ANTHROPIC_MODEL`, `DEFAULT_OPENAI_MODEL` (and any other constants `Onboarding.tsx` imports from `lib/assistant`); `lib/assistant.ts` re-exports them; `Onboarding.tsx` imports from `../lib/assistantModels`. After this, `grep -rln "lib/assistant'" app/src` lists only `AssistantScreen.tsx` and the type-only import in `assistantContext.ts`. In `App.tsx` import `PerimenopauseScreen`, `PregnancyDetailScreen`, `TrackerCustomizeScreen`, `TtcDetailScreen` from their own source files and lazy-load `CycleReportScreen` with `import('./screens/CycleReportScreen')`; App must not import `./screens/healthFeatures`.

**A10 (Task 8 test).** `eligibility.periodForecast` is a policy flag that is true whenever the user is not pregnant, even with no data. Replace `expect(r.predictionContext.eligibility.periodForecast).toBe(false)` with `expect(r.prediction.nextPeriodStart).toBeNull()`. The two-start fixture yields `nextPeriodStart: '2026-08-26'` and `uncertaintyDays: 7` (verified).

**A11 (Task 10 forecast rules).** Replace the first rule bullet with: "If `!eligibility.periodForecast`, or `prediction.nextPeriodStart === null`, or `prediction.averageCycleLength < 15`, return `[]`. Period base window = `nextPeriodStart ± prediction.uncertaintyDays` (ignore `diagnostics.periodWindow`, which uses the raw uncertainty). Cycle n shifts by `n * averageCycleLength` and widens by `n * uncertaintyDays` on both sides." Delete the "falls back to nextPeriodStart" test (that is now the only path) and update test 3 so `periodForecast: false` yields `[]` even with fertility eligible. `ForecastEventOptions` gains `sequence?: number`.

**A12 (Task 10 discreet mode).** UIDs are opaque in both modes: `ppp-a-<n>@ppp.local` (period), `ppp-b-<n>@ppp.local` (fertile), `ppp-c-<n>@ppp.local` (ovulation), so switching modes still replaces events. In discreet mode omit `X-PPP-KIND` and use the description `Estimate from PPP, ±N days.` (fertile/ovulation: `Estimate from PPP.`); in descriptive mode keep `X-PPP-KIND` and append ` Not for contraception.`. The Settings card copy carries the contraception disclaimer in both modes. Update the forecast tests' expected UIDs and descriptions accordingly.

**A13 (Task 10 reminders).** Default plan ids are `settings-<definitionId>`. Titles never use definition labels: `const copy = copyFor(plan.kind, prefs.privatePreviews ? 'private' : plan.preview?.mode); summary = copy.title; description = copy.body`. Test 2 becomes "uses the category title when private previews are off" and expects `'PPP check-in'` for the `settings-bbt` plan (`enabled: p.id === 'settings-bbt'`). `defaultReminderPreferences` takes `{ timeZone, startDate, permission?, legacyTime? }`; tests pass `{ timeZone: 'UTC', startDate: '2026-09-11' }`.

**A14 (Task 10 rruleFor).** Signature `rruleFor(recurrence: ReminderRecurrence, today: IsoDate): { rrule?: string; rdates?: IsoDate[]; start: IsoDate }`. `base = max(recurrence.startDate ?? today, today)`; `weekdays` → first date ≥ base whose ISO weekday is in `weekdays` (DTSTART must fall on a BYDAY day); `daily`/`interval-days` with `every > 1` → first `startDate + k·every` ≥ today; `daily` with `every` 1 → base; `monthly` → first `day` ≥ base; `once` → `date`; `dates` → `dates[0]` with `rdates = dates.slice(1)` (the caller maps to `{ date, time: plan.localTime }`). Tests call `rruleFor(recurrence as any, '2026-09-11')` and expect `rdates: ['2026-10-05']`.

**A15 (Task 10 golden file).** Add `app/src/calendar/__fixtures__/.gitattributes` containing `*.ics -text` so CRLF survives checkout.

**A16 (Task 11 types).** In `export.test.ts` use `type Share = (filename: string, contents: string, mime?: string) => Promise<void>` and `const share = vi.fn<Share>(async () => {})`.

**A17 (Task 11 eligibility).** "Nothing to export" is `prediction.nextPeriodStart === null || !eligibility.periodForecast`. Today shows the Calendar quick action when `data.prediction.nextPeriodStart !== null`.

**A18 (Task 11 Today and Settings).** Change `.today-quick-actions` to `grid-template-columns: repeat(4, minmax(0, 1fr))` (keep the 320px circle size from Task 6). Add `const [calendarNotice, setCalendarNotice] = useState<string | null>(null)` in Today, rendered under the quick actions. Add the sentence "Quiet hours are not applied to calendar reminders." to the Settings Calendar card. Insert the privacy row before the `'Anything else'` row so it stays last.

**A19 (Task 11 share cancel).** In `shareOrDownload`, `catch (error) { if ((error as DOMException)?.name === 'AbortError') return }` before falling back to the download, so cancelling the share sheet does not also download the file.

**A20 (Task 4 install).** `getInstallState` must not throw under the stubbed `window` used by `Settings.test.ts` (no `matchMedia`); see A7.
