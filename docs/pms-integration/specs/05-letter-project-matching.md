# Spec 05 — Letter-to-Project Matching

## A. Purpose

Link `cms_letters` to PMS projects/milestones with traceable evidence. Exact identifiers may auto-confirm; ambiguous cases require authorized human review. LLM cannot establish authoritative links alone.

## B. Preconditions

- Specs 03–04 (project cache populated or seedable in tests).
- Letter access controls understood (`letter_access.py`).

## C. Component

`backend/app/project_matching_service.py` + endpoints under intelligence/letters routers.

## D. Match priority

1. Exact project `code` or `external_id` in letter metadata (`number`/subject/remarks) or `body_text`.
2. Exact contract / milestone / other approved unique ID with mapping to a project.
3. Normalized project names and approved aliases.
4. Contextual candidates (orgs, vendors, equipment, dates, prior confirmed links).
5. Human confirmation for ambiguous cases.

## E. Match statuses

| Status | Meaning |
|--------|---------|
| `suggested` | Candidate presented; not authoritative |
| `confirmed_exact` | Auto or human confirm of unambiguous exact ID |
| `confirmed_manual` | Human selected/confirmed non-exact or alternate |
| `rejected` | Human rejected |
| `unmatched` | No viable candidate (or all rejected) |

`match_score` is for **ranking only** — never presented as a calibrated probability.

## F. Pilot auto-accept policy

When `PMS_MATCH_AUTO_ACCEPT_EXACT=true`:

- Auto-set `confirmed_exact` **only** for unambiguous exact-identifier matches (single candidate, exact code/external_id).
- All other candidates → `suggested` for reviewer queue.

## G. API (adapt to conventions)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/intelligence/matches` | Queue of suggested matches (filterable) |
| GET | `/api/intelligence/matches/{link_id}` | Detail + evidence |
| POST | `/api/intelligence/matches/{link_id}/confirm` | Confirm (optional milestone) |
| POST | `/api/intelligence/matches/{link_id}/reject` | Reject |
| POST | `/api/letters/{id}/project-links` | Manual link create (letter-accessible users) |
| GET | `/api/letters/{id}/project-links` | Links for a letter |

Authorization:

- Viewer must pass `user_can_access_letter` for letter-scoped operations.
- Confirm/reject recorded with `confirmed_by` + `confirmed_at`.
- Audit via `add_audit`.

## H. UI requirements

Match confirmation view shows:

- Letter reference (`number`) and subject
- Candidate project code + name
- Optional milestone
- Matching reason + extracted evidence
- Score if applicable
- Actions: Confirm / Reject / Select other candidate

Never modify original letter text or PMS authoritative fields.

## I. Non-goals

- Embedding-based semantic match as sole authority
- LLM auto-confirm
- Write-back to PMS

## J. Testing

- Exact code in subject → `confirmed_exact`
- Two similar names → `suggested`, no auto-accept
- Reject → status `rejected`, audit row
- User without letter access → 403

## K. Acceptance

- [ ] Exact-only auto-accept under policy
- [ ] Ambiguous requires human
- [ ] Evidence + actor timestamps stored
- [ ] Letter/PMS source data unchanged
