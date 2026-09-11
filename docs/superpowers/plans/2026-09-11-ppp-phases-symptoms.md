# PPP Phases and Per-Day Symptoms Plan (addendum)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make cycle phases explicit everywhere a date is shown (Today, the calendar, the daily log) and make per-day symptoms visible on the calendar, so a user can see which phase a day is in and what they noted that day.

**Architecture:** One pure phase engine (`engine/phase.ts`) derives a named phase for any date from logged period runs plus the personalized prediction. Today, the calendar and the log sheet consume it. The calendar also reads each day's log to draw a symptom dot. No schema changes: symptoms (including nausea and diarrhea under Digestion) are already stored per day in `DailyLog`.

**Tech Stack:** as the main plan. **Spec:** section 11 of `docs/superpowers/specs/2026-09-11-ppp-rename-mobile-calendar-design.md`.

## Global Constraints

- Same constraints as `docs/superpowers/plans/2026-09-11-ppp-rename-mobile-calendar.md` (scratch-clone commits, trailer, no regressions, no new destinations).
- Phase names are estimates and the copy says so; never call ovulation confirmed. Hormonal contraception or pregnancy hides fertile, ovulation and luteal labels (eligibility from `PersonalizedPrediction`).
- The existing symptom taxonomy is not changed; "Digestion" already contains `nausea`, `bloating`, `diarrhea`, `constipation` and more.

---

### Task 13: Phase engine

**Files:**
- Create: `app/src/engine/phase.ts`
- Test: `app/src/engine/phase.test.ts`

**Interfaces:**

```ts
export type CyclePhase = 'period' | 'follicular' | 'fertile' | 'ovulation' | 'luteal' | 'cycle' | 'unknown'
export interface PhaseInput {
  date: ISODate
  /** Sorted logged period-start dates (from getPeriodStarts). */
  periodStarts: ISODate[]
  /** Dates with logged flow (to bound the period run). */
  flowDates: ISODate[]
  prediction: Prediction
  eligibility: PersonalizedPrediction['eligibility']
}
export interface PhaseResult { phase: CyclePhase; cycleDay: number | null; label: string; detail: string }
export function cyclePhaseFor(input: PhaseInput): PhaseResult
```

Rules, in order:
1. `cycleDay` = days since the most recent period start on or before `date` plus one, or null if none or if more than 90 days ago.
2. If `date` is in a logged flow run (consecutive `flowDates` containing `date`) → `period`, label "Period", detail "Day N of your period" (N = position in the run).
3. If `!eligibility.fertileWindow && !eligibility.ovulationForecast` (hormonal contraception or pregnancy): when `cycleDay` exists → `cycle`, label "Cycle day N", detail "Phase estimates are off while on hormonal contraception." (or "…during pregnancy." when `!eligibility.periodForecast`); else `unknown`.
4. If `prediction.ovulationDate === date` → `ovulation`, "Ovulation (estimate)", "Estimated from your cycle history."
5. If `prediction.fertileWindow` contains `date` → `fertile`, "Fertile window (estimate)".
6. If `prediction.fertileWindow` and `date > fertileWindow.end` and (`prediction.nextPeriodStart` is null or `date < nextPeriodStart`) → `luteal`, "Luteal phase", "After the estimated fertile window, before your next period."
7. If `cycleDay` exists and `prediction.fertileWindow` and `date < fertileWindow.start` → `follicular`, "Follicular phase", "From the end of your period until the fertile window."
8. If `cycleDay` exists (no fertile window yet, e.g. insufficient data) → `cycle`, "Cycle day N", "Log two period starts to see phase estimates."
9. Otherwise `unknown`, "No cycle data yet", "Log a period start to begin."

Labels never say "confirmed".

- [ ] **Step 1: Write the failing test**

