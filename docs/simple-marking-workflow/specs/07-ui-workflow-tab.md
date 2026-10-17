# Spec 07 — UI Workflow Tab

## A. Purpose

Expose the full marking workflow on each letter’s **Workflow** tab: history tree, mark dialog, notes/attachments, trackers, revoke/close, replacing enterprise lifecycle panels.

## B. Preconditions

- Spec 06 APIs available.
- Letter details page with Workflow tab shell exists.

## C. Inputs

- Letter id; current user role/name from session.
- `GET .../actions`, `.../tree`, `.../notes`, tracker endpoints.

## D. Processing / UX

### D.1 Workflow tab layout (one composition, two sections)

1. **Timeline / tree** — chronological or hierarchical view of all markings (from/to, action, stamps, IP for auditors). Expand children. Show revoke/responded badges.
2. **Actions** — contextual buttons from `actions` API: Mark, Add note, Respond (if RR to me), Revoke (own eligible marks), Close (initiator hold).
3. **My batch trackers** — for batches I created on this letter: pending RR checklist.
4. **Notes feed** — notes + attachment chips with kind labels.

Remove / hide:

- Enterprise validate/classify/approve_routing/dispatch controls.
- `EnterpriseLifecyclePanel` multi-tier approval UI.
- Legacy status button matrix that contradicts marking (keep archive if separate).

### D.2 Mark dialog

- Multi-select (or repeatable rows) of users.
- Per row: action select; if RR → response type + due date + reminders checkbox.
- Shared: remarks, track default on (per-row override), pathway notify checkbox.
- Submit → `POST .../mark` → refresh tree + notifications.

### D.3 Respond dialog

- Body text + multi-file upload with kind select.
- Submits `respond` for the active RR marking.

### D.4 Close dialog

- Remarks; if open RR, show warning list and require confirm (`force`).

### D.5 Onboarding

Rewrite `WORKFLOW_PIPELINE` in `frontend/lib/onboarding.ts` to:

Register → Mark (Info / Action / Response Required) → Notes & attachments → Track / Remind → Close by initiator.

### D.6 Notifications center

Ensure new notification types render with link to letter Workflow tab.

## E. Outputs

- Updated React components; markings client service.
- No enterprise action execution from UI.

## F. Components

| Component | Action |
|-----------|--------|
| `frontend/components/cms/letter-panels.tsx` | Replace WorkflowPanel / EnterpriseLifecyclePanel |
| `frontend/components/cms/marking-*.tsx` | New dialogs/tree (as needed) |
| `frontend/services/markings.ts` | API client |
| `frontend/services/letter-actions.ts` | Slim or redirect |
| `frontend/lib/onboarding.ts` | Pipeline copy |
| `frontend/components/cms/letter-details.tsx` | Tab wiring |

## G. Data model

N/A (consumes API).

## H. API contract

Per spec 06.

## I. Acceptance

- [ ] Any user on the path can open Workflow tab and see full history.
- [ ] Multi-recipient mark with mixed actions works from UI.
- [ ] Revoke/close/respond affordances match permissions.
- [ ] Enterprise classify/dispatch UI not reachable.
- [ ] Works on desktop and mobile widths for core actions.
