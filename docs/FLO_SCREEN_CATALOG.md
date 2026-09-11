> Written when the product was named Lunara; the product is now PPP.

# Flo reference-screen catalog

This catalog records public evidence for product structure and interaction
research. References may inform hierarchy, flow, state coverage and usability.
Lunara must not redistribute or trace Flo illustrations, icons, copy, video, or
other expressive assets.

## Evidence confidence

- **A — official current:** Flo product/help pages or current store listing.
- **B — official older:** Flo engineering/help material whose structure remains
  useful but whose pixels must be rechecked.
- **C — third-party capture:** useful for locating states; verify in a live app.
- **D — missing:** capture manually from a current installed app.

## Screen inventory

| Area | Known states | Evidence | Remaining capture |
|---|---|---:|---|
| Today / cycle | period, fertile, ovulation, luteal, delay, insufficient data | A | gestures, loading, errors |
| Date strip / ring | day swipe, week swipe, countdown changes | A/B | motion timing, overscroll |
| Daily log | 16 trackers, selected/unselected, editing categories | A/C | complete current taxonomy |
| Calendar | month, predicted period, fertile, ovulation, edit period | A/C | year view, delay state |
| My cycles | history, ACOG ranges, last-cycle widgets | A/B | every drill-down |
| Graphs/reports | cycle length, period intensity, event graphs, body patterns | A/C | empty/error/export states |
| Doctor report | report preview and print/share | A/C | current six-month layout |
| Insights | categories, article, video/audio/course, saved | A | search and playback states |
| Assistant | inbox, triggered dialogue, conversation, cycle report | A | current full conversation IA |
| TTC | fertile-day guidance, BBT chart, OPK, test timing | A | all daily states |
| Pregnancy | hero, fetus, week details, checklist, FAQ, settings | A | every week visual |
| Perimenopause | score, checker, timeline, relief options | A | full released flows |
| Settings | goal, app, lock, cycle, reminders, export | A/C | detailed subsettings |
| Onboarding | goal-specific branches | C | current branch-by-branch capture |

## User-supplied visual references — 2026-07-26

Four public-facing captures were supplied for targeted content-architecture
comparison:

- `10730-track cycle and symptoms.avif` — period Today state
- `10733-day of ovulation.avif` — estimated ovulation Today state
- `10734-follow pregnancy.avif` — pregnancy Today state
- `11581-Web Image-Peri.avif` — perimenopause result state

Implemented from those references:

- Monday–Sunday date strip with logged-period, fertile-window, estimated
  ovulation, and today markers.
- Shared Today hierarchy: date strip → phase-specific hero → daily insight rail
  → phase education.
- Rose period, mineral-teal fertility, apricot pregnancy, and deep-plum
  perimenopause visual states using original Lunara geometry.
- Pregnancy gestational age as the dominant label, with due date secondary and
  cards for symptoms, body changes, development, and checklist.
- Perimenopause result-first hierarchy with a current non-diagnostic score,
  update-check-in action, individual recent symptoms, then domains and
  longitudinal patterns.

Flo’s logo, fetus illustration, icons, wording, navigation-only features, and
other expressive assets were not copied.

## Public sources

1. Flo Help, “What can I find on the main screen?” (updated March 2026)
   <https://help.flo.health/hc/en-us/articles/4401756146452>
2. Flo Help, “How do I use the app?” (updated December 2025)
   <https://help.flo.health/hc/en-us/articles/360014347632-How-do-I-use-the-app->
3. Flo Help, “Logging your symptoms”
   <https://help.flo.health/hc/en-us/articles/4406826542740-Logging-your-symptoms>
4. Flo cycle tracking product tour
   <https://flo.health/product-tour/tracking-cycle>
5. Flo pregnancy product tour
   <https://flo.health/product-tour/pregnancy-app>
6. Flo TTC product tour
   <https://flo.health/product-tour/ovulation-tracker>
7. Flo Premium comparison
   <https://flo.health/flo-premium>
8. Flo perimenopause launch, May 2026
   <https://flo.health/newsroom/the-perimenopause-conversation-has-arrived-but-clarity-has-not-flo-health-aims-to-change-that>
9. Current Google Play listing, including Wear OS and current feature claims
   <https://play.google.com/store/apps/details?id=org.iggymedia.periodtracker>
10. Flo engineering, cycle-widget evolution
    <https://medium.com/flo-health/how-we-evolved-and-enriched-the-main-screen-of-the-flo-app-part-2-cycle-widgets-b73d5ccb948d>

## Manual capture protocol

Capture from a current installed version using a synthetic persona—never real
health history.

For each screen:

1. Record platform, app version, date, mode and subscription tier.
2. Capture full screen plus a short motion recording.
3. Record navigation path and required data state.
4. Note hierarchy, spacing ratios, interaction, animation and accessibility.
5. Do not extract or ship proprietary assets.
6. Add the state to the inventory above and link the local reference location.

Priority manual gaps:

1. All current perimenopause flows.
2. Full symptom-picker taxonomy and category editing.
3. Symptom patterns and prediction explanations.
4. Pregnancy week detail, checklist and settings.
5. Assistant-trigger rules and cycle reports.
