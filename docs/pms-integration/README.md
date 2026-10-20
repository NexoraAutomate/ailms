# SUPARCO PMS ↔ AILMS Integration — Functional Specifications

Planning package for integrating the external Project Management System (PMS) with the existing AI Correspondence Management System. **Integration only** — neither system is replaced.

## Start here

1. [`00-current-state.md`](./00-current-state.md) — Repository audit (architecture as of 2026-10-13)
2. [`01-master-plan.md`](./01-master-plan.md) — Phased plan, file map, definition of done
3. [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md) — PMS API contract intake (blockers)
4. [`TRACEABILITY.md`](./TRACEABILITY.md) — Requirements → specs map

## Functional specs

| Spec | Topic |
|------|--------|
| [`specs/01-configuration.md`](./specs/01-configuration.md) | Env flags, timeouts, sync interval |
| [`specs/02-pms-client.md`](./specs/02-pms-client.md) | HTTP adapter, mappers, error taxonomy |
| [`specs/03-data-model.md`](./specs/03-data-model.md) | PostgreSQL tables & migrations |
| [`specs/04-synchronization.md`](./specs/04-synchronization.md) | Sync job, lock, admin status |
| [`specs/05-letter-project-matching.md`](./specs/05-letter-project-matching.md) | Matching + human confirmation |
| [`specs/06-intelligence-rules.md`](./specs/06-intelligence-rules.md) | Deterministic alerts |
| [`specs/07-executive-radar-api.md`](./specs/07-executive-radar-api.md) | Intelligence HTTP API |
| [`specs/08-frontend.md`](./specs/08-frontend.md) | Project Intelligence UI |
| [`specs/09-ai-interpretation.md`](./specs/09-ai-interpretation.md) | Optional AI summaries (Phase 6) |
| [`specs/10-security.md`](./specs/10-security.md) | Security & ops |
| [`specs/11-testing.md`](./specs/11-testing.md) | Tests & acceptance |

## Implementation rule

**Do not start a large code rewrite until** Phase 1 is accepted and PMS API documentation answers in `OPEN-QUESTIONS.md` are filled (or adapters remain explicitly stubbed).

This package mirrors the structure of `docs/ai-letter-registration/`.
