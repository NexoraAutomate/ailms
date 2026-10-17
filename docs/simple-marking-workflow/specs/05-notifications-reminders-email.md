# Spec 05 — Notifications, Reminders, and Email Provision

## A. Purpose

Deliver in-app notifications for marking events, optional pathway subscriptions, automatic reminders for `response_required`, and a **provisioned** email channel (disabled until SMTP is configured).

## B. Preconditions

- Specs 01–04 domain and marking services.
- Existing `cms_notifications` + `add_notification`.
- Existing `cms_reminder_log` dedupe pattern (extend or parallel table keyed by marking).

## C. Inputs

### Events that notify

| Event | Recipients |
|-------|------------|
| Mark created | Each `to_user` (always) |
| Mark revoked | `to_user` |
| Response submitted | `from_user` of that marking |
| Letter closed | Pathway subscribers + users on active/recent markings |
| Downstream mark (pathway) | Subscribers for that letter/batch |
| Reminder due | `to_user` of RR marking |

### Reminder schedule (v1 presets)

Relative to `due_at` (date, end of day local or UTC—document UTC):

| Key | When | Priority |
|-----|------|----------|
| `rr_one_day_before` | due_at − 1 day | Medium |
| `rr_on_due` | due_at day | High |
| `rr_overdue` | due_at + 1 day (and optionally daily after) | High / emphasis |

Only if `reminders_enabled` and marking `active` and `action=response_required`.

### Email config (provision)

Environment / settings:

```text
MAIL_ENABLED=false
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
SMTP_TLS=true
```

## D. Processing

### D.1 In-app channel

Use `add_notification` with `letter_id`, sensible `notification_type` values:

- `Correspondence Marked`
- `Marking Revoked`
- `Response Received`
- `Correspondence Closed`
- `Pathway Update`
- `Response Reminder`

### D.2 Pathway subscription

When batch `pathwayNotify=true`, marker receives notifications when:

- Any descendant marking is created under that batch’s markings.
- Responses / revokes / close on that letter (scoped if feasible).

### D.3 Reminder worker

Background job (interval ≥ 15 min or daily cron):

1. Select active RR markings with `reminders_enabled` and `due_at` set.
2. For each schedule key, if due and not yet logged in reminder dedupe table → send in-app notification (+ email enqueue if enabled).
3. Insert dedupe row `(marking_id, reminder_key, anchor_date)`.

### D.4 Email channel (stub)

```text
NotificationDispatcher
  → InAppChannel (always)
  → EmailChannel (if MAIL_ENABLED and SMTP_HOST set; else no-op)
  → optional OutboundEmailQueue row for retry later
```

v1: implement interface + queue table or log; **do not** require working SMTP for acceptance.

## E. Outputs

- Notification rows in Notifications center.
- Reminder dedupe rows.
- Optional `cms_outbound_emails` (to, subject, body, status=`pending|sent|skipped|failed`).

## F. Components

| Component | Action |
|-----------|--------|
| `backend/app/notification_channels.py` | Dispatcher + channels |
| `backend/app/marking_reminders.py` | Worker entry |
| Settings / `.env.example` | SMTP vars |
| Frontend notifications UI | Existing center lists new types |

## G. Data model

Extend reminder dedupe to marking scope; optional outbound email table.

## H. API contract

No user-facing reminder API required in v1 beyond existing notifications list. Optional:

- `POST /api/markings/{id}/reminders` toggle (if not only set at mark time).

## I. Acceptance

- [ ] Mark always creates in-app notification for recipient.
- [ ] Pathway flag causes marker to see downstream mark events.
- [ ] Reminder worker emits one-day-before / on-due / overdue without duplicates.
- [ ] With `MAIL_ENABLED=false`, system remains healthy; EmailChannel is no-op.
- [ ] With mail enabled (manual test), queue/send path exists (documented).
