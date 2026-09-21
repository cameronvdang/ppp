> Written when the product was named Lunara; the product is now PPP.

# Lunara research synthesis

Updated: 2026-07-26

## Executive conclusion

The 52 supplied Flo screenshots are a useful observation set, not a complete
product specification. They show one onboarding route, a subset of the tracker,
several Today states, an assistant prompt, and one paywall experiment. They do
not reveal every branch, the longitudinal data model, prediction weights,
medical-review process, native permission behavior, entitlement rules, or
proprietary content.

Lunara therefore targets **independent product-depth equivalence**, not literal
Flo parity. The implementation combines:

- the observed interaction and information needs from the screenshots;
- current official Flo product documentation;
- public clinical and platform guidance;
- transparent, deterministic local algorithms;
- original Lunara visual language, copy, illustrations, and icons.

The earlier recommendation to reduce onboarding to five generic screens was
incorrect for this product. A health tracker needs enough structured context to
decide which forecasts are appropriate, which questions should appear, and
which safety boundaries should be visible. Lunara now uses a modular adaptive
onboarding graph: short when an answer makes a branch irrelevant, deeper when
the selected goal or health context needs more information.

For the screenshot-by-screenshot inventory, see
[SCREENSHOT_ONBOARDING_AUDIT.md](./SCREENSHOT_ONBOARDING_AUDIT.md). For the
larger behavioral audit, see
[BEYOND_SCREEN_GAP_AUDIT.md](./BEYOND_SCREEN_GAP_AUDIT.md).

## Evidence model

Research findings are labeled by strength:

- **Official observed** — a current Flo, Apple, Android, ACOG, ASRM, FDA, or
  other primary source states the behavior or guidance.
- **Screenshot observed** — directly visible in one of the 52 supplied images.
- **Repository observed** — implemented in this Lunara repository.
- **Inference** — a requirement inferred from the observed product behavior,
  but not proof of Flo's private implementation.
- **Proprietary or unknown** — not recoverable from public evidence.

Screenshots are evidence of a state, not proof of the rule that produced that
state. Marketing statements establish available capabilities, not medical
equivalence or an internal algorithm.

## What the public evidence establishes

### The product is stateful, not a set of static screens

