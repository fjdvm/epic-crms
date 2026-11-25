# CREOMS Audit Events

Announcement actions and Feedback analysis use `AuditTrail` in `lib/audit-trail.ts`.
Tests replace that function with a fake. `recordAudit` contains the shared
best-effort policy, including protection against a throwing injected port.
The gateway adapter also applies it when called directly.

Producers supply an operation identity. Feedback uses its persisted run id;
Announcement forms generate a token for each submitted action and pass it as a
serialized Server Action argument. A transport replay retains that token; a new
action gets a new one even within the same millisecond. Draft creation derives
its UUID from the Staff id and request token and inserts only once, so replaying
a save also retains its Target. Scheduled sends generate
a token when they record their result; their persisted state prevents resending a
completed action. The gateway hashes the action, Target and operation identity into the
`idempotency_key` accepted by audit-logs. It adds Source `CRMS`, authenticates as
the `crms` Caller and bounds the request to five seconds. There is no retry queue.

Staff events carry Actor type `user`, the Portal User id and the display name at
the time of the action. Scheduled Feedback analysis remains a `process` Actor.

## Portal identity confirmation

The Portal's `lib/integrations/endpoints.ts`, `handleValidate`, returns
`user_id: result.userId`. Its `lib/integrations/validation.ts` gets that value
from `session.userId`; `lib/integrations/prisma-ports.server.ts` looks up the
User with `where: { id: userId }`. The profile's `username` is a different field.
CREOMS maps validation's `user_id` to `Staff.id`; it never substitutes a username
for a missing id. Announcement scheduling now persists this User id for the
scheduled send's Actor as well.

## Migration check for #257

On 2026-10-27 the configured CREOMS writer database contained zero Announcements
with `state = 'scheduled'`. There were therefore no pending schedule usernames
to convert. No schema changes are needed; earlier Audit Events are not backfilled.

## Orders and Payments (#258)

The public Order Server Actions record confirmed changes through the same
`AuditTrail`: `order.delivery_fee_quoted`, `order.confirmed`,
`order.cancelled` and `order.marked_paid`. Quoting a Delivery fee also confirms
the Order, but records only the fee-quoted event. Cancellation uses the Module
that authorized it (Orders or Payments); marking paid uses Payments.
Descriptions name the Staff member and Order, and quotes include the fee.
The Actor is the Portal User id, while existing storefront payment attribution
continues to use the Portal username.

These transitions each happen at most once per Order. Their operation identity
is the Order number and action, so it remains stable across retries and Staff.
The storefront's conditional transition accepts only one concurrent caller;
stale retries and refused or uncertain responses record no success event.
Audit failures are logged without changing the confirmed action result or its
page invalidation. No outbox or replay of uncertain storefront writes is added.

No schema migration or historical backfill is required. Tests drive the public
Server Actions with a fake AuditTrail and the existing fake storefront.

## Fulfilment and Returns (#259)

Fulfilment records `order.preparing`, `order.dispatched`, `order.delivered`
and `order.delivery_photo_attached` in the Fulfilment Module. The delivered
transition attaches its photo atomically in the storefront and emits two events.
Returns records `return.approved`, `return.declined`, `return.goods_received`,
`return.refunded` and `return.replaced` in the Returns Module. Each event names
the Staff member and Order or Return and carries the Portal User Actor.

Each transition occurs at most once for its Target, so the Target and action
provide a stable operation identity across retries. Refused, stale and uncertain
writes emit no success event. Confirmed delivery and refund events are recorded
before evidence promotion: promotion failure does not erase the saved change,
and reconciliation does not repeat its Audit Events. Audit delivery remains
best effort and never changes the action result.

No database migration or historical backfill is required.

## Tickets and Customer Profiles (#260)

Ticket claim, release, resolution and Priority changes record `ticket.claimed`,
`ticket.released`, `ticket.status_changed` and `ticket.priority_changed` under
Tickets. Messages remain solely in the Conversation. The Portal User id is used
for the Audit Actor; Ticket ownership continues to use the Portal username.
The Priority endpoint rejects unknown priorities and changes to Completed Tickets.

