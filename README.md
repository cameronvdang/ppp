# Lunara

An open-source, local-first browser companion for cycle, fertility, pregnancy, and perimenopause tracking.

## Fork notice

This AGPL-3.0 fork of [upstream Lunara](https://github.com/Blueturboguy07/lunara)
replaces the Capacitor iOS and Android shells with a web-first React/Vite app
and a PWA shell. It remains a work in progress.

The [implementation plan](docs/superpowers/plans/2026-09-11-lunara-web-finchnode.md)
separates the working browser platform from upcoming changes. Aileron typography,
the baby pink / baby red palette, and responsive layout changes are **planned
for Phase 2, Tasks 9–12**. The Aileron dependency is installed, but font imports
and the palette work are not implemented yet. FinchNode medical records,
the records relay, and the full privacy documentation are **planned for Phase 3,
Tasks 13–23**.

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

[PRIVACY.md](PRIVACY.md) is planned for **Task 23** and does not exist yet.
The current boundary is documented in
[Web capability boundary](docs/WEB_CAPABILITY_BOUNDARY.md).

- **Local first:** core tracking uses browser storage without an account or
  a Lunara-hosted user database. Clearing site data removes local history.
- **Opt-in transfers:** AI requests and encrypted backup uploads require user
  action. Email reminders require a separately deployed worker; FinchNode demo
  and live records transfers are planned for Phase 3.
- **Sealed secrets, limited encryption scope:** vault secrets are encrypted
  with a browser-managed key today. Sealed medical-record bodies are planned
  for Phase 3; record indexes and connection metadata will remain plaintext,
  as existing logs and profiles do today. PIN and device unlock gate the screen,
  not the key; code running on this site's origin can access the vault.

## Medical records

FinchNode sample records and live imports from your provider are planned for
Phase 3 (Tasks 13–23). The Records interface, sealed record storage, and
single-owner relay are not present yet. Task 23 will replace this placeholder
with sample-data and live-setup instructions and the completed privacy link.

## Develop

Run the app tests from the repository root:

```sh
pnpm test
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
- [workers/records-relay/](workers/records-relay/) — **planned for Phase 3**;
  this directory does not exist yet.
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
