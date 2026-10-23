# Return notifications (#173)

`syncReturnEvents` reads storefront Returns with the existing read-only connection and writes only to `crms`. Each Return has one stable request event keyed by its Return id. Later approval, decline, goods receipt, refund or Customer cancellation creates no additional notification. Requests remain discoverable after status changes, so a request is still seen if its Return progresses between polls.

The first successful sync records existing Returns without alerts, matching Order and Ticket notifications. Subsequent syncs use a transaction advisory lock and unique ledger keys to prevent duplicates, including concurrent runs. A failed source read cannot establish the baseline.

Alerts use the existing shared feed and shared read state: every Staff member currently permitted to open `/returns` can see them. Other Modules cannot see or clear them. Portal access is resolved anew for each poll or mark-read action, so revocation takes effect immediately. Text includes the Customer and `RMA-<number>`; the link opens the existing Order detail page, which already admits Returns Staff. Return detail UI belongs to later tickets.

Both browser polling and the bearer-authenticated scheduler sync Returns. A Return sync failure is isolated so the other notification feeds remain available; the scheduler reports `returns: { error: "sync failed" }`.

## Migration and rollout

Run `docs/db/crms-return-notifications.sql` as `creoms_writer` before deploying. It transactionally adds `notifications.return_id`, permits `return-requested`, and adds the request ledger and baseline table. It is safe to rerun and preserves existing notifications. Fresh installs use the matching `crms-schema.sql`.

The upgrade was applied twice against the existing schema in the throwaway integration database and on Neon branch `ticket-173-migration-check` (`br-gentle-snow-b35d2cwv`), cloned from production. The branch expires on 2026-10-24 at 07:37 UTC.

The same migration was applied to production on 2026-10-23 as `creoms_writer`. Verification confirmed the new column and ledger exist, both existing notifications were preserved, and no baseline was established prematurely.

Live inspection on 2026-10-23 confirmed that `public.order_returns` is still absent. The storefront must ship its Return schema and the read-only grants described in `docs/returns-read-model.md` before Return events can sync. CREOMS does not apply the proposed test storefront DDL to production. Until then, the Return sync reports failure while existing notification feeds continue working.

## Validation

`tests/return-notifications.test.ts` exercises the real SQL through the existing notification interfaces: visibility to multiple Returns Staff, denial and mark-read protection for every other Module, revocation, read clearing, baseline, duplicate/concurrent syncs, later steps, multiple Returns on one Order, and requests progressed between polls. Existing notification fixtures include the new nullable Return reference and Returns visibility field.

Final checks: typechecking and lint of changed TypeScript files passed. The full suite completed with 802 passed, 27 skipped and 2 failed. Both failures reproduce unchanged at base commit `0f2f52b`: `tests/session-end.test.tsx` expects old logout wording, and `tests/loading-card.test.tsx` renders `BackButton` without an app-router context. Repository-wide lint also fails on the pre-existing `module` variable in `tests/access.test.ts:205`. The separate standards and ticket-spec reviews found no issues.
