# Web capability boundary

Updated: 2026-09-11. This describes the implemented browser platform, mobile installation, local calendar files and records integration.

> Historical note: The earlier [web design spec](superpowers/specs/2026-09-10-lunara-web-finchnode-design.md) and [implementation plan](superpowers/plans/2026-09-11-lunara-web-finchnode.md) record Phases 1–3 of the platform work.

## Fully local in the browser

After the initial app load, these features need no account or hosted backend:

- Cycle, period, symptom, mood, medication, contraception, BBT, and OPK logging,
  with local profile and calendar views.
- Predictions, uncertainty ranges, pattern analysis, pregnancy dating, TTC and
  perimenopause summaries, and reports with browser print/save-as-PDF.
- Bundled educational content and bookmarks.
- Calendar files for eligible forecasts and enabled reminders, generated locally
  and delivered only through a user-selected share or download action. Discreet
  titles default on. Reminder times float with local time; calendar apps control
  delivery and PPP quiet hours do not apply.
- Plain or passphrase-encrypted file export/import. The v2 payload contains
  daily logs, filtered settings, content bookmarks, canonical health profiles,
  regimens, adherence events, opened medical records and connection metadata
  without pending/creation state. Security settings and vault credentials are excluded.
  Imported connections stay disconnected and viewable locally.
- Sealed vault secrets using a non-extractable browser-managed WebCrypto key
  stored in IndexedDB. Medical-record bodies are also sealed. Existing
  logs and profiles, record IDs/categories/dates, and connection metadata
  (organizations, warnings, subjects and pending-session IDs) remain plaintext. Same-origin code can use the key to read
  sealed values, so this does not protect against malicious site code or a
  compromised browser profile.
- A PIN screen gate and, where the browser exposes a suitable WebAuthn platform
  authenticator, device unlock with PIN fallback. These gates do not encrypt or
  unlock the vault key. Device unlock requires enrollment and browser/device
  support.
- In-session reminders with permission and Notifications API support. Keep a
  PPP tab open; closing all tabs stops delivery, and browser suspension can
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
| FinchNode demo records | "Try with sample data" sends chosen categories and a random external ID to the public demo API. The seven category cards and lists display fictional Northstar Health records. |
| FinchNode live records via relay | Explicit connect/refresh uses the [stateless records relay](../workers/records-relay/README.md), with a dedicated FinchNode application and a required client token bound to its canonical URL. Chosen categories, random external ID and return URL are sent on creation; subject IDs identify snapshot reads. The trusted relay and FinchNode can see records in transit. Exact Origin checks are additional to authentication; independent users require per-user authentication and ownership checks. |
| AI companion | A user-sent message calls Anthropic or OpenAI with the conversation and only the selected tracker context, using the user's own supported credential. Provider availability and browser CORS still apply. |
| Encrypted backup | Explicit upload/restore actions contact the user's configured backup Worker. It stores the client-encrypted v2 export payload, including imported records and canonical profile/regimen/adherence tables, with security settings excluded. Restore needs the retained recovery code. |
| Email reminders | The optional self-hosted reminder Worker accepts an email and fixed clock time, stores subscription/unsubscribe metadata, and uses an email delivery provider for generic messages. It needs separate deployment and subscription setup; the browser app has no email subscription flow wired up. |

Records never enter AI context and enter the doctor report only when ticked.
Requested report data must load successfully before export. Complete snapshots
replace selected/granted categories; partial snapshots retain missing cached rows.
Disconnect/delete and wipe invalidate in-flight work using persisted generations;
changing a relay URL disables live refresh and removes its old bound token.
See [PRIVACY.md](../PRIVACY.md) for the full threat model and deletion scope.

Custom relay, backup, or Ollama / AI endpoints must have their exact origins
appended to the existing `connect-src` allowlist in
[app/public/_headers](../app/public/_headers), or the host's equivalent response
configuration. Only supporting hosts apply `_headers` automatically. CSP
permission does not bypass browser CORS or mixed-content rules.

The current assistant has no dedicated Ollama provider or UI. A user-owned
model server would still require a reachable service and compatible transport;
it would not make AI inference run entirely inside this browser app.

## Not possible in a browser

- Reliable future notifications after every PPP tab is closed without a
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