Mutation events retain a submission token in serialized Server Action arguments,
matching Announcements. Event identities include the Actor and token; the gateway
also hashes the action and Target. Interleaved replays therefore keep the same
key even when another action changed the row in between. Conditional updates
suppress unchanged retries. Each later submission gets a fresh token.
There is no outbox or replay after an uncertain database result.

Customer Profile access is recorded as `customer_profile.viewed` when its client
marker mounts, after the profile has become visible. Prefetching a page emits no
event. The marker retains a random navigation token across effect retries and
refreshes; reopening the profile mounts a new token. The authorized Server Action
re-reads only the Target identity, verifies that a storefront Customer is verified,
and sends the event through the same injected port. Missing profiles and Leads
emit nothing. Audit failures cannot affect the visible profile.

All events use the shared best-effort boundary. Tests drive the public actions
with a fake AuditTrail, with an in-memory Postgres for the database behavior.
No schema migration or historical backfill is required.

## CREOMS access (#261)

The successful Portal callback records `crms.signed_in` once per exchanged code.
The hashed opaque handle supplies the operation identity; neither the handle nor
code is sent to audit-logs. Refused page, Server Action and in-page Module guards
record `crms.access_denied`, naming the refused Module as the Target and in the
Description. Both use Source CRMS with no Module field. Sidebar discovery, held
Module checks and successful ordinary page loads do not produce access events.
An Order detail request allowed by any of its Modules produces no refusal events.

Portal exchange and 403 responses carry no Staff profile. After exchange, CREOMS
resolves the identity from a positive live validation of a registered Module and
stores the Portal User id and captured name against a SHA-256 hash of the handle,
with the handle's expiry. This attribution is never used to authorize a request.
Refusals refresh the display name through live validation when possible, falling
back to the saved identity after every Module is revoked. Old
sessions fall back to identity discovery through another held Module; if no
identity can be established (including a Portal outage), auditing logs the error
and leaves the access result unchanged. No username or browser-provided identity
is substituted. Expired attribution rows are removed at later sign-ins.

An atomic conditional upsert in `crms.access_audit_refusals` admits only one event
per Staff member and Module in a rolling 60 seconds, including concurrent
requests and different sessions or app instances. The operation identity includes
the Staff member, Module and minute. A failed delivery still consumes the cooldown;
there is no outbox or automatic retry. Storage failure suppresses the refusal
event rather than risking a flood, and sign-in delivery can proceed without
storage. All access audit work is best effort and bounded to five seconds.

Apply `docs/db/crms-access-audit.sql` as `creoms_writer` before deployment. It adds
only attribution and cooldown tables and an expiry index; it changes no existing
records. Fresh installations also include these in `crms-schema.sql`. Historical
sign-ins are not backfilled.

Migration verification (2026-10-27): applied twice on a temporary branch of the
configured ecommerce production database, verified table ownership and rolling
cooldown behavior as `creoms_writer`, then applied to the configured production
branch as that role. The temporary database branch was removed afterward.

## Error monitoring (#357)

`lib/error-monitor.ts` records every server error as a `system.error` Audit Event and emails the owner
(`OWNER_ALERT_EMAIL`, through the notifications App email) at most once per kind per hour; the throttle is the
`crms.error_alerts` table (`docs/db/crms-error-alerts.sql`), claimed by one atomic upsert. Sources: `onRequestError`
in `instrumentation.ts` (kind = error name + route) and the cron route (`cron:feedback-analysis`). The stock auto-release job runs in the storefront, not CREOMS, so it reports from
there. `/api/ready` checks both databases; `/api/health` stays liveness-only.

## Customer Tasks (#420)

`customer_task.created`, `customer_task.done`, `customer_task.reopened`,
`customer_task.due_date_changed` and `customer_task.reassigned` target the Customer
Profile and include the Task id. Due-date and reassignment metadata retain old and
new values. The actor id and display name come from Module validation.

