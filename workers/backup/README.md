# PPP backup relay (M3)

Stateless zero-knowledge backup: the app encrypts the whole database on-device
(AES-256-GCM, key derived via Argon2id from a show-once recovery code) and this
Worker PUT/GETs the opaque blob in R2, keyed by an ID derived from the recovery
code. No accounts, no email, no readable data. Rate-limited.

Contract (to implement):

- `PUT /v1/blob/:id` — store encrypted snapshot (size-capped)
- `GET /v1/blob/:id` — fetch snapshot
- The Worker never sees key material; `:id` is derived client-side.