```ts
// app/src/engine/phase.test.ts
import { describe, expect, it } from 'vitest'
import { cyclePhaseFor } from './phase'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-29', ovulationDate: '2026-09-15', fertileWindow: { start: '2026-09-10', end: '2026-09-16' }, uncertaintyDays: 2, cycleDay: null, averageCycleLength: 28, source: 'basic' as const }
const base = { periodStarts: ['2026-08-04', '2026-09-01'], flowDates: ['2026-08-04', '2026-08-05', '2026-08-06', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'], prediction, eligibility: eligible }

describe('cyclePhaseFor', () => {
  it.each([
    ['2026-09-03', 'period', 'Period', 3],
    ['2026-09-07', 'follicular', 'Follicular phase', 7],
    ['2026-09-12', 'fertile', 'Fertile window (estimate)', 12],
    ['2026-09-15', 'ovulation', 'Ovulation (estimate)', 15],
    ['2026-09-20', 'luteal', 'Luteal phase', 20],
  ])('%s is %s', (date, phase, label, cycleDay) => {
    expect(cyclePhaseFor({ ...base, date })).toMatchObject({ phase, label, cycleDay })
  })
  it('hides phase estimates on hormonal contraception but keeps the cycle day', () => {
    const r = cyclePhaseFor({ ...base, date: '2026-09-12', eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false } })
    expect(r).toMatchObject({ phase: 'cycle', label: 'Cycle day 12' })
    expect(r.detail).toMatch(/hormonal contraception/)
  })
  it('reports cycle day only when there is no fertile window yet', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-12', prediction: { ...prediction, fertileWindow: null, ovulationDate: null } })).toMatchObject({ phase: 'cycle', label: 'Cycle day 12' })
  })
  it('is unknown with no history or stale history', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-12', periodStarts: [], flowDates: [] })).toMatchObject({ phase: 'unknown', cycleDay: null })
    expect(cyclePhaseFor({ ...base, date: '2027-01-15' })).toMatchObject({ cycleDay: null })
  })
  it('period detail counts the day within the run', () => {
    expect(cyclePhaseFor({ ...base, date: '2026-09-02' }).detail).toBe('Day 2 of your period')
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement, run to verify it passes**

Run: `cd app && npx vitest run src/engine/phase.test.ts` → all pass. Reuse `toEpochDay`/`addDays`/`daysBetween` from `engine/cycle.ts`.

- [ ] **Step 3: Commit**

```bash
git add app/src/engine/phase.ts app/src/engine/phase.test.ts
git commit -m "Add a phase engine that names the cycle phase for any date"
```

### Task 14: Phase on Today and in the daily log

**Files:**
- Modify: `app/src/screens/Today.tsx`, `app/src/components/LogSheet.tsx`, `app/src/lib/personalizedForecast.ts` (return `periodStarts` and `flowDates` alongside the forecast so callers do not re-query), `app/src/styles/app.css` (phase chip)

- [ ] **Step 1: Today**

Compute `const phase = cyclePhaseFor({ date: selectedDate, periodStarts, flowDates, prediction: data.prediction, eligibility: data.predictionContext.eligibility })` in the live query result. In the hero content function, when the current tone is `'cycle'` and `phase.phase` is `follicular` or `luteal`, use `eyebrow: phase.label` (for example "Luteal phase") and keep the existing `Cycle day N` title; when `ovulation`/`fertile` keep the existing copy. Add a small `.phase-chip` under the date in the header: `{phase.label}{phase.cycleDay ? ` · Day ${phase.cycleDay}` : ''}` with `title={phase.detail}`; hide it when `phase.phase === 'unknown'`.

- [ ] **Step 2: Log sheet**

`LogSheet` already receives `date`; compute the phase once (via `computePersonalizedForecast(date)` plus the two date arrays) in a `useLiveQuery`, and render `phase.label` (and `· Day N`) under the sheet title so a user noting nausea or diarrhea sees which phase that day belongs to. The Digestion section stays where it is; add the sentence "Noting symptoms here records them for this day and phase." under the Symptoms heading.

- [ ] **Step 3: Verify**

Run: `cd app && npx tsc --noEmit && npx vitest run && npx vite build`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Show the estimated cycle phase on Today and in the daily log"
```

### Task 15: Calendar phase tints, symptom dots, and legend

**Files:**
- Modify: `app/src/components/CalendarScreen.tsx`, `app/src/styles/app.css` (or `records.css`-style new `calendar.css`), `README.md` (feature list), `docs/WEB_CAPABILITY_BOUNDARY.md`
- Test: `app/src/components/calendarDays.test.ts` (extract the pure per-day class computation into `app/src/components/calendarDays.ts`)