Task changes commit their operation receipt and audit payload atomically. Unlike
the best-effort callers, Tasks use `deliverGatewayAuditEvent`, which acknowledges
delivery or throws. A failure leaves delivery pending; retrying the same action
sends its original event with the same gateway idempotency key, without applying
the change again. Concurrent delivery locks the receipt. No background polling is
introduced.

## Order placement and email outcomes (#572)

The storefront places Orders and sends the confirmation email, so CREOMS records what it finds. This
runs inside the existing storefront-signal sync (`/api/notifications/signal`, and the Staff-requested
sync): no timer and no polling (ADR-0005). `syncOrderAudit` reads Orders and `order_email_outcomes`,
and delivers `order.placed`, `order.email_sent` and `order.email_failed` under a `process` Actor
through the acknowledged gateway delivery. Operation ids are `order:<id>:order.placed` and
`order:<id>:email:<kind>:<status>`; delivered ids go in `crms.seen_order_audit_events`
(`docs/db/crms-order-audit-ledger.sql`, applied as creoms_writer), and the gateway's own idempotency key
backs it up. A refused delivery is not marked and is retried at the next signal. Pending and retrying
emails write nothing; failed then sent is two entries. Entries carry no ID number or Customer email
address; addresses are stripped from the failure reason. A refused Order action writes nothing here.
An email outcome change appears in the log at the next signal, so the storefront must signal CREOMS
when it saves one.

## Resent Status emails (#573, #605)

Order Details shows "Email not sent" with the reason for every `order_email_outcomes` row whose status is
`failed`, for any of the nine Status emails (`confirmation`, `payment-verified`, `payment-rejected`, `payment-expired`, `manager-review-started`,
`preparing`, `dispatched`, `completed`; `features/orders/status-emails.ts`). A row is one event
occurrence: the storefront adds a nullable `occurrence` text column (for example the rejection number) so two
rejections are two rows (`""` for an event that happens once; storefront migration 0053, applied to production and
granted to the read-only role by the storefront's `docs/sql/creoms-email-outcomes-grant.sql`), so no CREOMS migration is
needed. Staff and Managers holding the email's owning Module (confirmation: Orders; payment verified, rejected, expired,
Manager review: Payments; Preparing, dispatched, completed: Fulfilment) can resend it after a
confirm dialog; Admin only read.
`resendStatusEmail` asks the storefront (`POST /api/internal/orders/:id/email/resend`, body `{kind, occurrence,
staffId, staffName}`). The storefront resends under the email's stable id, so a repeat never sends twice; when
Notification already accepted the email it reconciles the delivery status first, sends nothing and answers
`status: "reconciled"` (otherwise `"sent"`), echoing `kind` and `occurrence`. Either answer records the outcome as
`sent`, which clears the notice. A Resend reaches a Customer, so it waits for the server and is never optimistic.
The Refunded email (`return-refunded`, #616/#617) is owned by Returns: its occurrence is the Return's id, it is shown on the Return page as well as the Order, and a failed send never reverses the refund. That endpoint is the storefront's to provide. Each success writes `order.email_resent` (module = the owning
Module) with the person's name, the kind, the occurrence, whether it was reconciled, and a fresh operation id
(a second Resend of a different event is a second entry). A refusal changes and audits nothing, and a failed
email never reverses the saved update. The #572 sync records the failed-to-sent change as a system
`order.email_sent` (operation id includes the occurrence), so one resend can show two entries: who asked, and what
the storefront then recorded.

## Automatic Reservation expiry (#675)

