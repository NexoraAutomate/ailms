# Spec 08 — Frontend Project Intelligence

## A. Purpose

Extend the existing Next.js CMS with a **Project Intelligence** section. Reuse current UI library, styling, navigation, authentication, and dashboard patterns. No parallel design system.

## B. Preconditions

- Spec 07 API available (or mocked for UI development).
- Auth session already used by CMS shell.

## C. Navigation

Update `frontend/lib/cms-nav.ts`:

- Add label **Project Intelligence** (suggested group: Management or new subgroup under AI Intelligence).
- Map to `/intelligence` (overview).
- Child routes as needed; keep sidebar simple (one primary entry; in-page tabs/subnav OK).

## D. Routes

| Path | Screen |
|------|--------|
| `/intelligence` | Executive overview cards + stale banner + sync freshness |
| `/intelligence/alerts` | Alert list with filters |
| `/intelligence/alerts/[id]` | Evidence, linked refs, review actions |
| `/intelligence/projects/[id]` | Project/milestone details + linked letter references |
| `/intelligence/matches` | Match confirmation workflow |

Thin `page.tsx` files mount components under `frontend/components/cms/intelligence-*.tsx` (same pattern as letters/dashboard).

## E. UI features checklist

1. Executive overview cards (real API counts)
2. Alert list: severity + review status
3. Project and milestone details
4. Linked correspondence references (respect ACL — show restricted placeholder)
5. Evidence view (why alert fired)
6. Match confirmation workflow (confirm / reject / pick alternate)
7. Sync status + last successful update
8. Filters: project, alert type, severity, date, status

### Alert status distinction (must be visible)

| Backend status | UI label |
|----------------|----------|
| `open` | System-detected |
| `confirmed` | Human-confirmed |
| `dismissed` | Dismissed |
| `resolved` | Resolved |

### Stale data

- Visible warning banner when `dataStale === true`.
- Do not present stale timestamps as “current” without the warning.

## F. States

Every view implements:

- **Loading** (skeleton or existing spinner pattern)
- **Empty** (honest empty copy)
- **Error** (API failure message; retry if pattern exists)

No decorative charts with fabricated values.

## G. API client

`frontend/services/intelligence.ts` using `lib/api.ts` conventions (Bearer from existing auth).

## H. Permissions

- Hide admin sync trigger unless administrator.
- Hide review actions without permission.
- Match confirm only when letter accessible (API enforces; UI disables on 403).

## I. Acceptance

- [ ] Nav entry works
- [ ] Overview/alerts/matches load real data
- [ ] Stale banner shows when flagged
- [ ] Empty/error/loading covered
- [ ] Existing CMS pages unaffected
