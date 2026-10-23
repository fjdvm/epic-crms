# Received Orders and net Total spent (#174)

Total spent is calculated on reads; CREOMS does not store or backfill a second balance.
Both the Customer list and Customer Profile use:

- Gross subtotal plus Delivery fee for `paid`, `preparing`, `dispatched`, `delivered` and `received` Orders.
- Less the sum of `amount_in_centavos` for Returns on those Orders whose status is exactly `refunded`.

For example, a received Order worth 115,000 centavos with two Refunded Returns of 25,000
and 10,000 contributes 80,000. Requested, Approved, Goods received, Declined and cancelled
Returns contribute no deduction, even if their amount is the full Order total. Refunds
for another Customer's Orders are never included. Refunds are summed per Order rather
than joined into the Order rows, so multiple Returns cannot multiply the Order count or
the gross total. The source storefront is responsible for enforcing the refund cap.

Stage, Order counts and the latest non-cancelled Order still follow the original Orders.
A full refund does not turn a First order Customer into New, change a Repeat Customer's
Stage, or reset the At risk/Lost timer. Average Order uses net Total spent divided by the
original paid/fulfilled Order count: a fully refunded first Order has average zero, not
no Orders. Order history preserves original prices, Delivery fees and totals.

`received` remains a Customer-only storefront action; no Staff endpoint was added. It
is recognised by Order tabs/counts, the paid label and completed progress, Customer
Profile Order badges, settled Payment summaries and recent Fulfilment deliveries.
The latter retain the original `delivered_at` cutoff: receipt does not restart a window.
A Return never changes an Order's status or payment label, and Payment summaries retain
the original gross Order amount; this ticket changes Customer Total spent only.

## Migration and deployment

No new CREOMS migration or backfill is required for #174: it reads the existing Order
status, Return status and Return amount columns from #170. The prerequisite remains
the storefront-owned Returns schema and SELECT access for the existing read-only role.
If that grant has not been applied, the shared database owner must run
`docs/db/creoms-returns-readonly.sql` **after** the storefront schema is deployed.
See `docs/returns-read-model.md` for that proposed contract and rollout sequence.

The Customer reads now require that Returns data. Missing tables or SELECT permission
produce the existing unavailable state; they are not treated as zero refunds, which
would overstate spending. Verify the #170 prerequisite before deploying this change.
No production migration was executed for this ticket: there is no new migration, and
this environment has no live database binding with which to verify the prerequisite.
No storefront tables or status values are rewritten by CREOMS.

## Validation

`tests/customer-profile-spend.test.ts` exercises the real Profile and list loaders against
a throwaway Postgres database, including receipt, multiple refunds, cross-Customer
isolation, every non-refunded status, sorting, fully refunded Orders and Stage/average
behaviour. Existing live-database comparison tests now independently subtract Refunded
Returns and count received Orders; those tests remain skipped when no binding is supplied.

Run:

```sh
npx vitest run tests/customer-profile-spend.test.ts tests/order-views.test.tsx tests/orders.test.ts tests/fulfilment.test.ts features/customer-profiles/rules.test.ts --maxWorkers=2
```