When the storefront cancels an unpaid Online-payment Order because its payment window passed, it saves a
`customer_notifications` row keyed `order.expired:<id>` in the same transaction as the cancellation, and for
no other cancellation. `syncOrderAudit` reads those rows and delivers one `order.expired` event per Order,
linked to the Order, under the `process` Actor "Unpaid Order expiry". The operation id is
`order:<id>:order.expired`, so a retry or repeated signal adds nothing. A Staff or Manager cancellation saves
no such row and is audited only as `order.cancelled`. Apply `docs/db/creoms-expiry-audit-readonly.sql` as the
storefront table owner (grants `creoms_readonly` SELECT on `customer_notifications`); deploy the storefront's
expiry first.

## Coverage guard (#742)

`tests/audit-coverage.test.ts` fails when a write has no Audit Event. A write is every exported function in a
`"use server"` file under `features/` or `lib/`, every `POST`, `PUT`, `PATCH` or `DELETE` route handler under
`app/api`, and the cron `GET` routes. `tests/audit-coverage-scan.ts` parses the source and follows calls through
imports (five hops, never into `lib/portal/`, whose guards audit refusals for every action) looking for the
audit boundary: `recordAudit`, `deliverGatewayAuditEvent`, the injected `AuditTrail` or an audit helper built on
them. A type or `staffAuditActor` alone does not count. The check is static: it shows the code can record an
event, not that every branch does, so the behavioural tests through a fake `AuditTrail` still carry that proof.

