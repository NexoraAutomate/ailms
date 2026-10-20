# Spec 10 — Security & Operational Controls

## A. Purpose

Security and operational requirements for PMS integration, aligned with existing JWT auth, letter ACL, and AI registration threat model.

## B. Controls catalog

| Threat / risk | Control |
|---------------|---------|
| Credential theft | Server-side env only; never frontend; never DB tables; redacted logs |
| Unauthorized sync | Admin-only manual trigger; auth required; audit |
| Letter leakage via project UI | Enforce `letter_access` on letter-bearing payloads |
| Prompt injection via letter text | Untrusted DATA wrapping; AI has no tools/mutations (spec 09) |
| Invented PMS facts | Read-only client; deterministic rules cite source IDs |
| Stale data presented as current | Freshness flag + UI warning + `PMS_STALE_DATA` alert |
| Cache wipe on outage | Upsert-only; no delete-on-failure |
| Privilege escalation | Reuse `require_admin` / role permissions; no second auth |
| Write-back to PMS | Client exposes read methods only; tests assert no mutating verbs |
| External cloud AI | Use existing approved `LLM_PROVIDER` only |

## C. Least privilege

- PMS credentials: minimum read scopes from PMS team.
- AILMS roles: permission keys `intelligence.view`, `intelligence.review`, `pms.sync`.
- Record-level: letter evidence filtered independently of project visibility.

## D. Validation

- All external API responses validated (Pydantic).
- All user inputs validated (review notes length, decisions enum).
- ORM parameterized queries only.

## E. Audit events (minimum)

| Event | Module |
|-------|--------|
| Manual sync triggered | PMS |
| Match confirmed / rejected | Intelligence |
| Alert reviewed | Intelligence |
| AI summary requested (optional) | Intelligence |

## F. Logging

- No credentials, tokens, or full confidential correspondence in logs.
- Prefer IDs, statuses, counts, durations.

## G. Deployment compatibility

- Compatible with current non-Docker local/process model.
- Scheduler must use DB lock for multi-worker safety.
- Do not weaken `AUTH_REQUIRED` defaults for production.

## H. Acceptance

- [ ] Security tests for authz failures and letter redaction
- [ ] Sync endpoint unauthenticated → 401
- [ ] No write-back code paths
