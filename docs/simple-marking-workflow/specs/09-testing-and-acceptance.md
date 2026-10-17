# Spec 09 — Testing and Acceptance

## A. Purpose

Define automated and manual acceptance criteria for the simple marking workflow v1 so the feature branch is verifiable.

## B. Preconditions

- Specs 01–08 implemented.
- Test DB available (reuse existing unittest / pytest patterns in `backend/tests`).

## C. Inputs

- Seed users (initiator, A, B, C, Viewer).
- Sample letter registered as initiator.

## D. Processing — test matrix

### D.1 Unit / service tests

| Case | Expect |
|------|--------|
| Mark batch mixed Info + RR | Two active markings; notifications created |
| Self-mark | 400 |
| Duplicate active A→B | 400 |
| Forward chain A→B→C | Tree depth 2; all IPs set |
| Revoke before child | status revoked |
| Revoke after child | 409 |
| RR respond | status responded; tracker pending=0 |
| Forward without respond | RR still active |
| Close without hold | 403/400 |
| Close with open RR no force | 400 OPEN_RESPONSES |
| Close with force | letter Closed; actives superseded |
| Viewer mark | 403 |
| Track=false | absent from tracked list; recipient still notified |
| Reminder dedupe | second run skips same key |

### D.2 API tests

- Authz 403 for outsider.
- Inbox lists only active to_user letters.
- Actions endpoint reflects hold/initiator.

### D.3 UI / manual

- Workflow tab shows tree after multi-mark.
- Mark dialog multi-row works.
- Notifications center shows mark + reminder types.
- Enterprise classify/dispatch not visible.
- Mobile: mark + respond usable.

### D.4 Regression

- AI registration still creates letter; initiator can mark afterward.
- Manual register → Open → mark.

## E. Outputs

- `backend/tests/test_marking_workflow.py` (primary).
- Optional frontend smoke later.

## F. Components

| Component | Action |
|-----------|--------|
| `backend/tests/test_marking_workflow.py` | New |
| CI | Run unittest/pytest job if present |

## G. Data model

N/A.

## H. API contract

N/A.

## I. Acceptance (release checklist)

- [ ] All D.1 cases green on CI or local.
- [ ] Spec 07 UI checklist signed off on test branch.
- [ ] `MAIL_ENABLED=false` default; no crashes.
- [ ] Docs pack remains accurate vs shipped behavior.
- [ ] Branch commits map cleanly: one commit per spec (docs and/or impl).
