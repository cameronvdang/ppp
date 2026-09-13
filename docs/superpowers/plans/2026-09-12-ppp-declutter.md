# PPP De-clutter Plan (addendum, Task 17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the UI patterns that read as machine-generated: eyebrow/kicker labels above headings, tagline sublines under titles, uppercase letter-spaced section labels, decorative arrow glyphs, em dashes, motivational empty-state lines, and rows of three feature blurbs. Keep every piece of information that was useful, expressed once, in plain sentence case.

**Architecture:** Copy and markup changes in screens and components, deletion of the label styles in the stylesheets, and an extension of the existing copy guard so the patterns cannot return. No behaviour changes. **Spec:** section 13 of `docs/superpowers/specs/2026-09-11-ppp-rename-mobile-calendar-design.md`.

## Global Constraints

- Same constraints as the earlier PPP plans (scratch-clone commits, trailer, no regressions, strings and markup only).
- Do not delete information, only decoration: when an eyebrow carried a fact (the phase name, "Fertility timing"), the fact moves into the heading or the first sentence.
- Sentence case everywhere. No `text-transform: uppercase` and no letter-spacing on labels, except the single-letter weekday headers in the calendar and date strip.
- One heading per block, at most one sentence under it. No sublines that restate the heading.

---

### Task 17: Remove eyebrows, taglines, and decorative glyphs, and guard against them

**Files:**
- Modify: `app/src/screens/Today.tsx`, `Insights.tsx`, `Graphs.tsx`, `Settings.tsx`, `RecordsScreen.tsx`, `Onboarding.tsx`, `TtcDetailScreen.tsx`, `PregnancyDetailScreen.tsx`, `PerimenopauseScreen.tsx`, `TrackerCustomizeScreen.tsx`, `CycleReportScreen.tsx`; `app/src/components/DoctorReport.tsx`, `InstallCard.tsx`, `RecordsCategoryList.tsx`, `PrivacyTable.tsx`, `AssistantScreen.tsx`; `app/src/privacy/destinations.ts`; `app/src/styles/app.css`, `health.css`, `reports.css`, `assistant.css`, `records.css`, `mobile.css`, `desktop.css`; `app/src/copyGuard.test.ts`; `README.md` where it quotes UI copy.

**Removal rules (apply to every listed file):**

1. **Eyebrows and kickers.** Delete every element with a class matching `page-kicker`, `phase-eyebrow`, `health-kicker`, `reminder-kicker`, `assistant-feature-kicker`, `eyebrow`, `collection-count`, `story-count`, and any `.section-label` that sits directly above a heading. Delete their CSS. Where the text carried information, fold it in as described in the table below.
2. **Section labels.** Settings, Records and report group labels (`.section-label`) that group controls become `<h2 className="group-title">` in sentence case (weight 600, 15px, ink-900, no transform, no tracking). Text: "Goal", "Personalise", "Privacy and lock", "Your data and backups", "Reminders", "Medical records", "Calendar", "Home screen", "Privacy and data", "AI assistant", "Danger zone" (rename to "Delete"), "What leaves this device".
3. **Taglines.** Delete the `<p>` directly under a page `<h1>` when it does not tell the user what to do: Insights ("Calm explanations…"), Trends ("Look for direction…"), reminders ("Your time, your rhythm"), the AI card ("Bring the question you keep circling", "Your key, your conversation, your choice"), the onboarding welcome pill ("Built for private, local-first tracking") and triad ("Local / Explainable / Optional") and its footnote.
4. **Arrows and em dashes.** Remove `→`, `↗`, `›` and `—` from button and link text and from any string literal in the listed files. Disclosure chevrons rendered as an SVG icon in list rows may stay; text glyphs may not. The privacy table's "Anything else / Never / —" row becomes "Anything else / Never / Nothing".
5. **Empty states.** Replace motivational empty-state lines with one factual sentence: "No completed cycles yet." "No flow logged yet." "No symptoms logged yet." "No readings yet." "No patterns yet."
6. **Feature triads.** Any row of three equal cards with icon + title + blurb (onboarding welcome, insights collections header) becomes plain text or is removed.
7. **Adjectives.** Delete "gentle", "gently", "calm", "quietly", "companion", "without judgment" from UI strings; rewrite the sentence if needed.

**Exact rewrites:**

