# Web capability boundary

Updated: 2026-09-11. This describes the implemented browser platform and marks
future work from the [web design spec](superpowers/specs/2026-09-10-lunara-web-finchnode-design.md)
and [implementation plan](superpowers/plans/2026-09-11-lunara-web-finchnode.md).

## Fully local in the browser

After the initial app load, these features need no account or hosted backend:

- Cycle, period, symptom, mood, medication, contraception, BBT, and OPK logging,
  with local profile and calendar views.
- Predictions, uncertainty ranges, pattern analysis, pregnancy dating, TTC and
  perimenopause summaries, and reports with browser print/save-as-PDF.
- Bundled educational content and bookmarks.
- Plain or passphrase-encrypted file export/import. The current payload contains
  daily logs, filtered settings, and content bookmarks; it does not include all
  database tables. Canonical profile, regimen, adherence, and medical-record
  transfers are planned for Phase 3, Task 18.
- Sealed vault secrets using a non-extractable browser-managed WebCrypto key
  stored in IndexedDB. Existing logs and profiles remain plaintext. Sealed
  medical-record bodies are planned for Phase 3; record indexes and connection
  metadata will remain plaintext. Same-origin code can use the key to read
  sealed values, so this does not protect against malicious site code or a
  compromised browser profile.
- A PIN screen gate and, where the browser exposes a suitable WebAuthn platform
  authenticator, device unlock with PIN fallback. These gates do not encrypt or
  unlock the vault key. Device unlock requires enrollment and browser/device
  support.
- In-session reminders with permission and Notifications API support. Keep a
  Lunara tab open; closing all tabs stops delivery, and browser suspension can
  delay it. Reminder plans persist, but notification action buttons are not
  wired to completion or snooze callbacks.
- A production PWA shell that can load offline after its initial successful
  load and service-worker installation, while cached assets remain available.
  Its service worker precaches the app shell and bundled assets. It does not
  runtime-cache FinchNode, relay, AI, backup, or same-origin API traffic.

HTTPS is required for deployment. Browser support and clearing or eviction of
site storage can affect these capabilities; local storage is not a recovery
service.

## Needs a network call the user opts into

| Capability | Current boundary |
| --- | --- |
| FinchNode demo records — planned, Phase 3 | The future sample-data action will request synthetic records for selected categories. No demo Records flow exists yet. |
| FinchNode live records via relay — planned, Phase 3 | The future connect/refresh actions will use a self-hosted single-owner relay with a dedicated FinchNode application and client token. The relay and provider can see records in transit; sealed browser storage does not hide them from those services. |
| AI companion | A user-sent message calls Anthropic or OpenAI with the conversation and only the selected tracker context, using the user's own supported credential. Provider availability and browser CORS still apply. |
| Encrypted backup | Explicit upload/restore actions contact the user's configured backup Worker. It stores an opaque encrypted export payload, not every current database table. Restore needs the retained recovery code. |
| Email reminders | The optional self-hosted reminder Worker accepts an email and fixed clock time, stores subscription/unsubscribe metadata, and uses an email delivery provider for generic messages. It needs separate deployment and subscription setup; the browser app has no email subscription flow wired up. |

Custom relay, backup, or Ollama / AI endpoints must have their exact origins
appended to the existing `connect-src` allowlist in
[app/public/_headers](../app/public/_headers), or the host's equivalent response
configuration. Only supporting hosts apply `_headers` automatically. CSP
permission does not bypass browser CORS or mixed-content rules.

The current assistant has no dedicated Ollama provider or UI. A user-owned
model server would still require a reachable service and compatible transport;
it would not make AI inference run entirely inside this browser app.

## Not possible in a browser

- Reliable future notifications after every Lunara tab is closed without a
  push service or another delivery service. This fork has no push backend;
  the PWA service worker alone is not a future-notification scheduler.
- Direct HealthKit or Health Connect access through the removed native bridges.
  Pure file-import helpers do not provide OS health permissions or live access.
- Native iOS/Android widgets through WidgetKit or App Widget extensions. A PWA
  home-screen icon is not an OS widget.
- Cross-device synchronization without transport. Moving data requires an
  explicit file transfer or a network service, even when the payload is encrypted.
- Cloud-model answers while disconnected from the provider, or recovery after
  all copies of an export/backup recovery secret and usable data are lost.
