# Staff Order actions

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
