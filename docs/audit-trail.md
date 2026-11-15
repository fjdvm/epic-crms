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
in `instrumentation.ts` (kind = error name + route) and the two cron routes (`cron:feedback-analysis`,
`cron:scheduled-announcements`). The stock auto-release job runs in the storefront, not CREOMS, so it reports from
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
