# Spec 06 — Deterministic Intelligence Rules

## A. Purpose

Generate evidence-backed alerts from PMS cache + correspondence links **before** any AI interpretation. Rules are versioned, deduplicated, and re-evaluable.

## B. Preconditions

- Specs 03–05 (projects, milestones, links, optional actions).
- Rule evaluation invoked at end of successful/partial sync and optionally on match confirmation.

## C. Component

`backend/app/intelligence_rules_service.py`

## D. Cross-cutting rules engine requirements

For every alert:

- Store `rule_name`, `rule_version`, source IDs, letter refs, source timestamps, calculation details (`evidence_json`), review fields.
- **Dedupe** on stable `dedupe_key`; re-evaluate updates existing open alert instead of inserting duplicates.
- Missing data ≠ zero / completed / overdue / risk-free.
- Distinguish proposed vs vendor vs approved forecast vs baseline vs actual dates in evidence text.
- Do not assert project delay solely because a letter mentions a later date.

## E. Initial rules

### E.1 `MILESTONE_FORECAST_SLIP` (v1)

| Item | Definition |
|------|------------|
| **Condition** | Milestone has both `baseline_date` and `forecast_date`; forecast > baseline by ≥ configured days (default 1); status not in terminal completed set (when known) |
| **Required fields** | `external_id`, `external_project_id`, baseline, forecast |
| **Exclusions** | Missing either date; cancelled statuses (when enum known); actual_date present and ≤ forecast (completed on time) — refine with PMS enums |
| **dedupe_key** | `MILESTONE_FORECAST_SLIP:{external_milestone_id}` |
| **Severity** | `warning` (or `critical` if slip ≥ N days — configurable) |
| **Limitations** | Does not prove contractual delay without approved PMS status semantics |

### E.2 `LETTER_DATE_CONFLICT` (v1)

| Item | Definition |
|------|------------|
| **Condition** | Confirmed letter–milestone (or project) link exists; letter `due_date` or extracted commitment date differs from PMS `forecast_date` beyond threshold |
| **Required fields** | Confirmed link; letter date field; PMS forecast |
| **Exclusions** | Suggested-only links; missing dates; letter status in informational-only categories if configured |
| **dedupe_key** | `LETTER_DATE_CONFLICT:{letter_id}:{external_milestone_id|project}` |
| **Severity** | `warning` |
| **Limitations** | Labels **potential discrepancy requiring review** — not an automatic finding of fault |

### E.3 `REPEATED_APPROVAL_REQUEST` (v1)

| Item | Definition |
|------|------------|
| **Condition** | ≥ N related letters (via `cms_letter_relations` and/or same confirmed project) within window W referencing unresolved approval subject |
| **Required fields** | Confirmed project links; letter subjects/relations; approval/open status signals |
| **Exclusions** | Closed letters; rejected matches |
| **dedupe_key** | `REPEATED_APPROVAL_REQUEST:{external_project_id}:{normalized_subject_key}` |
| **Severity** | `warning` |
| **Limitations** | Subject normalization is heuristic; human review required |

### E.4 `OVERDUE_ACTION` (v1)

| Item | Definition |
|------|------------|
| **Condition** | Authoritative action due date &lt; today UTC date **and** status still open |
| **Sources** | Prefer PMS actions if available; else AILMS `cms_action_items` linked via confirmed project letters |
| **Exclusions** | Missing due date; completed/cancelled status; do not treat null as overdue |
| **dedupe_key** | `OVERDUE_ACTION:{source}:{action_external_or_local_id}` |
| **Severity** | `critical` or `warning` by overdue age |
| **Limitations** | Skip silently if action resource unavailable and no linked AILMS actions |

### E.5 `UNRESOLVED_CORRESPONDENCE` (v1)

| Item | Definition |
|------|------------|
| **Condition** | Letter with confirmed project link; status not in `CLOSED_STATUSES`; age since `received_date` ≥ configurable threshold; action still required per letter type / `action_required` |
| **Exclusions** | Informational letters with no action; archived; unmatched letters |
| **dedupe_key** | `UNRESOLVED_CORRESPONDENCE:{letter_id}` |
| **Severity** | `info` / `warning` |
| **Limitations** | Not every incoming letter shares the same SLA — threshold configurable per type if needed |

### E.6 `PMS_STALE_DATA` (v1)

| Item | Definition |
|------|------------|
| **Condition** | Last successful sync older than `PMS_DATA_FRESHNESS_SECONDS` **or** never succeeded while integration enabled |
| **dedupe_key** | `PMS_STALE_DATA:global` |
| **Severity** | `warning` |
| **Resolution** | Auto-resolve when a successful sync completes |

## F. Alert lifecycle

| Status | Meaning |
|--------|---------|
| `open` | System-detected, awaiting review |
| `confirmed` | Human confirmed finding |
| `dismissed` | Human dismissed (false positive / not applicable) |
| `resolved` | Issue addressed or auto-cleared by re-evaluation |

Re-evaluation: if condition cleared → set `resolved` with system note (do not delete history).

## G. Testing

- Slip calculation with baseline/forecast
- Missing forecast → no alert
- Dedupes across two syncs
- Stale auto-resolve after success
- Letter conflict only on confirmed links

## H. Acceptance

- [ ] All six rules documented and implemented or explicitly deferred with flag
- [ ] Deduplication works
- [ ] Evidence stored; missing data handled safely
