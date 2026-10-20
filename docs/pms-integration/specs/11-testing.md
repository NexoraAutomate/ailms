# Spec 11 — Testing & Acceptance

## A. Purpose

Automated tests for PMS integration using **mocked / sanitized fixtures only**. No live SUPARCO PMS. No destructive ops against the developer’s primary database — use isolated test DB or transactional fixtures consistent with existing suites.

## B. Preconditions

- pytest configured (`backend/pytest.ini`).
- Fixtures under `backend/tests/fixtures/pms/`.

## C. Test modules (suggested)

| Module | Coverage |
|--------|----------|
| `test_pms_client_auth.py` | Auth + token refresh |
| `test_pms_client_pagination.py` | Multi-page fetch |
| `test_pms_client_retries.py` | Timeouts, retry limits |
| `test_pms_client_validation.py` | Invalid / partial responses |
| `test_pms_sync_idempotent.py` | Upsert, duplicate external IDs |
| `test_pms_sync_failure_preserves_cache.py` | Failed sync keeps rows |
| `test_pms_dates.py` | Timezone / date normalization |
| `test_project_matching_exact.py` | Exact identifier matches |
| `test_project_matching_ambiguous.py` | Human confirmation required |
| `test_project_matching_reject.py` | Rejected matches |
| `test_intelligence_milestone_slip.py` | Forecast vs baseline |
| `test_intelligence_alert_dedupe.py` | Deduplication |
| `test_intelligence_alert_resolve.py` | Resolution / auto-clear |
| `test_intelligence_stale.py` | Stale warnings |
| `test_intelligence_authz.py` | 401/403 |
| `test_intelligence_letter_visibility.py` | Letter redaction |
| Frontend | Loading / empty / error (component or e2e as repo practice allows) |

## D. Required scenarios (trace to requirements §12)

- [ ] API client authentication and token handling
- [ ] Pagination
- [ ] Timeouts and retry limits
- [ ] Invalid and partial responses
- [ ] Idempotent synchronization
- [ ] Duplicate external IDs
- [ ] Failed sync preserves cache
- [ ] Timezone and date normalization
- [ ] Exact identifier matching
- [ ] Ambiguous matching → human confirmation
- [ ] Incorrect / rejected matches
- [ ] Milestone forecast discrepancy
- [ ] Alert deduplication
- [ ] Alert resolution
- [ ] Stale-data warnings
- [ ] Authorization failures
- [ ] Letter-level visibility restrictions
- [ ] Dashboard loading / empty / error states

## E. Commands

```bash
cd backend
# Prefer isolated DB URL for integration tests
pytest tests/test_pms_*.py -q
pytest tests/test_intelligence_*.py -q
pytest tests/test_project_matching_*.py -q
```

Do not mark tests `live` against production PMS.

## F. Phase exit reporting

After each implementation phase, report:

1. Files changed
2. Migration impact
3. Tests run + results (honest failures)
4. Verify commands for manual smoke

## G. Acceptance

- [ ] CI-friendly suite green without PMS network
- [ ] No secrets in fixtures
- [ ] Definition of done (master plan §8) checklist signed off
