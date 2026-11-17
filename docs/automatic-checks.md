# Automatic checks (#528)

Part of fjdvm/brenraphaels-authentication-microservice#290. Every flag-only rule has an on/off switch and editable numbers; the defaults are today's behaviour, so nothing changes until an Admin changes it.

| Group | Rule | Numbers (default) |
| --- | --- | --- |
| GCash proof checks | reference reuse, amount, date, recipient | none |
| Cash on Delivery | first order; first order over an amount; earlier refusal; earlier failed delivery | amount ₱1,500 |
| Returns | many Returns by one Customer; photo already used | 3 in 90 days |
| Dashboard | unverified payments; Returns on one product; unresolved Failed deliveries | 5 (or 24 h wait); 3 in 7 days; 3 |

- Stored in `crms.automatic_checks` (one row of JSON; migration `docs/db/crms-automatic-checks.sql`, run `node --env-file=.env scripts/deploy/migrate-automatic-checks.mjs` as `creoms_writer`). The COD amount stays in `crms.cod_settings` (#351) so it has one home; saving here writes both. If the settings cannot be read, rules keep today's behaviour.
- `features/settings/automatic-checks.ts` holds the defaults, validation, `loadAutomaticChecks` and `saveAutomaticChecks`. The evaluators (`payment-proof-checks`, `cod-flags`, `return-flags`, `unusual-activity`) take the settings as an argument.
- Reference reuse is still only a flag. Switched off, it reports no other Orders, so "Mark paid" is not held for a Manager either.
- The Dashboard's failed-delivery count is unresolved Failed deliveries, not a window of days.
- The Senior/PWD duplicate-ID check is not configurable.
- `GET /api/automatic-checks` (Admin, CEO, Manager) reads; `PUT` saves the whole set (Admin only). Same Portal Settings bearer handle as the Approval limit. Staff are refused. Each save is audited as `automatic_checks.changed` under the Admin's name, with what changed.
- No Portal screen here; the Portal's Automatic checks form calls the endpoint.
