# Lunara

An open-source, local-first browser companion for cycle, fertility, pregnancy, and perimenopause tracking.

## Fork notice

This AGPL-3.0 fork of [upstream Lunara](https://github.com/Blueturboguy07/lunara)
replaces the Capacitor iOS and Android shells with a web-first React/Vite app
and a PWA shell. It remains a work in progress.

The [implementation plan](docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md)
covers the browser platform, Aileron typography, baby pink / baby red palette,
responsive layout, and FinchNode records integration. Phases 1–3 are implemented;
the final Phase 4 hardening and browser review remain separate work.

Lunara is an open-source alternative to Flo®. It is not affiliated with,
endorsed by, or connected to Flo Health Inc.

## Run it

Use **Node.js 24** and **pnpm 9**. From the repository root:

```sh
pnpm install
pnpm dev
```

For a production build and local preview:

```sh
pnpm build
pnpm preview
```

Deploy `app/dist` to any static host over HTTPS. The production PWA can load its
cached shell offline after the initial successful load and service-worker
installation. Browser support and retained site storage affect availability.

The build copies [app/public/_headers](app/public/_headers) into `app/dist`.
Only hosts that support the `_headers` format apply it automatically; on other
hosts, map those directives to the host's response-header configuration. Append
the **exact origin** of any custom records relay, backup endpoint, or Ollama / AI
host to the existing CSP `connect-src` allowlist. Browser CORS and mixed-content
rules still apply; adding an origin to CSP does not grant access at the server.

## Privacy

See [PRIVACY.md](PRIVACY.md) for the network-destination table and storage boundary,
and [Web capability boundary](docs/WEB_CAPABILITY_BOUNDARY.md) for browser limits.

- **Local first:** core tracking uses browser storage without an account or a
  Lunara-hosted user database. Clearing site data removes local history.
- **Opt-in transfers:** records connect/refresh, AI messages and encrypted backup
  uploads require user action. Records are never sent to the AI assistant.
- **Limited encryption scope:** medical-record bodies and vault secrets are sealed
  with a browser-managed key. Record indexes, connection metadata, existing logs
  and profiles remain plaintext. PIN and device unlock gate the screen. Export
  files contain opened records unless you choose file encryption; explicit backup
  uploads encrypt the entire export payload.

## Medical records

Open **Records**, choose categories, and tick the consent checkbox. Select
**Try with sample data** to import FinchNode's fictional Northstar Health records
without an account or API key. With all categories selected, seven summary cards
appear; **Lab results** contains three rows. Open a category to read compact
records with their date and source. The sample-data banner stays visible.

For live records from your provider:

1. Deploy [workers/records-relay](workers/records-relay/README.md) for one owner
   with a dedicated FinchNode application. Configure the FinchNode API key and a
   high-entropy relay client token as Worker secrets, plus exact allowed origins.
2. Append the relay's exact origin to `connect-src` in `app/public/_headers`
   (or your host's equivalent). No wildcard relay allowance is included.
3. In **Settings → Medical records**, save the relay URL and its required token.
   The token is sealed in the vault and bound to that canonical URL.
4. Open Records, consent to at least one category, and choose **Connect my provider**.
   Complete Hosted Connect. Lunara resumes only the pending session you started,
   polls its sync state, and imports your granted categories.

Use **Refresh** to update records. Partial refreshes keep missing categories cached
and label them **Not refreshed**. Additional unsupported items are counted and
shown on the source card. Recovery actions distinguish **Start again**, **Check
again**, and **Refresh**. Changing the relay URL disconnects live access, removes
the old token, and leaves cached records viewable.

In the doctor's report, **Records from your provider** is off by default; tick it
to include active conditions, active medications and allergies with source and
date. Records are included in exported backups and explicit encrypted backup
uploads, and are never included in AI context. Imported backup snapshots remain
viewable but disconnected until you explicitly connect again.

**Disconnect and delete** removes local imported records and declines local
records consent. Revoke source-side authorization in your provider portal or
FinchNode's consent controls too. **Delete all data** also clears the app and vault.
See [PRIVACY.md](PRIVACY.md) for deletion, export and relay trust details.

## Develop

Run the app tests from the repository root:

```sh
pnpm --filter @lunara/app test
(cd app && npx tsc --noEmit && npx vite build)
(cd workers/records-relay && pnpm test)
```

The seeded [estimate audit](app/src/engine/estimateAudit.test.ts) exercises
user-facing estimates across **360 generated histories** and must remain at
**zero violations**. Run the tests when changing prediction math; `pnpm build`
also checks TypeScript before generating the production bundle.

## Structure

- [app/](app/) — React/Vite browser app, local data, web adapters, and PWA shell.
- [workers/backup/](workers/backup/) — optional Worker/R2 storage for
  client-encrypted backup uploads.
- [workers/reminders/](workers/reminders/) — optional self-hosted generic email
  reminders; the browser app does not currently wire up email subscriptions.
- [workers/records-relay/](workers/records-relay/) — stateless, single-owner
  FinchNode relay with required token authentication and strict category routes.
- [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md) — feature inventory and web
  capability changes.

## AI companion

The AI companion is optional and bring-your-own-key. Lunara ships no shared
credential, and core tracking works without AI. The current UI supports:

- **Anthropic** — an API key or a token from `claude setup-token`.
- **OpenAI** — a project API key.

These are implemented credential paths, subject to provider access and browser
network policies. Requests send your conversation and only the tracker-context
categories selected for that request. The OpenAI path requests `store: false`.
AI calls require a reachable provider; a dedicated Ollama integration is not
currently exposed in the UI.

Saved AI credentials are sealed in the browser vault using a non-extractable
WebCrypto key stored in IndexedDB. They are excluded from exports and backups.
This is not a hardware-backed Keychain/Keystore: anyone able to run code on this
site in your browser could read them. PIN and device unlock are screen gates.

## Disclaimer

Lunara is not a medical device and does not diagnose, treat, cure, or prevent any condition. Predictions are estimates for informational purposes only and must not be used to prevent pregnancy.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
