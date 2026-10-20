# PMS Integration — Requirements Traceability

Maps ChatGPT integration requirements → functional specs and planned code.

| Requirement section | Spec / doc | Planned artifacts |
|---------------------|------------|-------------------|
| §1 Objective | `01-master-plan.md` | Integration-only architecture |
| §2 Preliminary audit | `00-current-state.md` | This audit (2026-10-13) |
| §3 PMS API adapter | `specs/01-configuration.md`, `specs/02-pms-client.md` | `pms_client.py`, `pms_mappers.py` |
| §4 PostgreSQL data model | `specs/03-data-model.md` | models + `db_upgrade` |
| §5 Synchronization | `specs/04-synchronization.md` | `pms_sync_service.py`, `jobs.py`, `pms_admin` router |
| §6 Letter–project matching | `specs/05-letter-project-matching.md` | `project_matching_service.py` + UI |
| §7 Deterministic rules | `specs/06-intelligence-rules.md` | `intelligence_rules_service.py` |
| §8 Executive Radar API | `specs/07-executive-radar-api.md` | `routers/intelligence.py` |
| §9 Frontend | `specs/08-frontend.md` | `/intelligence/*` pages |
| §10 AI interpretation | `specs/09-ai-interpretation.md` | Optional Phase 6 |
| §11 Security | `specs/10-security.md` | Authz, audit, redaction |
| §12 Testing | `specs/11-testing.md` | `tests/test_pms_*.py` |
| §13 Sequence | `01-master-plan.md` §4 | Phases 1–6 |
| §14 Definition of done | `01-master-plan.md` §8 + `specs/11-testing.md` | Exit checklist |
| Unknown PMS contract | `OPEN-QUESTIONS.md` | Blocker until resolved |

## Phase gate summary

| Phase | Docs complete | Code expected |
|-------|---------------|---------------|
| 1 | `00`, `01`, `OPEN-QUESTIONS`, this file | Documentation only |
| 2 | Specs 01–04 (status) | Config, schema, client stub, status API |
| 3 | Spec 04 full + 11 | Sync worker + tests |
| 4 | Specs 05, 08 (matches) | Matching + UI |
| 5 | Specs 06–08 | Rules + Radar |
| 6 | Specs 09–10 | Optional AI |

## Explicit non-goals (tracked)

| Non-goal | Enforced by |
|----------|-------------|
| No PMS write-back | Spec 02, 10 |
| No duplicate letter model / second auth | Spec 03, 10, current-state |
| No invented API paths | OPEN-QUESTIONS, Spec 02 |
| No Redis/Celery unless necessary | Master plan §3 |
| No fabricated dashboard numbers | Spec 08 |
