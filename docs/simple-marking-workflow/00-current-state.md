# Simple Marking Workflow — Current State

**Status:** BASELINE (read before implementing)  
**Branch:** `feature/simple-marking-workflow`

---

## 1. What exists today

AILMS currently runs **three layered correspondence systems**:

| Layer | Location | Role |
|-------|----------|------|
| Legacy letter transitions | `backend/app/workflow_service.py` | Flat `Letter.status` rules (assign, forward, approve, archive, …) |
| Enterprise lifecycle | `backend/app/enterprise_workflow_service.py` | Validate → classify (FYI/Actionable) → routing approval → action items → multi-tier response approval → dispatch |
| AI registration job FSM | `backend/app/ai/job_states.py` | OCR → extract → review → register letter (intake only) |

Shared HTTP entry: `POST /api/workflow/letters/{id}/execute` / `execute-with-letter`  
Frontend: Workflow tab panels, row actions, onboarding `WORKFLOW_PIPELINE`.

### Enterprise happy paths (today)

- **Information:** Registered → Validated → Classified → Routed → Information Delivered  
- **Actionable:** … → Pending Routing Approval → Action Assigned → In Progress → Response Drafted → Under Approval → Approved for Dispatch → Dispatched → Closed  

Supporting entities: `RouteStep`, `ActionItem`, `ResponseVersion`, `ApprovalStep`, `DispatchRecord`.

### Pain / mismatch with desired product

- Role-gated, department-tiered approval does not match “mark to **any** user, unlimited depth.”
- Single letter status cannot express parallel multi-recipient Info + Action channels.
- No first-class **revoke** of a mark before the recipient remakes onward.
- No per-marking **track / pathway notify / reminder** model with email provision.
- Initiator identity is implicit (`created_by`) but close/dispatch rules are not “initiator holds → close.”

---

## 2. What we keep unchanged in v1

- Manual letter registration and AI-assisted registration (OCR/LLM) as **intake**.
- PostgreSQL + local document storage.
- In-app `cms_notifications` and audit (`cms_audit_records`).
- Existing archive behavior (letter `Archived`).
- Viewer role remains read-only for mutations.

---

## 3. Cutover stance

**Replace** the enterprise letter lifecycle as the active path:

- New marking APIs and Workflow UI become canonical.
- Enterprise actions (validate, classify, approve_routing, multi-tier approve, dispatch) are removed from available actions / UI.
- Legacy `TRANSITION_RULES` that conflict with marking are disabled for the active path.
- Old enterprise tables may remain for historical rows during migration (see spec 08); new work does not write them.

AI registration still creates a `Letter` (typically at `LLM Analyzed` or equivalent). After cutover, that letter is treated as **Open** with the registrar as **initiator / initial holder**.

---

## 4. Key files (baseline inventory)

| Path | Notes |
|------|-------|
| `backend/app/enterprise_workflow_service.py` | To be retired from active path |
| `backend/app/workflow_service.py` | Slim / redirect to marking |
| `backend/app/routers/workflow.py` | Replace or parallel with marking router |
| `backend/app/models.py` | RouteStep / ActionItem / … retained read-only initially |
| `frontend/components/cms/letter-panels.tsx` | Enterprise UI to replace |
| `frontend/services/workflow.ts` | Client for old API |
| `frontend/services/letter-actions.ts` | Status button matrix to replace |
| `frontend/lib/onboarding.ts` | `WORKFLOW_PIPELINE` to rewrite |
| `AILMS Workflow.drawio` | Historical design reference only |

---

## 5. Success definition for this doc pack

Readers can answer:

1. Why the enterprise machine is being replaced.  
2. What intake vs lifecycle means after cutover.  
3. Which specs to implement next (`01` domain → `09` acceptance).