A unit with no path to the boundary must be on the exemption list at the top of the test, with a reason:
`read-only:` (changes nothing), `own-state:` (a person's own view state) or `gap: group N` (still to close in
#741; each group PR deletes its entries). A stale entry (now audited, or the unit is gone) also fails, so the
list only shrinks. A new write action therefore ships with an Audit Event or a reviewed exemption.

### Pending audit records (#743)

Money and Manager-approval actions keep their Audit Event in `crms.pending_audit_records`
(`docs/db/crms-pending-audit.sql`, applied as `creoms_writer`; safe to rerun) and deliver it afterwards, so an outage
at the Portal never leaves an approval unrecorded and never blocks the person. `lib/pending-audit.ts` is the one
mechanism later tickets reuse: `savePendingAudit(tx, event)` saves the event (pass the action's own transaction to commit
them together), `deliverPendingAudits(sql, deliverGatewayAuditEvent)` sends the oldest pending records through the
acknowledged gateway delivery. A failed delivery leaves the record pending (attempts and a short error are kept) and never
throws; a record another caller is delivering is skipped. The record's key is the gateway's own idempotency hash of the
action, Target and operation identity, so a replayed action saves one record and a retry never adds a second event.

Retries follow ADR-0005 (no polling): each action delivers its own record and any older pending ones when it runs, and
`GET /api/cron/pending-audits` (`.github/workflows/pending-audits.yml`, `Authorization: Bearer $CRON_SECRET`) is the
server-side backstop.

Proven on Payments "approve anyway" (`payment.approved_anyway`, `features/orders/actions.ts#markPaid`). The change itself
is saved by the storefront, which CREOMS cannot join in a database transaction, so the record is saved right after the
storefront confirms (a crash in that gap loses the event, as before); if the pending record cannot be saved the event
falls back to the best-effort path. A refused attempt (Staff "Request approval", a missing reason, no Order chosen, a
reference already allocated) records the same action with outcome `failure` and the reason, with an identity per person and
attempt so a replay stays one event. Metadata holds ids and the reason only, never the payment reference. Later groups
that use a CREOMS-side transaction (refunds, write-offs, store credit) should save the record in it.

### Event naming and metadata

- Name: `module.past_tense`, lower case, for example `order.confirmed`, `return.refunded`,
  `customer_task.done`. Existing names are kept; gaps follow the same style.
- Outcome: `success` for a saved change; `failure` for a denied or failed attempt, with the reason in the
  description (Staff "Request approval" blocks and access denials included).
- Actor and Target: the Portal User id and display name; the Target is the Order, Return, Ticket or Customer id.
- Metadata: ids and before/after values only. Never an ID number, payment reference, proof image, email address
  or other contact detail; Customer Profile changes list field names, not values.
- Operation identity: stable per action and Target (plus a submission token when the action can repeat), so a
  replay records one Audit Event.

## Orders denied attempts (#744)

Confirm (delivery fee quote), cancel, reject, item cancellation, the Customer's cancel request decisions, Status email
resend and the COD "ask GCash first" choice record a `failure` event when refused or failed (read-only Role, stale
Order, validation, storefront refusal). It has the same action name as the success event, the reason in the
description and as `metadata.reason`, and the operation id `order:<id>:<action>:denied:<staff id>:<hash of attempt and
reason>`, so a replayed refusal records once. Resends and COD choices that succeed still get a fresh id per click.

## Payments gaps (#745)

Mark paid and reject proof (asking the Customer for a new one) record a `failure` event when refused or failed, through
the same path as #744; an approve-anyway refusal keeps its own `payment.approved_anyway` failure event, never two.
Claiming and handing over a Manager payment review (`payment_review.claimed`, `payment_review.reassigned`) and the Proof
reader corrections (`payment_proof.corrected`, `payment_proof.flag_overridden`) do the same, with the operation id
`...:denied:<staff id>:<hash of the reason>`. A refused correction names the Order once it is known, otherwise the payment
proof; its metadata holds only the proof id, the field and the reason, never the typed value or the reading (the success
events keep their earlier before/after values). Successful claims, hand-overs and corrections now have stable operation
ids (person, target and what changed) instead of a random one, so a replayed action records one event. Known limit: with
no submission token, a later identical repeat (the same Manager claiming the same Order again, or the same correction
made twice) shares that identity; adding a token to these forms would close it.

## Fulfilment gaps (#746)

Pack (`order.preparing`, now recorded on success; it had no event), dispatch, dispatch update and delivered record a
`failure` event when refused or failed, through the same path as #744: the same action name, the reason, and the operation
id `order:<id>:<action>:denied:<staff id>:<hash>`, so a replayed refusal records once. A delivery that was saved but whose
photo could not be made Permanent is not a refusal and records no failure event.

Failed delivery records `failed_delivery.recorded`, `.rebooked`, `.restocked` and `.written_off` (metadata: attempt id, and the
next step for a recording; never the reason text, message, courier or rider details). Restock and write-off, and the dispatched
cancellation request (`order.cancellation_requested`) and its settlement (`order.cancelled_after_dispatch`), use the pending
audit record of #743 (`features/orders/fulfilment-audit.ts`). The attempt id or request id is the operation identity, so a
replay keeps one record. A write-off waiting for a Manager is the approval workflow's own event, not a denied attempt.
Refusals of all of these (read-only Role, Staff "Request approval", stale Order, storefront refusal) are `failure` events.
Known limit: the cancellation request is saved right after the storefront confirms it, so a crash in that gap loses the event.

## Returns gaps (#747)

Return decisions (approve, decline, goods received, refunded, replaced, and a Manager's `return.decided` choice), inspection,
write-off, Refund window extension, Refund destination change, refund proof save and the Proof reader corrections record a
`failure` event when refused or failed, through `features/returns/returns-audit.ts`: the same action name as the success event, the
reason in the description and as `metadata.reason`, and the operation id `<return|order>:<id>:<action>:denied:<staff id>:<hash>`, so a
replayed refusal records once. A request waiting for a Manager is the approval workflow's own event, and a refund saved whose proof
could not be made Permanent is not a refusal. Metadata holds ids and the reason only: an inspection records its inspection id and the
sellable/damaged counts, never the typed values of a correction.

Refund, replacement (and its Replacement Order), inspection (sellable goods go back to stock), write-off, Refund window extension and
Refund destination change save a pending audit record first (#743); the Return id plus the inspection, window or change identity
makes a replay one event. Corrections now have a stable operation id (the correction row) instead of a random one.
There is no store credit or "hold batch" action in CREOMS yet; when they are built they join this group.
Known limit: the storefront saves the change before CREOMS saves the pending record, so a crash in that gap loses the event.
