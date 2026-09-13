# Task 17 implementation report

Implemented section 13 and the Task 17 rewrite table on `feat/web-app-finchnode`.
Changes are presentation copy, markup, CSS, and the corresponding copy tests. Event handlers,
calculations, persistence, network requests, consent controls, and data flow are unchanged.
No push was performed. The commit uses the writable scratch clone and the requested
`Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.

The table's prescribed strings are applied. The extra rewrites below cover matching patterns
that the table did not name. Repeated navigation glyph removals and missing-value substitutions
are grouped. Literal arrows and em dashes in this report quote the original UI; they are not UI copy.

## Rewrites beyond the table

| Surface | Before → after |
| --- | --- |
| Today, stale history | “Let’s pick this back up” → “Add your latest period”; the paused-estimates explanation remains. |
| Today, pregnancy hero | “Your pregnancy” above “N weeks, D days” → “Pregnancy: N weeks, D days”. Dating source and provisional/clinician status move into the existing trimester/due-date paragraph. |
| Today, selected historical day | “My daily insights · DATE” → “Insights for DATE”; today's view uses the exact “Today's insights” heading. |
| Today, pregnancy insight cards | “Pregnancy timeline”, “Estimated due date”/“Due date”, and “Your daily log” labels → sentence-case h3 headings with their values and details retained. |
| Today, pregnancy week fallback | “Growing steadily, one quiet day at a time.” → “No week guide available.” |
| Today, symptom card | “No pattern yet” → “No patterns yet.”; the two-cycle complete-check-in requirement remains. |
| Today, forecast card | “Prediction basis” above the forecast state → removed; state, reason and estimated date range remain. “Some forecasts are responsibly paused” → “Some forecasts are paused”; “Waiting for real cycle history” → “More cycle history needed”. |
| Today, midlife summary | “Ready for your first check-in” → “No scored symptoms in the past 28 days.”; “Your recent pattern is ready to review” → “View your logged symptoms.” The score and calculation note remain. |
| Today, reading card | “Understand your fertile window” plus “Spot the signals that can add context to a calendar estimate.” → “Learn which signals add context to your estimated fertile window.” |
| Today, reading card | “Understand midlife changes” plus “Track changes month to month without turning a pattern into a diagnosis.” → “Track midlife changes month to month; patterns are not a diagnosis.” |
| Today, reading card | “Learn what may be changing — and what can vary from person to person.” → “Learn what may change during your cycle and vary from person to person.” |
| Today, estimate placement | Estimate and uncertainty inside the CTA → plain hero body text; CTA is “What this means”. Fertile-window ovulation countdowns remain in the body. Follicular/luteal bodies include the cycle day and next-period estimate; TTC ovulation timing is also retained. |
| Today, accessible hero name | Separate phase label plus title → title plus body, followed by the unchanged swipe instruction; phase name and cycle-day information remain available. |
| Insights search | “Library search” label and “Nothing matched yet” → “No matching articles”; “Try a broader word, or ask PPP AI without sharing tracker data.” → “Try another search, or ask PPP AI without sharing tracker data.” |
| Trends chart headings | “Cycle length / One cycle at a time” → “Cycle length”; “Bleeding / Logged episode length” → “Logged bleeding episode length”; “Symptoms / What shows up most” → “Most logged symptoms”. |
| Trends chart headings | “Symptoms by phase / Complete check-ins only” → “Symptoms by phase (complete check-ins only)”; “Basal temperature / Your latest readings” → “Basal temperature”. |
| Trends completeness | “Data completeness · 90 days” above “N% complete” → “Data completeness: N% over 90 days”. All counts and methodology remain. |
| Trends instructions | Flow-logging guidance moves from the empty state to the chart heading area, unchanged. “Measure after waking, before getting up, for a more readable pattern.” → “Measure after waking, before getting up.” above the chart. |
| Settings statuses | “reorder & hide ›” → “Reorder & hide”; “Available ›” → “Available”; “add dating source first” → “Add dating source first”; standalone pregnancy-detail “›” → “Open”. |
| Settings key statuses | “Anthropic connected ›” → “Anthropic connected”; “add Anthropic key ›” → “Add Anthropic key”; “OpenAI key secured ›” → “OpenAI key secured”; “add OpenAI key ›” → “Add OpenAI key”. |
| Settings PIN | “On — tap to remove” → “On. Tap to remove”. |
| Settings recovery alert | “Your recovery code — write it down, it is shown only once:” → “Your recovery code. Write it down; it is shown only once:”. Code and recovery warning remain. |
| Settings reminder count | “N active” heading → plain “N active” count; inactive state → “No active reminders”, under the “Reminders” group heading. |
| Settings footer | “Clearing browser storage deletes local history — keep an encrypted backup.” → “Clearing browser storage deletes local history. Keep an encrypted backup.” All other footer facts remain unchanged. |
| Onboarding chapter banners | “Chapter 1 / How your cycle is shaped” and “Chapter 2 / Choose what deserves space” → removed; the actual step number and total remain. |
| Onboarding pregnancy banner | “Pregnancy mode / Start with a provisional timeline” → “Start with a provisional pregnancy timeline.” as plain text. |
| Onboarding period history | “Add up to three true period starts—not spotting. Fewer dates are completely fine.” → “Add up to three period starts, excluding spotting. Fewer dates are fine.” |
| Onboarding paused forecast | “Not a failure—this is the medically honest state for this context.” → “Estimates are paused for this context.” |
| Onboarding dating source | “PPP preserves the source instead of quietly treating every pregnancy as LMP-dated.” → “PPP keeps your selected dating source instead of assuming the date of your last period.” |
| Onboarding context punctuation | “prompts—not to label infertility”, “missing—not as a symptom-free day”, “tailor caution—not as a diagnosis” → the same facts separated by commas. |
| Onboarding summary | “NAME setup is ready to learn.” → “NAME setup summary”; “Baseline assembled on this device” and “No mystery score and no pretend diagnosis. Every active or paused feature has a reason.” → “Review which features are active or paused and why; this summary was assembled on this device.” |
| Onboarding AI chapter | “Optional companion” → “Optional assistant”; the existing explanation that core tracking works without AI remains. |
| Onboarding final review | “Ready to notice what changes.” → “Review your setup.”; “I’ll use estimates as context—not contraception or diagnosis.” → “I’ll use estimates as context, not contraception or diagnosis.” |
| Onboarding movement | Decorative movement/energy arrow icons and the wearable-permission arrow → removed; labels, questions, answers and permission explanation remain. |
| TTC detail | Date kicker → date before the existing rationale. “TODAY” → “Today”. “Pregnancy-test timing / Calendar marker: DATE” → “Pregnancy-test calendar marker: DATE”; “No test date yet” → “No pregnancy-test date yet”. |
| Midlife detail | “Past 28 days” label plus introductory copy → “Your log shows temperature, sleep, focus, mood, and body changes over the past 28 days.” |
| Midlife detail | “Current summary” label removed; “Ready for your first check-in” → “No check-ins logged yet.”; “Your logged pattern is ready” → “Current symptom summary”; “Add symptoms on a few days to create a personal, descriptive baseline.” → “Log symptoms to create a baseline.” |
| Pregnancy detail | Trimester kicker → trimester in the due-date paragraph. “Your body” → h2 group heading. “Quick answers / Questions that deserve calm answers.” → “Questions and answers.” |
| Health sources | “Sources” and “Reviewed sources” kicker-only blocks → h2 group headings; all source links and accompanying information remain. |
| Cycle report | “Generated DATE” kicker → plain paragraph below the existing h1. “No completed cycle yet” → “No completed cycles yet.”; “No flow episodes logged yet” → “No flow logged yet.”; “No repeatable pattern yet” → “No patterns yet.” |
| Cycle report | “Log a flow level on each bleeding day to make this summary useful.” → “Log a flow level on each bleeding day.” The pattern threshold remains: at least three entries across two completed cycles. |
| Cycle report | “Symptoms, moods, and events will appear here after you log them.” → “No symptoms, moods, or events logged yet.” |
| Cycle report appointment note | “Bring the original dates and details—not only this summary—to a healthcare appointment.” → “Bring this summary and the original dates and details to a healthcare appointment.” |
| Log sheet | Check-in coverage, Flow, Symptoms, Mood, Discharge, Sex & drive, Fertility, Digestion, Movement, Daily context, dynamic tracker groups, and Daily measurements labels → h2 group headings. |
| Log sheet copy | “Mark this after you have reviewed today—even if nothing needs logging.” → “Mark this after you have reviewed today, even if nothing needs logging.”; “Context for your own patterns—not a medical conclusion” → “Context for your own patterns, not a medical conclusion”. |
| Startup error | “Startup interrupted” kicker → removed; the error heading and recovery actions remain. |
| Assistant | “Private companion”, “Connection”, and “Private by design” labels → removed; “Preparing your private space…” → “Loading assistant…”; “What would you like to understand?” → “No messages yet.” The general-question/sharing instructions remain. |
| Cycle ring | “Period may be / N / day(s) late” → “N / day(s) past the period estimate”; “Period in / N / day(s)” → “N / day(s) until the estimated period”. “Your rhythm, made visible” → “No cycle estimate yet.” Date-entry instruction, cycle day and accessible announcement remain. |
| Missing metrics | “—” in Trends, cycle reports and doctor reports → “Not available”. |
| Privacy table, default column | “—” for the never-sent row → “Not applicable”; its sent-content column uses the table-prescribed “Nothing”. All destinations, conditions and content remain. |
| Provider record report | Em-dash separators between name, status, date and source → middle-dot separators; no field removed. |
| Article disclaimer | “Educational content only — not medical advice.” → “Educational content only, not medical advice.” Clinician sentence remains. |
| Shared reminder body | “A gentle moment to check in with yourself.” → “Your reminder is due.” in both the daily notification and private-preview reminder copy. |
| Pregnancy week summaries | “Week N — FACT” → “Week N: FACT” for all 41 entries; all development facts remain. The detail screen removes the corresponding new prefix, preserving its prior display behavior. |
| README | “perimenopause companion” → “perimenopause app”; “AI companion” → “AI assistant”. |
| Navigation and links | Decorative trailing →, ↗ and › removed. Icon-only previous/next/back and export controls use SVG icons, retaining their accessible labels and handlers. |

The installation card's offline/full-screen/device-storage sentence carries facts and is retained.
The welcome triad and duplicate footnote are removed as specified; consent sentences remain,
and the “PPP principles” accessibility label moves to the remaining welcome content group.
Other educational limits, phase information, privacy-table content and source links remain.

The shared article copy also displayed the banned patterns. These are its exact changed paragraphs:

| Before | After |
| --- | --- |
| Your cycle starts on the first day of your period. During the menstrual phase the uterine lining sheds — for most people this lasts three to seven days. | Your cycle starts on the first day of your period. During the menstrual phase the uterine lining sheds; for most people this lasts three to seven days. |
| Ovulation is the release of an egg, typically midway through the cycle — but "typically" hides huge variation. The egg lives about a day; sperm can wait up to five, which is why the fertile window opens well before ovulation itself. | Ovulation is the release of an egg, typically midway through the cycle, but "typically" hides huge variation. The egg lives about a day; sperm can wait up to five, which is why the fertile window opens well before ovulation itself. |
| Knowing which phase you are in explains a lot — and logging is how PPP learns your version of it, not the textbook one. | Knowing which phase you are in explains a lot, and logging is how PPP learns your version of it, not the textbook one. |
| That is why PPP shows an uncertainty band around predictions and never pretends to day-perfect accuracy — anyone who does is guessing with confidence. | That is why PPP shows an uncertainty band around predictions and never pretends to day-perfect accuracy; anyone who does is guessing with confidence. |
| Menstrual cramps come from prostaglandins — compounds that make the uterus contract to shed its lining. More prostaglandins usually means stronger cramps. | Menstrual cramps come from prostaglandins, compounds that make the uterus contract to shed its lining. More prostaglandins usually means stronger cramps. |
| Heat genuinely helps: a heating pad or warm bath relaxes the muscle. Gentle movement — a walk, light stretching — often does more than staying still. | Heat genuinely helps: a heating pad or warm bath relaxes the muscle. Light movement, such as a walk or stretching, often does more than staying still. |
| Cramps that derail your life, resist medication, or worsen over time deserve a medical conversation — severe pain is common, but it is not something you owe anyone. | Cramps that derail your life, resist medication, or worsen over time deserve a medical conversation; severe pain is common, but it is not something you owe anyone. |
| Estimates are estimates. Do not use any app — this one included — as contraception. If avoiding pregnancy matters to you, use a method designed for it. | Estimates are estimates. Do not use any app, including this one, as contraception. If avoiding pregnancy matters to you, use a method designed for it. |
| Log it in PPP and the chart draws itself — look for the sustained shift, not any single reading. Alcohol, illness, and short sleep all nudge the numbers. | Log it in PPP and the chart draws itself; look for the sustained shift, not any single reading. Alcohol, illness, and short sleep all nudge the numbers. |
| Perimenopause is the years-long runway to menopause, often starting in the mid-40s, sometimes earlier. Hormones do not decline smoothly — they oscillate, and symptoms follow. | Perimenopause is the years-long runway to menopause, often starting in the mid-40s, sometimes earlier. Hormones do not decline smoothly; they oscillate, and symptoms follow. |
| Hot flashes, night sweats, sleep trouble, mood swings, and brain fog are frequent companions. They are real, physiological, and worth tracking — patterns you can show a clinician get taken more seriously than vibes. | Hot flashes, night sweats, sleep trouble, mood swings, and brain fog are common symptoms. They are real, physiological, and worth tracking; patterns you can show a clinician get taken more seriously than vibes. |
| Pregnancy is counted from the first day of your last period — about 40 weeks in total, though full term spans weeks 37 to 42. | Pregnancy is counted from the first day of your last period, about 40 weeks in total, though full term spans weeks 37 to 42. |
| The second (weeks 13–27) is usually the easiest stretch — energy returns, movement becomes noticeable, and the anatomy scan lands around week 20. | The second (weeks 13–27) is usually the easiest stretch; energy returns, movement becomes noticeable, and the anatomy scan lands around week 20. |
| PPP tracks your week and due date on-device. Prenatal care is irreplaceable — the app is a companion, not a substitute. | PPP tracks your week and due date on-device. The app does not replace prenatal care. |

## CSS rules removed

Removed all definitions and responsive variants for the deleted labels, counts, welcome proof row,
decorative arrows, and chapter/summary captions. Exact selectors removed from rules are listed below;
when a selector shared a rule with a surviving element, the surviving selector and its applicable styles remain.

- `assistant.css`: `.assistant-empty-kicker`, `.assistant-kicker`, `.assistant-setup-intro .eyebrow`.
- `health-import.css`: `.page.onboarding .ob-health-import-copy .eyebrow`.
- `app.css`: `.article-open b`, `.assistant-feature-arrow`, `.assistant-feature-arrow svg`, `.assistant-feature-kicker`, `.collection-count`, `.cycle-ring-kicker`, `.daily-heading h2`, `.daily-heading-when`, `.daily-insight-tile > i`, `.eyebrow`, `.insight-section-heading .section-overline`, `.ob-analysis-hero > span`, `.ob-chapter-band > div`, `.ob-chapter-band > div > span`, `.ob-chapter-band strong`, `.ob-hero-label`, `.ob-legal`, `.ob-proof-row`, `.ob-proof-row > span`, `.ob-proof-row small`, `.ob-proof-row strong`, `.onboarding .eyebrow`, `.onboarding-finish .eyebrow`, `.onboarding-sleep .eyebrow`, `.page-kicker`, `.page-title-block .page-kicker`, `.page.onboarding .eyebrow`, `.page.onboarding .ob-analysis-hero > span`, `.page.onboarding .ob-chapter-band > div`, `.page.onboarding .ob-chapter-band > div > span`, `.page.onboarding .ob-chapter-band strong`, `.page.onboarding .ob-hero-label`, `.page.onboarding .ob-legal`, `.page.onboarding .ob-proof-row`, `.page.onboarding .ob-proof-row > span`, `.page.onboarding .ob-proof-row > span:last-child`, `.page.onboarding .ob-proof-row small`, `.page.onboarding .ob-proof-row strong`, `.page.onboarding-finish .eyebrow`, `.page.onboarding-sleep .eyebrow`, `.peri-score-copy strong`, `.phase-detail-link span`, `.phase-eyebrow`, `.phase-reading-card b`, `.prediction-basis-card > i`, `.prediction-basis-card small`, `.prediction-basis-card.evidence-baseline-calendar .prediction-basis-glyph`, `.prediction-basis-card.evidence-insufficient .prediction-basis-glyph`, `.prediction-basis-card.evidence-suppressed .prediction-basis-glyph`, `.prediction-basis-glyph`, `.pregnancy-kicker`, `.reminder-console-heading h3`, `.reminder-kicker`, `.report-arrow`, `.report-copy > span`, `.section-label`, `.section-overline`, `.story-count`, `.story-eyebrow`, `.today-page .phase-detail-link span`, `.today-page .phase-eyebrow`.
- `health.css`: `.health-kicker`, `.peri-result-hero .health-kicker`.

Also removed all forced uppercase declarations, positive label tracking, the report capitalization
rule, and `--tracking-label` from `tokens.css`. Single-letter weekday characters remain intact.
`mobile.css` and `desktop.css` already contained no offending declarations and needed no edits.

Added `.group-title` with 15px type, weight 600, ink-900, and `22px 0 8px` margin.
General page, overlay, section and Records h2 selectors exclude `.group-title` so they cannot override it.
Insight titles now style h3 elements in sentence case. Removed unused grid columns for the arrows in
forecast, report and quiet-hours blocks. The hero CTA is a text action; the AI card displays “Open”.

## Tests updated

- `app/src/screens/Today.test.ts`: updated the four existing cases for follicular, period-run,
  fertile-window and ovulation headings, including cycle-day and period instruction assertions.
- `app/src/copyGuard.test.ts`: retained jargon and 20-word/24-word consent checks; added class,
  decorative-copy, and uppercase/tracking checks. The decoration scan also covers shared educational
  content and reminder bodies. Known taglines and welcome-triad class names are guarded.
- Added a guard regression for glyph-only JSX, literal branches, accessible attributes and named/numeric HTML entities.
- Settings and the report/privacy/notification tests did not assert the replaced copy and passed unchanged.
  No existing Insights or Graphs string-assertion test files required updating.
- A one-time TypeScript AST comparison found no event-handler changes. Every existing accessibility
  label is retained; Today's phase label is reworded to include the new heading and body.

## Verification

All five guard categories pass with empty offender lists: jargon `[]`, sentence length `[]`,
banned classes `[]`, decorative copy `[]`, and uppercase/tracking `[]` (including inline styles).
The copy-guard file has eight passing tests, including its parser regression cases.

Final required command output is recorded below.

`pnpm --filter @ppp/app test`:

```text
 Test Files  61 passed (61)
      Tests  594 passed (594)
   Start at  18:34:22
   Duration  5.44s (transform 2.15s, setup 0ms, collect 7.46s, tests 10.94s, environment 6ms, prepare 2.89s)
```

`cd app && npx tsc --noEmit`:

```text
(no diagnostics)
tsc exit code: 0
```

`cd app && npx vite build && node scripts/check-chunks.mjs`:

```text
✓ built in 871ms

PWA v1.3.0
mode      generateSW
precache  43 entries (1186.86 KiB)
files generated
  dist/sw.js
  dist/workbox-abeb32eb.js
all chunks under 500 kB
```

Vite emitted browser-externalization warnings for Node modules in the Anthropic SDK; build and chunk checks exited successfully.
`git diff --check` also passed.
