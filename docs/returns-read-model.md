# Returns read model (#170)

The public Returns server boundary is `features/returns/actions.ts`:

- `getReturns({ status?, orderId?, page?, pageSize? })`: Requested first, then all other statuses; each group oldest first with Return number breaking ties. Item names, sizes, quantities and prices are the Return snapshots. Pages default to 25 and are capped at 100; counts respect the Order filter and remain available across status tabs.
- `getReturnStats()`: Open returns = Requested + Approved + Goods received. Return rate is all Returns requested during the current Philippine calendar month divided by Orders delivered during that month, as a percentage. A later Customer `received` status does not remove a delivery from the denominator. The zero-denominator result is zero. Refunded this month is the sum of Refunded amounts by refund time, in centavos; it does not use request time.
- `getReturnDetail(id)`: Return number (`RMA-` plus id), Customer and Order, items, reason and note, amount, goods-required decision, decline reason, refund time, defect File IDs and ordered history. Each history step includes the actor's type, Portal username/Customer id, name snapshot and timestamp. Order context includes payment method, delivery time and the optional Delivery photo File id.

Every endpoint checks the Returns Module before connecting to the database. Denied or revoked access redirects to no-access; missing sessions and Portal outages use the existing Portal flow. Data is not cached across Staff or requests. Database failure is `{ ok: false }`, distinct from an empty successful list or a missing detail (`detail: null`). The raw SQL loaders are internal application modules, not Server Action endpoints.

The shared Order detail access gate also accepts Returns. Returns-only Staff see the Order context without Orders, Payments or Fulfilment controls and return to `/returns`. The protected `/returns` landing route is reserved here so Returns-only Staff can enter the shell. Its list/tabs/cards UI, sidebar activation, Return displays and decisions remain the separate #172, #175, #177 and #171 work; this ticket does not invent Staff-created Returns or decision buttons.

## Storefront prerequisite and schema

The storefront owns Return tables and all migrations on those tables. Its main branch had no Return schema when #170 was implemented. The read contract was initially proposed in `tests/returns-schema.sql`; storefront Drizzle migration `0019_order_returns` now implements it (applied to production during #171). Storefront endpoints remain separate work under #179:

| Table | Fields consumed |
| --- | --- |
| `public.order_returns` | `id`, `order_id`, `status`, `reason`, `note`, `amount_in_centavos`, nullable `goods_required`, `decline_reason`, `refunded_at`, and `requested_at` |
| `public.order_return_items` | `return_id`, `order_line_id`, `product_name`, `size_label`, `quantity`, `price_in_centavos` (immutable whole-line snapshots) |
| `public.order_return_images` | `return_id`, `position` (1–3), private permanent `file_id` |
| `public.order_return_history` | `id`, `return_id`, `status`, `actor_type` (`customer`/`staff`), `actor_id`, `actor_name`, `occurred_at`, optional `note` |

Stored statuses are `requested`, `approved`, `goods received`, `refunded`, `declined`, `cancelled`; reasons are `damaged`, `defective`, `wrong item`, `other`. `refunded_at` and the Refunded history entry must be committed with the final status by the storefront. Return items and history have stable keys for deterministic ordering. All amounts are integer centavos.

Order context uses existing `orders.delivered_at`. The optional `delivery_photo_file_id` is read through a nullable JSON projection, so an older Order schema without that column still reads as no photo. Private image File IDs are data, not public URLs; Return views must resolve them server-side through the existing file-storage gateway after the Returns guard. This ticket does not relax file permissions or introduce a public image endpoint.

## Migration and rollout

1. Have the storefront owner deploy its Return tables matching the agreed read contract. Do not apply the throwaway test DDL to production from CREOMS.
2. As the shared database owner, run `docs/db/creoms-returns-readonly.sql` with SQL error-stop enabled. This transactional, rerunnable permissions migration grants SELECT on the four Return tables to the existing `creoms_readonly` role and revokes direct write privileges on those tables. It fails without partial grants if a prerequisite table/role is absent. Existing Orders and Customer grants are unchanged.
3. Configure the existing read-only `CREOMS_DATABASE_URL` securely and verify the Returns loaders against the deployed schema. No new database writer role or credential is needed for CREOMS.

The permission migration was initially verified in a throwaway database. During #171, Staff requested the missing schema migration: storefront migration `0019_order_returns` was tested on an isolated production copy and applied to production on 2026-10-23, followed by this permissions migration. The four Return tables and SELECT-only privileges are verified, and the live CREOMS Returns loaders succeed. See `docs/return-decisions.md` for the rollout record and the remaining storefront endpoint dependency.

## Fake and validation

The shared fake storefront now accepts `POST /api/orders/<id>/returns`. Its `X-Test-Customer` header is fake-only session authentication, not a proposed production authentication scheme. It records item/image snapshots and the Customer's Requested history step transactionally. Requests must belong to the Customer, select whole Order lines and include a reason, note and one to three File IDs. The fake checks `delivered`/`received` and the interval `[delivered_at, delivered_at + 24 hours)`. Existing in-time Returns do not expire, and Customer receipt does not restart the clock. Full-item selection includes the Delivery fee; partial selection does not. A duplicate active/refunded item cannot be requested again.

The fake extends the #140 test seam; production Customer endpoint authentication, request uploads, Returns transitions and notifications remain storefront/#179 and later ticket work. Run:

```sh
npx vitest run tests/returns.test.ts tests/returns-access.test.ts tests/returns-migration.test.ts tests/order-views.test.tsx --maxWorkers=2
```
