# Order Portal copies (#249)

Every Order placement (Orders Module) and submitted Payment proof (Payments
Module) gets one Portal copy for each eligible Staff member. Other event kinds
are left for the remaining slices in #243. The feed's existing SQL visibility
predicate is reused. Portal backend authentication scopes the directory to the
calling System, and excludes Deleted Users, Users still using a Temporary
password, and revoked grants. Portal User ids, not usernames or Neon Auth ids,
are the inbox recipients.

The first successful directory lookup snapshots each alert's audience in one
CREOMS transaction. Delivery retries recheck current Modules before creating an unsent copy.
If a send response was lost, CREOMS recovers the already-sent copy by its key,
including after revocation. No Portal notification is deleted on revocation. Opening the linked
Order still requires current CREOMS Module access. A new grant does not replay
alerts whose audience was already resolved.

## Contract

- `POST <Portal>/api/integrations/recipients`, authenticated with the existing
  System Basic credentials, returns `{ staff: [{ id, modules: ["Orders"] }] }`.
  It accepts no System id or audience from the request body. It is never cached.
- CREOMS calls gateway `/notifications/notifications` with `sendingApp: "CREOMS"`,
  `targetApp: "Portal"`, and one saved Portal User id. The Portal displays the
  CREOMS badge. Both `type` and `idempotencyKey` are `creoms.order.<ledger-id>`.
  Title/body use the existing feed description; link is the matching `/orders/:id`
  under `CREOMS_APP_URL`.
- Idempotency is scoped by sending app, target app, User and key in notifications.
  An uncertain response is retried using the same key. If no new row is returned,
  CREOMS finds the original by its indexed retry key via `/notifications/lookup`.

## Read state and failures

The existing shared CREOMS read state is preserved: a read by any eligible Staff
member clears that alert and all its Portal copies. CREOMS read actions reconcile
copies immediately; Portal reads reconcile on the next poll, signal or scheduler
sync. No webhook or additional browser session is needed. Exact lookups by id or sender/key avoid paging through inbox history. All HTTP
work shares one four-second abort deadline, and remote read state is monotonic. Mark-all-read uses the same
path. Failed sends and failed read updates remain pending for the next sync.

Each recipient failure is isolated. A directory failure leaves unresolved alerts
for retry and still reconciles existing copies. Copy work is bounded in batches
of ten with a four-second scheduling budget per delivery/read phase; HTTP calls
have three-second timeouts. Each phase selects at most 100 pending copies, with
oldest attempts first for fairness. Lookups do not depend on inbox size. The HTTP deadline covers the whole
copy sync, so slow requests cannot hold the feed indefinitely. Copies never roll back an alert, hide the CREOMS feed or prevent other event
syncs. Signal nudges go out before copy work, after the alert commits.

## Rollout

1. Deploy the Portal directory/badge and notifications `/notifications/lookup`
   dependencies first.
2. Ensure notifications #245 is deployed and its
   `0004_notification_idempotency.sql` migration is applied.
3. Run `docs/db/crms-portal-copies.sql` as `creoms_writer` before deploying CREOMS.
   It adds only CREOMS tables/indexes and is safe to re-run. No storefront or
   Portal schema changes are required. New installs include it in crms-schema.sql.
4. CREOMS needs its existing `PORTAL_URL`, `PORTAL_SYSTEM_NAME`,
   `PORTAL_SYSTEM_SECRET`, `CREOMS_APP_URL`, gateway Caller key and writer URL.
   No new secrets are required.
5. Run the authenticated sync. Existing Order alerts get copies too; there is no
   replay of Orders for which the ledger never created an alert. Confirm one
   copy per eligible Staff member and check reads in each direction. Grant
   revocation leaves the old copy in the inbox while CREOMS denies its link.

Migration verified against the configured Neon database as `creoms_writer` on
2026-10-26. The notifications idempotency column was already present.
