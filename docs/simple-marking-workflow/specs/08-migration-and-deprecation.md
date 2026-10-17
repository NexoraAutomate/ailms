# Spec 08 — Migration and Deprecation

## A. Purpose

Migrate existing letters into the simplified status model, preserve auditability of old enterprise rows, and remove enterprise lifecycle from the active API/UI path.

## B. Preconditions

- Specs 01–07 implemented on feature branch.
- Database backup recommended before upgrade.

## C. Inputs

- Existing `cms_letters.status` values (enterprise + legacy).
- Existing `cms_route_steps`, `cms_action_items`, `cms_response_versions`, `cms_approval_steps`, `cms_dispatches`.
- Existing `cms_workflow_transitions`.

## D. Processing

### D.1 Letter status backfill

Map any non-terminal status → `Open`.

Terminal map:

| Old | New |
|-----|-----|
| `Closed`, `Completed`, `Information Delivered`, `Dispatched` | `Closed` |
| `Archived` | `Archived` |
| `Rejected` | `Closed` (remarks preserved if any) |
| All others | `Open` |

Set `initiator_user_id` from `created_by` name → `cms_users.id` when match exists.

### D.2 Synthetic root hold

For `Open` letters with no markings yet: initiator is holder by rule (no row required). Optionally create no synthetic marking.

### D.3 Enterprise tables

**v1 choice:** Keep tables read-only; stop writing from application code. Do not delete historical rows.

UI does not surface RouteStep/ApprovalStep panels.

### D.4 API deprecation

- `available_actions` / execute: strip `ENTERPRISE_ACTIONS` and conflicting legacy transitions.
- Prefer new `/api/markings/*` for all lifecycle mutations.
- Old `/api/workflow/letters/{id}/history` may still return `WorkflowTransition` rows; new tree is authoritative for markings.

### D.5 Seed / onboarding

Update seed statuses to `Open` where appropriate; update onboarding copy (spec 07).

### D.6 Feature flag (optional safety)

If needed during rollout: `MARKING_WORKFLOW_ENABLED=true` on this test branch default **true**.

## E. Outputs

- Upgrade function e.g. `upgrade_simple_marking_schema(engine)`.
- One-shot data migration callable from startup or script.
- Changelog note in master plan.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/db_upgrade.py` | Schema + data migration |
| `workflow_service.py` / `enterprise_workflow_service.py` | Disable active enterprise path |
| Tests | Update e2e that assumed enterprise path |

## G. Data model

New tables from spec 01; letter columns; no drop of enterprise tables in v1.

## H. API contract

Document which old actions return 400/410.

## I. Acceptance

- [ ] After upgrade, no letter left on obsolete enterprise-only statuses.
- [ ] New mark works on migrated Open letter.
- [ ] Enterprise execute actions no longer available in UI/API.
- [ ] Historical enterprise rows remain queryable in DB.
