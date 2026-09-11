# FinchNode reference material

Vendored copies of FinchNode's public API contracts, kept here so the
records integration can be built and tested offline.

| File | Source | Notes |
| --- | --- | --- |
| `finchnode-developer-api.openapi.yaml` | https://finchnode.com/openapi.yaml | Authenticated API (`https://api.finchnode.com/api/v1`). Bearer `ck_test_…` / `ck_live_…` keys are **server-side only**; PPP's browser never holds one. |
| `finchnode-demo-api.openapi.json` | https://api.finchnode.com/demo/v1/openapi.json | Public synthetic demo API. No auth, CORS `*`, 120 req/min/IP. Returns raw FHIR R4 resources, not the normalized shape. |
| `demo-records-sample.json` | `GET /demo/v1/patients/patient-demo-001/records?categories=…` | Captured 2026-09-11. Fixture for the FHIR normalizer tests. |

Fetched 2026-09-11. Re-fetch when FinchNode publishes a new calendar version
(see the `FinchNode-Version` response header).
