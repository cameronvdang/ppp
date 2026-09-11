# PPP privacy

PPP is based on Lunara (AGPL-3.0, https://github.com/Blueturboguy07/lunara).

## Summary

PPP stores your core tracking history in this browser without a PPP-hosted user database. Medical-record bodies and vault secrets are sealed, while record indexes, connection metadata, daily logs and health profiles remain plaintext. Network features require the user actions described below.

## What leaves your browser

| Destination | When | What is sent | Off by default? |
| --- | --- | --- | --- |
| FinchNode demo API | User taps "Try with sample data" | Chosen categories and a random external ID | Yes |
| Your relay → FinchNode | User taps "Connect my provider" / Refresh | Chosen categories, random external ID, return URL; then subject ID; required client token goes only to your relay | Yes |
| AI provider (BYOK) | User sends a message | The message plus only the ticked categories | Yes |
| Backup relay | User explicitly uploads via the backup action | Client-encrypted backup blob, including imported records | Yes |
| Reminder worker | User enters an email | Email + time only, no health words | Yes |
| Your calendar app | User taps Add to calendar | An .ics file with estimated dates or reminder times, generated on this device | Yes |
| Anything else | Never | — | — |

This table uses the same wording as `PRIVACY_DESTINATIONS` in the app's Privacy and data settings. Disconnect records to stop imports, remove saved AI credentials to stop assistant sharing, and skip the explicit backup action to keep backups local. Remove your reminder email through the separately configured reminder service to stop email reminders; the browser app currently has no email subscription flow. Core tracking does not require any of these services. Public sample records can be tried without an account or an API key.

## What is stored and how

Medical-record bodies and vault secrets use AES-256-GCM sealing under a non-extractable WebCrypto key stored in the separate `ppp-keys` IndexedDB database. The key is browser-managed, not a hardware-backed secret. Record IDs, categories and dates remain plaintext indexes. Connection metadata—including organizations, warnings, subjects, pending-session identifiers, consent receipts and synchronization state—also remains plaintext in IndexedDB. Existing daily logs and health profiles are not sealed. The entire local database is not encrypted.

PIN and WebAuthn device unlock gate the screen. They do not unlock or encrypt the vault key, and device unlock does not use server signature verification. Scripts running on PPP's origin can use the key and read sealed values.

Export format v2 includes `dailyLogs`, filtered `settings`, `contentBookmarks`, canonical `healthProfiles`, `regimenRecords`, `missedDoseEvents`, opened `medicalRecords`, and `recordsConnection` without pending-session or creation-attempt state. Medical-record bodies are plaintext inside the export payload. Choose passphrase encryption to protect the exported file. Explicit backup uploads encrypt this whole payload, including imported records, with the backup recovery code before upload. Backups are never uploaded automatically by a records connection or refresh.

Both export and import exclude `pinSalt`, `pinHash`, `aiKey`, `recoveryCode`, `biometricLock`, and `deviceUnlockCredential`. Vault values, raw keys and relay credentials are never serialized. A validated, credential-free relay URL may be exported. Importing a backup does not activate a live connection: its records stay viewable locally, its consent ledger restores your recorded decision, and you must explicitly connect with the current relay URL and a matching saved token to resume live access. Version 2 imports replace the record snapshot, including empty snapshots; version 1 imports preserve existing medical records.

## Threat model

PPP has no hosted user database. The stateless single-owner records relay stores no records, although explicit encrypted backup uploads are hosted by the chosen backup service. Sealing protects record bodies and vault secrets against casual inspection of those stored values; plaintext metadata, logs and profiles remain outside that boundary. Export files contain opened records unless you choose file encryption. Records never enter AI context in v1 and enter reports only when ticked.

This does not protect against malicious same-origin JavaScript, a compromised browser profile, or the FinchNode/relay operator seeing records in transit. Browser storage can be cleared or evicted. Keep an export or an encrypted backup and retain the file passphrase or backup recovery code if you need a recovery copy.

## Medical records via FinchNode

The Records introduction explains: "Bring conditions, medications, labs and more from your provider into PPP. Records are encrypted in this browser and are not sent to the AI assistant. They are included when you export a backup or explicitly upload an encrypted backup, and you can choose to include them in a report."

Connecting requires at least one selected category and consent: "I understand that connecting sends my chosen categories and a random external ID to FinchNode (through my relay in live mode, also with a return URL). Record bodies are encrypted in this browser, are not sent to the AI assistant, are included in exports and explicitly uploaded encrypted backups, and may be included in a report I choose."

**Try with sample data** contacts FinchNode's public demo API directly. Its records are synthetic and carry the banner "Sample data from FinchNode's fictional Northstar Health. Nothing here is about you." The request sends chosen categories and a random external ID; it does not send your local tracker history.

**Connect my provider** uses your own stateless relay, scoped to one owner and a dedicated FinchNode application. The FinchNode API key stays in the Worker's secret configuration. A high-entropy client token is required and goes only to the exact saved relay endpoint; Origin allowlisting is an additional browser restriction, not authentication. A relay shared among independent users needs per-user authentication plus session/subject ownership checks before live use. See the [relay setup](workers/records-relay/README.md).

The relay URL must be HTTPS, or HTTP on exact localhost/127.0.0.1 for development, with no credentials, query or fragment. Changing or importing a different saved endpoint disconnects live access, invalidates in-flight work and deletes the old bound token. Cached records remain viewable. A newly saved matching token is required before connecting to that endpoint. The browser captures and removes return-link parameters before rendering, and unsolicited, invalid, mismatched or consumed return links do not poll or modify stored records.

FinchNode provides its own authorization and consent receipts for records from your provider. PPP retains the receipt identifiers and selected/granted categories. Missing categories in partial refreshes keep cached rows and display "Not refreshed". Extra items outside the seven displayed categories are counted and disclosed; PPP does not display every possible provider item. You can revoke live authorization through your source portal or FinchNode's consent controls as well as disconnecting locally.

The doctor's report includes active conditions, active medications and allergies only when **Records from your provider** is ticked. Export is disabled until all requested data has loaded successfully. Unticking removes those records from the printable content. Imported records are not verified by PPP.

## Deleting your data

**Disconnect and delete** removes imported record bodies and identifying connection state from this browser and records a declined medical-records consent decision. It invalidates pending operations before canceling them so late responses cannot restore deleted records. It does not revoke consent at the source or delete export files and previously uploaded backups.

**Delete all data** stops local reminders, invalidates records work, clears local app data and vault secrets, and destroys the browser sealing key under an exclusive lifecycle lock. A nonpersonal disconnected generation marker remains to prevent old operations from becoming valid again. If another tab blocks key destruction, PPP asks you to close other PPP tabs and retry; it does not report deletion as successful.

Clearing this site's browser data removes the local databases, key and cached shell, including the generation marker. Existing exported files and remote encrypted backups are separate copies; manage them where they are stored. To revoke provider-side access, use the source portal or FinchNode's controls.

## No tracking

PPP includes no analytics, third-party scripts, cookies or fingerprinting. The static-host security headers in [app/public/_headers](app/public/_headers) restrict scripts to this origin and connections to the documented services. Apply equivalent headers on hosts that do not support `_headers`, and add only the exact origins of services you explicitly configure. Fonts and app assets are bundled. The service worker precaches the app shell only and never runtime-caches FinchNode, relay, AI, backup or same-origin API responses.

## Calendar files

Calendar exports are generated on this device and leave only when you choose the
share or download action. Nothing is uploaded to PPP or a calendar service by
the app. Your chosen calendar app may sync or share the file under its own settings.

Forecast files contain estimated period, fertile and ovulation windows when
eligible, for three cycles by default or up to six. Discreet titles are on by
default and omit category metadata. Descriptive titles can be enabled in Settings.
Later period windows widen with uncertainty. Estimates are not for contraception.

Reminder files contain enabled plans with the same neutral titles and bodies as
notifications. Their times float with your calendar's local wall clock, including
when you travel. Quiet hours are not applied to calendar reminders; your calendar
app controls delivery. Stable event IDs allow re-importing to update the same
events. Cancelling the share sheet does not trigger a download.