**Interfaces:**

```ts
// calendarDays.ts
export interface CalendarDayMarks { classes: string[]; hasSymptoms: boolean; phase: CyclePhase }
export function calendarDayMarks(date: ISODate, ctx: { periodStarts: ISODate[]; flowDates: ISODate[]; logsByDate: Map<ISODate, DailyLog>; prediction: Prediction; eligibility: PersonalizedPrediction['eligibility'] }): CalendarDayMarks
```

- `hasSymptoms` = the day's log has any of `symptoms`, `digestion`, `moods` (non-empty).
- `classes` keep the existing `period`/`predicted`/`fertile`/`ovulation`/`today-mark` classes and add `phase-follicular` or `phase-luteal` for days the engine labels so, and `has-symptoms` when `hasSymptoms`.
- CSS: `.cal-day.phase-follicular { background: var(--pink-100) }`, `.cal-day.phase-luteal { background: var(--pink-200) }` (period/fertile/ovulation styles win by specificity or order), `.cal-day.has-symptoms::after { content: ''; position: absolute; bottom: 4px; left: 50%; width: 5px; height: 5px; border-radius: 50%; background: var(--ink-650); transform: translateX(-50%) }` (coordinate with the existing `.cal-day.today-mark::after`; use a separate element or `box-shadow` if both apply).
- Legend gains "Follicular (estimate)", "Luteal (estimate)", and "Symptoms noted".
- Tapping a day keeps opening the log sheet for that date (that is where symptoms are noted); the sheet now shows the phase (Task 14).

- [ ] **Step 1: Write the failing test**

```ts
// app/src/components/calendarDays.test.ts
import { describe, expect, it } from 'vitest'
import { calendarDayMarks } from './calendarDays'

const eligible = { periodForecast: true, ovulationForecast: true, fertileWindow: true, pregnancyChanceEstimate: false }
const prediction = { nextPeriodStart: '2026-09-29', ovulationDate: '2026-09-15', fertileWindow: { start: '2026-09-10', end: '2026-09-16' }, uncertaintyDays: 2, cycleDay: null, averageCycleLength: 28, source: 'basic' as const }
const ctx = { periodStarts: ['2026-09-01'], flowDates: ['2026-09-01', '2026-09-02'], logsByDate: new Map([['2026-09-07', { date: '2026-09-07', digestion: ['nausea'] }], ['2026-09-20', { date: '2026-09-20', symptoms: ['headache'] }]]), prediction, eligibility: eligible }

describe('calendarDayMarks', () => {
  it('tints follicular and luteal days and marks days with symptoms', () => {
    expect(calendarDayMarks('2026-09-07', ctx)).toMatchObject({ phase: 'follicular', hasSymptoms: true })
    expect(calendarDayMarks('2026-09-07', ctx).classes).toEqual(expect.arrayContaining(['phase-follicular', 'has-symptoms']))
    expect(calendarDayMarks('2026-09-20', ctx).classes).toEqual(expect.arrayContaining(['phase-luteal', 'has-symptoms']))
    expect(calendarDayMarks('2026-09-12', ctx).classes).toContain('fertile')
    expect(calendarDayMarks('2026-09-01', ctx).classes).toContain('period')
    expect(calendarDayMarks('2026-09-08', ctx).hasSymptoms).toBe(false)
  })
  it('adds no phase tint when fertility estimates are not eligible', () => {
    const r = calendarDayMarks('2026-09-20', { ...ctx, eligibility: { ...eligible, fertileWindow: false, ovulationForecast: false } })
    expect(r.classes.some((c) => c.startsWith('phase-'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails, implement, wire into CalendarScreen, run to verify it passes**

Run: `cd app && npx vitest run src/components/calendarDays.test.ts && npx tsc --noEmit && npx vite build`.

- [ ] **Step 3: Docs**

README feature list: "Tracks your cycle phase (period, follicular, fertile window, ovulation estimate, luteal) and lets you note symptoms such as nausea or diarrhea on any day; the calendar shows phases and which days have notes."

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Show phases and symptom days on the calendar"
```
