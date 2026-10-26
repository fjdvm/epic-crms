# Staff signal path (#244)

The storefront calls `POST /creoms/notifications/signal` on api-gateway with its
Caller key. The gateway requires `systemCode: ECOM` from the trusted Caller map,
retains the shared rate limit, and calls CREOMS's `POST /api/notifications/signal`
with a separate `CREOMS_SIGNAL_SECRET`. Neither endpoint uses the request body
or query to identify an event. The gateway sends `{}` and drops Caller headers;
CREOMS discovers events from storefront SQL. A fabricated or repeated payload
can only request a sync, never manufacture an alert or choose its audience.

The signal syncs the same five feeds as the poll. Each feed commits its existing
ledger and alert transaction independently, so one failing feed does not hide
successful feeds. If any alerts were created, CREOMS sends a best-effort nudge
only after those transactions commit. The nudge is a notification-service message
with type `creoms.staff.changed`, static title `Staff feed changed`, static body
`Refresh the Staff feed.`, sending/target app `crms`, and shared user id
`creoms-staff`. It contains no event id, Customer data, count or Module data.
The service stores throwaway rows for this channel, as agreed in #243; those rows
are not the Staff feed or its read state.

`staffNotificationsLiveUrl()` is a Server Action that calls `getShell()` before
requesting a 60-second Live ticket for that shared channel. An invalid session,
non-Staff identity or Staff member with no CREOMS access receives no ticket.
A gateway fault returns null so polling can continue. The socket address is
`/notifications/live?ticket=...`, using the existing notifications inbox socket
and gateway ticket validation. Each browser fetches the CREOMS feed after a
nudge, where current Portal Modules determine visibility. Connecting the bell is
#247; sending the first storefront Order signal is #246. Neither UI nor sender
integration is included in this backend ticket.

## Coalescing and failures

`crms.notification_signal_state` records request/processed generations, a
one-second cooldown and a 90-second lease with a unique owner. Claiming the
lease is one conditional UPDATE; concurrent instances coalesce instead of
holding a database connection or lock through network work. This works with
Neon's transaction pooler. The request is limited to 60 seconds and releases its
lease in `finally`; an interrupted request's lease expires automatically. Only
the current owner can renew or release it. Signals arriving during the first
run can cause one additional catch-up run; a remaining tail is covered by the
next signal or poll. If an unusually slow/expired worker overlaps a successor,
the existing per-feed ledger transactions still prevent duplicate alerts.
Polling does not depend on this lease and remains available during recovery.

CREOMS returns 202 with `{ accepted: true, coalesced }` after its attempt or when
coalesced; it never returns event details. An unavailable coordinator returns
503. Individual sync failures are logged and retried by subsequent syncs; a
failed nudge never rolls back alerts. The gateway preserves an upstream status,
returns 502 on network/timeout faults, and fails closed with 503 if unconfigured.
The unchanged five-second browser poll still discovers and returns alerts when
no signal arrives. Live delivery and signals are best effort, not a replacement
for polling.

## Order placement and upgrade

Every newly observed Order has one placement key `order-placed:<id>`, even when
Pickup, Cash on Delivery, GCash, already quoted, or progressed between reads.
An unquoted placed Delivery Order retains kind `order-delivery-fee` and says a
Delivery fee is needed. Other placements use `order-placed` and say the Customer
placed the Order. Both require the Orders Module. GCash proof remains a separate
`order-payment-proof:<id>` event requiring Payments.

**Apply `docs/db/crms-staff-signals.sql` as `creoms_writer` before deploying the
CREOMS change.** This is a CREOMS-only schema migration: it adds the new kind,
the wider Order baseline marker and coordinator table. It preserves old Delivery
placement keys and existing notifications/read state, and is safe to re-run.
The first widened sync baselines historical Orders that previously had no
placement event, avoiding an old Pickup alert flood; the existing actionable
Delivery/proof rules continue during this upgrade. Run the normal authenticated
sync once after migration and deployment to establish that baseline before
activating the new signal sender. New installs retain the existing first-sync
baseline behavior. No storefront schema, grants or credentials are changed.

Set a random `CREOMS_SIGNAL_SECRET` of at least 32 characters in both CREOMS and
api-gateway, set gateway `CREOMS_URL` to CREOMS's HTTPS origin, and ensure the
storefront Caller has `systemCode: ECOM` and CREOMS's Caller resolves to app
`crms`. CREOMS still needs its existing gateway Caller key and reader/writer
connection strings. Keep every key server-side. This signal secret is separate
from both the storefront Caller key and scheduler `CREOMS_SYNC_SECRET`.

For rollout verification, apply the SQL and configure both ends, baseline, then
create a Pickup Order and send a storefront-authenticated gateway signal. Verify
one Orders alert, a content-free nudge after it exists, no duplicate after a
repeat signal, and discovery by the five-second poll without signaling. Verify
wrong/missing Caller keys and an anonymous Live-ticket action are refused. These
live checks require deployment access; automated tests use throwaway SQL, the
fake Portal boundary and HTTP stubs without production services.
