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
