# Fulfilment backend

The Fulfilment Module's backend lives at the Order actions boundary:

- `getFulfilmentBoard()` returns `{ ok: true, board }` or `{ ok: false }` when reads are unavailable.
- `startPreparing(id)`, `dispatchOrder(id)` and `deliverOrder(id)` return the existing Order change result.

Every entry point checks the Fulfilment Module, including direct calls and calls after a
Module is revoked. Holding Orders or Payments alone is insufficient. These functions are
ready for the Fulfilment board UI; this backend ticket does not replace the placeholder page.

The board has `ready`, `preparing`, `dispatched` and `delivered` arrays. Ready to prepare
contains paid Orders or confirmed Cash on Delivery Orders (including Pickup). Placed
Orders and unpaid GCash Orders never appear there. The other columns follow the actual
Order status. Active Orders are oldest first, with the Order number breaking ties.

“Recently delivered” means a rolling seven days, using the storefront's `delivered_at`
field, with the cutoff included. Delivered Orders are newest-delivered first. Legacy
Orders without a Delivery time, and timestamps in the future, are excluded. Order
creation time does not decide whether a Delivery was recent. Cards include Customer,
items, total, payment label, fulfillment and payment methods, and timestamps.

Each move waits for the storefront's confirmed response. CREOMS sends the same scoped
service credential as the Orders actions, never writes Order tables, and never retries
an uncertain write automatically. On `delivered`, the storefront records the Delivery
time, handles the Customer email and starts its existing two-day Feedback request timer.
CREOMS does not send a second email or create a second timer.

Local guards reject out-of-order moves and Orders already ineligible for the requested
move. A request racing another change is settled by the storefront's conditional update;
its refusal reason is preserved. The existing storefront endpoint currently exposes a
generic transition error, as documented in [the Order actions integration](creoms-order-actions.md).

No production migration is needed: `delivered_at` already belongs to the storefront's
Order schema and CREOMS's existing read-only role reads Orders. The throwaway test schema
now mirrors that existing field. Live credentials are the same as for #140.

Run `npx vitest run tests/fulfilment.test.ts tests/order-actions.test.ts --maxWorkers=2`.
These tests use the shared fake storefront and a throwaway Postgres database. Storefront
email delivery and Feedback scheduling remain covered by the storefront's own tests.
