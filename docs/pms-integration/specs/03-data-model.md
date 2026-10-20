# Spec 03 — PostgreSQL Data Model (PMS Integration)

## A. Purpose

Add an **isolated** set of PMS cache and intelligence tables using existing SQLAlchemy conventions and `db_upgrade.py` (no Alembic). Preserve all existing `cms_*` tables.

## B. Preconditions

- Spec 01; Phase 1 audit (letter PK = `cms_letters.id` integer).

## C. Tables

### C.1 `pms_projects`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | Local |
| `external_id` | VARCHAR UNIQUE NOT NULL | PMS stable ID |
| `code` | VARCHAR | Indexed |
| `name` | VARCHAR NOT NULL | |
| `status` | VARCHAR | |
| `progress_pct` | NUMERIC/FLOAT NULL | |
| `owner_org` | VARCHAR | |
| `source_updated_at` | TIMESTAMPTZ NULL | From PMS |
| `last_synced_at` | TIMESTAMPTZ NOT NULL | Local sync |
| `source_payload_json` | TEXT NULL | **Optional**, restricted normalized subset only if justified |

Indexes: unique(`external_id`); index(`code`); index(`status`).

### C.2 `pms_milestones`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `external_id` | VARCHAR UNIQUE NOT NULL | |
| `external_project_id` | VARCHAR NOT NULL | Indexed; logical FK to project external_id |
| `name` | VARCHAR NOT NULL | |
| `baseline_date` | DATE NULL | Distinct from forecast/actual |
| `forecast_date` | DATE NULL | |
| `actual_date` | DATE NULL | |
| `status` | VARCHAR | |
| `source_updated_at` | TIMESTAMPTZ NULL | |
| `last_synced_at` | TIMESTAMPTZ NOT NULL | |

Optional FK from `external_project_id` to `pms_projects.external_id` if unique constraint allows.

### C.3 Optional `pms_risks`, `pms_actions`, `pms_dependencies`

Create **only** when corresponding approved APIs exist. Same pattern: local PK + unique external_id + external_project_id + status/dates + sync timestamps.

### C.4 `pms_sync_runs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `started_at` / `ended_at` | TIMESTAMPTZ | |
| `status` | VARCHAR | `running` \| `success` \| `partial` \| `failed` |
| `records_fetched` | INT | |
| `records_inserted` | INT | |
| `records_updated` | INT | |
| `records_rejected` | INT | |
| `cursor` | VARCHAR NULL | Incremental sync cursor |
| `error_summary` | TEXT | Sanitized |
| `triggered_by` | VARCHAR | `scheduler` \| `admin:<username>` |

### C.5 `letter_project_links`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `letter_id` | INT NOT NULL FK → `cms_letters.id` ON DELETE CASCADE | **Actual** letter PK |
| `external_project_id` | VARCHAR NOT NULL | |
| `external_milestone_id` | VARCHAR NULL | |
| `match_method` | VARCHAR | e.g. `exact_code`, `exact_external_id`, `alias`, `contextual`, `manual` |
| `match_score` | FLOAT NULL | Ranking only — not calibrated probability |
| `match_status` | VARCHAR | `suggested` \| `confirmed_exact` \| `confirmed_manual` \| `rejected` \| `unmatched` |
| `evidence_summary` | TEXT | Extracted snippets / reasons |
| `confirmed_by` | VARCHAR NULL | User display name |
| `confirmed_at` | TIMESTAMPTZ NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Constraints:

- Unique active link policy: e.g. unique(`letter_id`, `external_project_id`) where status not rejected — finalize in implementation.
- Indexes on `letter_id`, `external_project_id`, `match_status`.

### C.6 `intelligence_alerts`

| Column | Type | Notes |
|--------|------|-------|
| `id` | SERIAL PK | |
| `alert_type` | VARCHAR NOT NULL | Rule id |
| `dedupe_key` | VARCHAR UNIQUE NOT NULL | Stable |
| `external_project_id` | VARCHAR NULL | |
| `external_milestone_id` | VARCHAR NULL | |
| `letter_id` | INT NULL FK → `cms_letters.id` ON DELETE SET NULL | |
| `title` | VARCHAR | |
| `description` | TEXT | Concise |
| `severity` | VARCHAR | e.g. `info` \| `warning` \| `critical` |
| `evidence_json` | TEXT | Structured refs + calculation details |
| `rule_name` | VARCHAR | |
| `rule_version` | VARCHAR | |
| `status` | VARCHAR | `open` \| `confirmed` \| `dismissed` \| `resolved` |
| `reviewed_by` / `reviewed_at` | | |
| `resolution_notes` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### C.7 Optional `pms_project_history`

Record meaningful changes only (progress delta, status change, baseline/forecast/actual date change). Avoid identical snapshots.

## D. Migration approach

1. Add SQLAlchemy models in `models.py`.
2. Implement `upgrade_pms_integration_schema(engine)` in `db_upgrade.py` (CREATE IF NOT EXISTS + indexes).
3. Call from `main.on_startup` after existing upgrades.
4. Document reversible down-SQL in this spec appendix for operators.

**Do not** silently DELETE cached projects on sync failure.

## E. Data hygiene rules

- UTC-aware timestamps for sync metadata.
- No credentials/tokens in tables.
- No full confidential letter bodies in integration tables (evidence summaries only, truncated).
- Baseline / forecast / actual remain distinct columns.

## F. Acceptance

- [ ] Fresh DB: tables created on startup
- [ ] Existing DB: upgrade idempotent
- [ ] FK to `cms_letters` works
- [ ] Unique external IDs enforced