Flo's official documentation describes a main surface that changes with the
selected date and reproductive state, plus a calendar, tracker, reports,
educational content, reminders, and an event-triggered assistant. It also says
the tracker can capture more than 80 signals
([How do I use the app?](https://help.flo.health/hc/en-us/articles/360014347632-How-do-I-use-the-app),
[main screen](https://help.flo.health/hc/en-us/articles/4401756146452-What-can-I-find-on-the-main-screen)).

That implies a shared state model:

1. durable profile and consent context;
2. dated self-reported and imported observations;
3. deterministic prediction and policy layers;
4. Today/calendar renderers;
5. longitudinal reports and event-triggered education;
6. native permissions, reminders, security, and sharing.

Lunara follows this topology. It does not implement the screenshots as isolated
mock screens.

### Onboarding must branch

The observed onboarding collects identity, age, goals, cycle history,
contraception, conditions, symptoms, mental health, sexual wellbeing, activity,
wearables, biometrics, sleep, and permissions. The next question changes with
earlier choices. Official pregnancy and TTC material describe different inputs
and downstream experiences
([pregnancy mode](https://help.flo.health/hc/en-us/articles/360054523711-What-is-Pregnancy-mode-and-how-do-I-activate-it),
[trying to conceive](https://help.flo.health/hc/en-us/articles/360015329751-How-do-I-get-pregnant)).

The correct design is a versioned state machine, not a fixed short funnel and
not a forced 52-screen replica. Every question needs:

- a documented purpose;
- a typed answer or an explicit unknown/prefer-not-to-answer state;
- a branch rule;
- a downstream consumer;
- edit and migration behavior;
- safety and privacy treatment.

The current design is documented in
[ADAPTIVE_ONBOARDING_ARCHITECTURE.md](./ADAPTIVE_ONBOARDING_ARCHITECTURE.md).

### Logging depth drives every downstream feature

The supplied tracker screenshots reveal flow, symptoms, mood, discharge,
sexual activity and sex drive, digestion, pregnancy and ovulation tests,
medications, water, weight, BBT, lifestyle events, exercise, and notes.
Official product documentation confirms a broad, customizable tracker
([How do I use the app?](https://help.flo.health/hc/en-us/articles/360014347632-How-do-I-use-the-app)).

Lunara consequently treats each saved day as a structured observation. It also
distinguishes:

- an untouched day;
- a partially logged day;
- a check-in the user explicitly marked complete.

This distinction prevents a missing day from being misclassified as a
symptom-free day in phase comparisons.

### Reports require longitudinal evidence and methodology

Flo documents cycle and symptom analytics, including reports intended for
review with a clinician
([Analyzing your cycles and symptoms](https://help.flo.health/hc/en-us/articles/4407228784276-Analyzing-your-cycles-and-symptoms)).

An independent equivalent needs more than a chart. Lunara reports expose:

- six- and twelve-completed-cycle windows;
- sample size, range, median/average, and descriptive trend;
- bleeding episodes derived only from logged flow dates;
- any-entry and explicit-complete-check-in coverage;
- complete-check-in-only symptom/phase associations;
- BBT and OPK as observations, not confirmation;
- methodology and limitations;
- opt-in inclusion for mental-health, sexual-health, and fertility-test
  sections in a doctor summary.

### Contraception changes forecast eligibility

Flo's official guidance says hormonal-contraception settings can remove
ovulation and fertile-window predictions
([birth-control logging](https://help.flo.health/hc/en-us/articles/360015106292-How-do-I-log-my-birth-control-method)).

Lunara applies the same safety principle independently: it can keep bleeding
and adherence tracking available while suppressing forecasts that would be
misleading in that context. A future regimen model still needs method history,
pack/change schedules, missed-dose states, and dated start/stop transitions.

### Privacy is a product behavior

Account deletion, restore, export, and anonymous identity are separate product
capabilities in Flo's public documentation
([account deletion and Anonymous Mode](https://help.flo.health/hc/en-us/articles/360042567131-How-can-I-delete-my-account),
[account restore](https://help.flo.health/hc/en-us/articles/360015054351-How-can-I-sign-in-and-restore-my-data)).

Lunara deliberately starts from a different architecture:

- no account is required for core tracking;
- profile and logs remain device-owned;
- AI, health import, notifications, and backup are separate opt-ins;
- cloud backup, when enabled, transports an opaque client-encrypted blob;
- local deletion and export do not depend on a Lunara account.

This does not make native WebView storage encrypted at rest. Migrating the core
database to encrypted native SQLite remains a release blocker.

## Prediction and medical-research direction

### Cycle forecasting

A point estimate must never be presented as certainty or a contraceptive
answer. Public research shows substantial within- and between-person cycle
variation; a universal 28-day assumption is inadequate
([Bull et al., *npj Digital Medicine*](https://www.nature.com/articles/s41746-019-0152-7)).
Independent evaluations also show that calendar-app prediction accuracy can be
limited
([period-tracker prediction study](https://pmc.ncbi.nlm.nih.gov/articles/PMC8504278/)).

The current Lunara forecast therefore:

- uses recent completed cycle starts;
- uses a robust median rather than a simple all-history average;
- reports a range derived from recent residual variation;
- exposes excluded implausible data intervals as data-quality exclusions;
- treats OPK as suggestive evidence;
- treats a sustained BBT shift as retrospective evidence;
- keeps the prediction-policy layer separate so pregnancy, hormonal
  contraception, irregular cycles, PCOS context, and perimenopause can
  suppress or widen the result.

The fertile window is educational timing context, not a probability or safe-day
claim. ASRM describes the fertile interval as the six-day interval ending on
the day of ovulation
([ASRM, optimizing natural fertility](https://www.asrm.org/practice-guidance/practice-committee-documents/optimizing-natural-fertility-a-committee-opinion-2021/)).

### Pregnancy dating

Pregnancy dating must preserve the source and authority of a date. Lunara
supports clinician-assigned EDD, LMP, conception, and day-3/day-5 embryo
transfer inputs. Calculated results remain visibly provisional; a
clinician-assigned date takes precedence. This follows the general principle
that the estimated due date should be established and documented from the best
available clinical information
([ACOG, Methods for Estimating the Due Date](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date)).

### Pregnancy and ovulation tests

User-entered test results are observations. A faint, negative, or positive home
pregnancy test is not interpreted as a diagnosis, and test timing and product
limitations matter
([FDA, Pregnancy](https://www.fda.gov/medical-devices/home-use-tests/pregnancy)).

### Safety routing

Lunara has deterministic rules for a small set of explicit warning-sign
combinations. The rules return routine, same-day, or emergency guidance with
source identifiers. They are deliberately non-diagnostic and do not treat a
no-match result as reassurance.

This is a safety net, not the excluded Symptom Checker. Production release
still requires clinician review, content governance, adversarial testing, and
localized emergency-resource handling.

## Native and local feasibility

The shipping target is a Capacitor iOS/Android app. React and TypeScript own the
shared UI and deterministic engines; Swift and Android native code expose
narrow bridges for Keychain/Keystore, biometrics, HealthKit/Health Connect, and
widgets. Capacitor local notifications provide device scheduling.

Apple and Android health repositories remain permission-controlled platform
services
([HealthKit](https://developer.apple.com/documentation/healthkit),
[Health Connect](https://developer.android.com/health-and-fitness/health-connect)).
Code can be built locally, but real permission, background-delivery, biometric,
and widget behavior must be verified on physical devices.

See the [web design spec](./superpowers/specs/2026-09-10-lunara-web-finchnode-design.md) and
[WEB_CAPABILITY_BOUNDARY.md](./WEB_CAPABILITY_BOUNDARY.md) for the detailed
boundary.

## Product and visual direction

The screenshots establish useful interaction principles:

- one dominant Today answer with date/phase context;
- a horizontally scannable date strip and insight rail;
- dense logging that still feels approachable;
- responsive selected states and explanation-on-selection;
- staged onboarding with visible progress;
- just-in-time permission education.

Lunara should match that level of clarity and polish while remaining visibly
original. It must not redistribute or imitate Flo's logo, name, illustrations,
copy, paid content, icon set, or proprietary trade dress. The target is:

> Comparable ease, depth, and responsiveness through an original Lunara design.

System typography, accessible controls, original art, distinct color tokens,
reduced-motion behavior, dynamic type, and real-device visual QA are part of
the release standard.

## Explicit scope

Included:

- cycle tracking and explainable forecasts;
- TTC support;
- pregnancy tracking;
- perimenopause tracking;
- deep structured logging;
- trends, reports, reminders, native integrations, privacy controls;
- optional AI assistant.

Deliberately excluded:

- Secret Chats/community;
- partner sharing;
- Symptom Checker;
- Guided Journey.

These exclusions are product decisions, not undiscovered gaps.

## What cannot be recovered from public research

Public screens and help pages cannot establish:

- Flo's production prediction weights, training data, calibration, or private
  feature flags;
- the formula and validation behind proprietary scores;
- private medical/editorial corpora and reviewer workflow;
- experiment assignment, regional entitlement rules, or full analytics;
- licensed media, artwork source files, animation rigs, or production design
  tokens;
- production reliability, security controls, or private incident history.

Lunara can build and validate independent equivalents. It cannot truthfully
claim to reproduce those private systems or to be medically equivalent because
the UI looks similar.

## Primary source register

### Flo product behavior

- [How do I use the app?](https://help.flo.health/hc/en-us/articles/360014347632-How-do-I-use-the-app)
- [What can I find on the main screen?](https://help.flo.health/hc/en-us/articles/4401756146452-What-can-I-find-on-the-main-screen)
- [Checking cycle predictions](https://help.flo.health/hc/en-us/articles/4406826523284-Checking-your-cycle-predictions)
- [Analyzing cycles and symptoms](https://help.flo.health/hc/en-us/articles/4407228784276-Analyzing-your-cycles-and-symptoms)
- [What is included in Flo Premium?](https://help.flo.health/hc/en-us/articles/360042141812-What-is-included-in-Flo-Premium)
- [Trying Flo Premium](https://help.flo.health/hc/en-us/articles/4407228743956-Trying-Flo-Premium)
- [Pregnancy mode](https://help.flo.health/hc/en-us/articles/360054523711-What-is-Pregnancy-mode-and-how-do-I-activate-it)
- [Trying to conceive](https://help.flo.health/hc/en-us/articles/360015329751-How-do-I-get-pregnant)
- [Birth-control logging](https://help.flo.health/hc/en-us/articles/360015106292-How-do-I-log-my-birth-control-method)
- [Apple Health import](https://help.flo.health/hc/en-us/articles/34890229122068-How-to-import-data-from-the-Health-app-to-Flo-iOS)
- [Account deletion and Anonymous Mode](https://help.flo.health/hc/en-us/articles/360042567131-How-can-I-delete-my-account)
- [Account restore](https://help.flo.health/hc/en-us/articles/360015054351-How-can-I-sign-in-and-restore-my-data)

### Clinical and platform guidance

- [ACOG: Methods for Estimating the Due Date](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2017/05/methods-for-estimating-the-due-date)
- [ASRM: Optimizing natural fertility](https://www.asrm.org/practice-guidance/practice-committee-documents/optimizing-natural-fertility-a-committee-opinion-2021/)
- [ACOG: Abnormal uterine bleeding](https://www.acog.org/womens-health/faqs/abnormal-uterine-bleeding)
- [CDC: Combined hormonal contraceptives](https://www.cdc.gov/contraception/hcp/usspr/combined-hormonal-contraceptives.html)
- [FDA: Home-use pregnancy tests](https://www.fda.gov/medical-devices/home-use-tests/pregnancy)
- [Apple HealthKit](https://developer.apple.com/documentation/healthkit)
- [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect)
