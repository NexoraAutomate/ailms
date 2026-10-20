# PMS Integration — Open Questions & Contract Intake

**Purpose:** Isolate unknowns so implementation does not invent SUPARCO PMS API details.  
**Owner:** AILMS team + PMS developer/colleague.  
**Rule:** Until a row is marked **RESOLVED**, related code must use configurable placeholders / adapter stubs.

---

## A. Authentication

| ID | Question | Status | Answer / notes |
|----|----------|--------|----------------|
| A1 | Auth method? (OAuth2 client credentials, API key, mutual TLS, session cookie, other) | OPEN | |
| A2 | Token endpoint URL and grant parameters | OPEN | |
| A3 | Token lifetime and refresh rules | OPEN | |
| A4 | Credential delivery channel (vault, env, mutual exchange) | OPEN | |
| A5 | IP allowlisting or VPN requirements | OPEN | |

---

## B. Transport & environment

| ID | Question | Status | Answer / notes |
|----|----------|--------|----------------|
| B1 | Base URL (dev / staging / prod) | OPEN | |
| B2 | TLS requirements / corporate CA | OPEN | |
| B3 | Rate limits | OPEN | |
| B4 | Expected max payload size / page size | OPEN | |

---

## C. Resources & endpoints

| ID | Question | Status | Answer / notes |
|----|----------|--------|----------------|
| C1 | Projects list/detail paths | OPEN | Do not invent |
| C2 | Milestones path and project association key | OPEN | |
| C3 | Risks / issues available? | OPEN | Optional resource |
| C4 | Actions available? | OPEN | Optional |
| C5 | Dependencies available? | OPEN | Optional |
| C6 | Pagination style (page/offset/cursor/Link header) | OPEN | |
| C7 | Incremental sync parameter (updated_since / etag / cursor) | OPEN | |
| C8 | Filtering by organization / portfolio | OPEN | |

---

## D. Identifiers & enums

| ID | Question | Status | Answer / notes |
|----|----------|--------|----------------|
| D1 | Stable external project ID field name | OPEN | **Must not** use name as unique key |
| D2 | Project code field (if distinct from ID) | OPEN | Used for exact letter matching |
| D3 | Milestone external ID field | OPEN | |
| D4 | Approved project status values | OPEN | |
| D5 | Milestone status values | OPEN | |
| D6 | Progress percentage field semantics (0–100? weighted?) | OPEN | |
| D7 | Timezone of date fields (UTC vs local) | OPEN | Store UTC-aware sync metadata |

---

## E. Sample payloads

| ID | Artifact needed | Status |
|----|-----------------|--------|
| E1 | Sanitized project list response | OPEN |
| E2 | Sanitized project detail | OPEN |
| E3 | Sanitized milestone list | OPEN |
| E4 | Auth token success/error samples | OPEN |
| E5 | Empty / partial / error response samples | OPEN |

Store approved samples under `backend/tests/fixtures/pms/` once received. **No production confidential data.**

---

## F. Product / policy

| ID | Question | Status | Answer / notes |
|----|----------|--------|----------------|
| F1 | Which roles see Project Intelligence by default? | OPEN | Proposal in master plan §7 |
| F2 | Auto-accept policy for exact ID matches only? | Assumed YES for pilot | Confirm |
| F3 | Allowed org/vendor alias list source | OPEN | |
| F4 | Stale-data threshold (default proposed 4h) | OPEN | |
| F5 | Sync interval (default proposed 3h) | OPEN | |
| F6 | Multi-instance deployment planned? | OPEN | Affects scheduler lock design |

---

## G. Intake checklist (Phase 1 exit)

- [ ] Approved API documentation attached or linked
- [ ] Credentials issued for non-prod
- [ ] Sample JSON fixtures sanitized and filed
- [ ] This file updated with RESOLVED answers
- [ ] `pms_mappers.py` contract freeze reviewed