| Where | Before | After |
| --- | --- | --- |
| Today hero, empty | eyebrow "Your cycle", title "Start with your dates" | title "Start with your dates", body unchanged |
| Today hero, period | eyebrow "Period:", title "Day N" | title "Period, day N", body "Log flow and symptoms for today." |
| Today hero, ovulation | eyebrow "Estimated today", title "Ovulation may be today" | title "Ovulation estimated today", body unchanged |
| Today hero, fertile | eyebrow "Estimated fertile window", title … | title "Fertile window (estimate)", body unchanged |
| Today hero, follicular/luteal | eyebrow "Luteal phase (estimate)", title "Cycle day N" | title "Luteal phase (estimate)" (or Follicular), body "Cycle day N. Next period estimated in D days (±U)." |
| Today hero, cycle (no phase) | eyebrow "Your cycle", title "Cycle day N" | title "Cycle day N", body unchanged |
| Today hero, peri | eyebrow "Midlife tracking" | eyebrow removed, title unchanged |
| Today hero CTA pill | "What's important today? Learn more ›" | text button "What this means" |
| Today insight cards | eyebrow "Fertility timing" / "Symptoms to expect?" / "Cycle position" + value | `<h3>` "Fertility timing" / "Symptoms to expect" / "Cycle position" in sentence case, value below |
| Today section labels | "My daily insights · Today", "For this part of your cycle" | `<h2 className="group-title">Today's insights</h2>`; second label removed |
| Insights page | kicker "Knowledge for your season", h1 "Read, ask, notice", tagline | h1 "Insights"; nothing under it |
| Insights AI card | kicker "PPP AI", headline "Bring the question you keep circling", subline "Your key, your conversation, your choice", arrow button | card title "Ask PPP AI", one line "Uses your own key. Optional.", button "Open" |
| Insights collections | "Chosen for your focus", "Collection 02", counts pill, "Read ↗" | `<h2 className="group-title">Cycle basics</h2>` etc.; article rows keep "N min read"; link text "Read" |
| Trends page | kicker "Your body, over time", h1 "Your patterns", tagline | h1 "Trends" |
| Trends doctor callout | kicker "For your next appointment", "Create a doctor-ready summary", "A clear, printable view…", "↗" | title "Doctor's summary", one line "A printable view of what you logged." |
| Trends empty states | "Your rhythm will appear here / Log a couple of period starts…", "Flow history will appear here…", "No patterns yet / Symptoms you choose to log will gather here without judgment.", "Three readings unlock the line" | "No completed cycles yet. Log two period starts.", "No flow logged yet.", "No symptoms logged yet.", "No readings yet. Log three temperatures to see the line." |
| Settings reminders | kicker "Quietly on your device", heading "Your time, your rhythm" | heading "Reminders" (group title), one line "Reminders show while PPP is open. Add them to your calendar to get them when it is closed." |
| Settings footer | unchanged | unchanged |
| Onboarding welcome | kicker "Meet PPP", h1 "A clearer map of your changing body.", pill, triad, footnote, button "Build my baseline →" | h1 "Track your cycle privately.", one line "PPP keeps your data on this device and explains every estimate.", button "Get started" |
| Onboarding step eyebrows | `.eyebrow` step labels | if they show progress, a plain "Step 2 of 8" line in sentence case; otherwise removed |
| Health detail screens | `.health-kicker` above headings | removed; heading text unchanged |
| Records | "What leaves this device" as a tracked label | `<h2 className="group-title">What leaves this device</h2>` |
| Doctor report | any kicker/label rows | sentence-case `<h3>` headings |

**CSS:** delete the rules for the removed classes; delete `text-transform: uppercase` and `letter-spacing: var(--tracking-label)` everywhere except `.cal-weekdays span` / `.date-strip .dow` (single letters); add `.group-title { font-size: 15px; font-weight: 600; color: var(--ink-900); margin: 22px 0 8px; }`. Remove `--tracking-label` from `tokens.css` once nothing uses it.

- [ ] **Step 1: Extend the guard**

Add to `app/src/copyGuard.test.ts`:

```ts
const BANNED_CLASSES = /\b(page-kicker|phase-eyebrow|health-kicker|reminder-kicker|assistant-feature-kicker|eyebrow|kicker|tagline|collection-count|story-count|section-label)\b/
const BANNED_GLYPHS = /[→↗—]|›(?=\s*['"<])/
const ADJECTIVES = /\b(gentle|gently|calm|quietly|companion|without judgment)\b/i

it('has no eyebrow, kicker, tagline or section-label classes in UI markup', () => {
  const offenders = uiFiles().filter((f) => BANNED_CLASSES.test(readFileSync(f, 'utf8'))).map(rel)
  expect(offenders).toEqual([])
})
it('has no decorative glyphs or adjectives in user-facing text', () => {
  const offenders: string[] = []
  for (const f of uiFiles()) for (const line of userFacingText(readFileSync(f, 'utf8')).split('\n')) if (BANNED_GLYPHS.test(line) || ADJECTIVES.test(line)) offenders.push(`${rel(f)}: ${line.trim().slice(0, 80)}`)
  expect(offenders).toEqual([])
})
it('uses uppercase only for weekday letters', () => {
  const css = ['app', 'health', 'reports', 'assistant', 'records', 'mobile', 'desktop'].map((n) => readFileSync(resolve(__dirname, `styles/${n}.css`), 'utf8')).join('\n')
  const blocks = css.match(/[^{}]+\{[^}]*text-transform:\s*uppercase[^}]*\}/g) ?? []
  const disallowed = blocks.filter((b) => !/cal-weekdays|date-strip .dow|\.dow\b/.test(b)).map((b) => b.split('{')[0].trim())
  expect(disallowed).toEqual([])
  expect(css).not.toMatch(/--tracking-label/)
})
```

(`uiFiles()` and `rel()` are small helpers over the existing `walk`; reuse `userFacingText`.)

- [ ] **Step 2: Run the guard, then apply the rules and the rewrite table until it passes**

Run: `cd app && npx vitest run src/copyGuard.test.ts`. Work screen by screen; after each screen run `npx tsc --noEmit`.

- [ ] **Step 3: Verify**

Run: `cd app && npx vitest run && npx tsc --noEmit && npx vite build && node scripts/check-chunks.mjs`. Update tests that asserted old strings (Settings, Today helpers, Insights, Graphs).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Remove eyebrow labels, taglines and decorative glyphs from the UI"
```
