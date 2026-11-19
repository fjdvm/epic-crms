# Automatic checks (#528)

Part of fjdvm/brenraphaels-authentication-microservice#290. Every flag-only rule has an on/off switch and editable numbers; the defaults are today's behaviour, so nothing changes until an Admin changes it.

| Group | Rule | Numbers (default) |
| --- | --- | --- |
| GCash proof checks | reference reuse, amount, date, recipient | none |
| Cash on Delivery | first order; first order over an amount; earlier refusal; earlier failed delivery | amount ₱1,500 |
| Returns | many Returns by one Customer; photo already used | 3 in 90 days |
| Dashboard | unverified payments; Returns on one product; unresolved Failed deliveries; Orders not confirmed in time | 5 (or 24 h wait); 3 in 7 days; 3; 48 hours |

- Stored in `crms.automatic_checks` (one row of JSON; migration `docs/db/crms-automatic-checks.sql`, run `node --env-file=.env scripts/deploy/migrate-automatic-checks.mjs` as `creoms_writer`). The COD amount stays in `crms.cod_settings` (#351) so it has one home; saving here writes both. If the settings cannot be read, rules keep today's behaviour.
- `features/settings/automatic-checks.ts` (safe for client bundles) holds the defaults, validation and `loadAutomaticChecks`; `automatic-checks-server.ts` holds `saveAutomaticChecks` and `currentAutomaticChecks`. The evaluators (`payment-proof-checks`, `cod-flags`, `return-flags`, `unusual-activity`) take the settings as an argument.
- Reference reuse is still only a flag. Switched off, it reports no other Orders, so "Mark paid" is not held for a Manager either.
- The Dashboard's failed-delivery count is unresolved Failed deliveries, not a window of days.
- The Senior/PWD duplicate-ID check is not configurable.
- A Manager or the CEO reads and saves the whole set in Commerce Settings (Management); Staff and Admin are refused. Each save is audited as `automatic_checks.changed` under their name, with what changed.

## Orders not confirmed in time (#574)

An Order still `placed` (any payment method, Delivery or Pickup) once the limit has passed since `created_at` is Overdue: it shows on the Dashboard's Needs attention list ("Orders Overdue to confirm", Staff with the Orders Module) and raises one `order-overdue` alert, once per Order, for Managers with the Orders Module. Confirming (or cancelling) the Order clears it. Nothing is cancelled. Limit: `dashboard.unconfirmedOrders.hours` (default 48; the switch off hides the row and stops new alerts). A Manager or the CEO edits it in Commerce Settings.

The alert is created by the existing notification sync (storefront signal or on-request sync, no timer), so an Order that crosses the limit is alerted at the next sync. Apply `docs/db/crms-order-overdue.sql` as `creoms_writer` (`node --env-file=.env scripts/deploy/migrate-order-overdue.mjs`); it only widens the notification kind check.
