# Staff Order actions

For Customer Returns, Staff decisions, Received, the Delivery photo upload and the
four Customer emails and Notifications, see the
[storefront Returns and Delivery photo contract](creoms-returns-and-delivery-photo.md).

`features/orders/actions.ts` exposes `quoteDeliveryFee(id, deliveryFeeInCentavos)`,
`confirmPickup(id)` and `cancelOrder(id)` for the Orders Module. Every server action checks
that Module itself. Delivery fees are nonnegative integer centavos; zero is valid. Only
placed Delivery Orders may be quoted and placed Pickup Orders confirmed. Cancellation
is allowed from placed through preparing, including awaiting payment and paid.

CREOMS reads the current Order through its existing read-only database connection and
never writes Order tables. Each change is a POST to
`<CREOMS_STOREFRONT_URL>/api/internal/orders/<id>/status`. The storefront validates the
transition, performs its conditional write and handles Customer emails. Only its confirmed
response is returned as success; refused and uncertain writes never invalidate pages as
changed. An uncertain write must be checked by refreshing, rather than retried automatically.

Set `CREOMS_STOREFRONT_URL` and securely configure `CREOMS_SERVICE_SECRET` to the same
signing key held by the storefront, at least 32 characters long. The credential is an HS256
JWT with issuer `creoms`, audience `brenraphaels-orders`, scope `orders:status`, issued at
request time and expiring five minutes later. It is sent only in the Authorization header;
redirects are refused. The old shared-secret header is not used.

The storefront contract is documented in `brenraphaels-ecommerce/docs/creoms-service-credential.md`.
Its current endpoint returns `{ error: "Invalid Order status request" }` for transition
failures, including concurrent changes. CREOMS preserves that reason; it can give an
"already changed" reason itself when its initial read sees an ineligible Order. More
specific reasons for changes racing the request require the storefront to expose them.

Run `npx vitest run tests/order-actions.test.ts --maxWorkers=2`. The reusable
`tests/fake-storefront.ts` implements the endpoint in process against the same throwaway
Postgres database used for reads. It checks the signed credential and performs a conditional
status update. Its refusal override lets tests exercise reasons returned by the storefront.
No live storefront credential or production database is used by these tests.


## Payments (#141)

`loadPaymentQueue()` checks the Payments Module and returns `{ ok: true, orders }`,
or `{ ok: false, reason }` when the database cannot be read. Each row has its Order
number, creation time, Customer, total in centavos (subtotal plus Delivery fee),
and Payment proof (GCash reference, optional screenshot pathname, submission time).
Only GCash Orders awaiting payment with a submitted proof appear, oldest submission
first; ties use the Order number. Reads use the existing read-only connection.
The Payments page and its refresh behavior are delivered separately.

`markPaid(id)` and `cancelPaymentOrder(id)` check the Payments Module on every call.
They do not depend on an Orders grant. Orders-only Staff cannot use these endpoints.
`markPaid` requires a submitted GCash proof awaiting payment. It sends
`{ status: "paid", staffId: staff.username, staffName: staff.name }`, using the same
Portal username identity as Ticket claims, with no caller-supplied identity or time.
The storefront records the time and sends the Customer's email. `loadOrder` exposes
`paidBy: { id, name, at }`, or null for legacy Orders without attribution. It remains
available through later status changes.

`cancelPaymentOrder` uses the same cancel limit as Orders: through preparing, never
from dispatched, delivered or cancelled. There is no Reject or re-upload action.
Storefront refusals keep their reason; stale Orders seen before a request receive
an "already changed" reason. Neither a refusal nor an uncertain response is reported
as success. Successful writes invalidate the existing Orders and Payments views.

The storefront migration `0018_daffy_peter_quill` (ticket #113) must be applied before
these detail reads ship: it adds nullable `paid_by_id`, `paid_by_name` and `paid_at`
columns. CREOMS does not migrate or write the storefront's tables.
