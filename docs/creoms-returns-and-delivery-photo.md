# Storefront contract: Returns and the Delivery photo (#179)

This extends [Staff Order actions](creoms-order-actions.md) for [#168](https://github.com/fjdvm/epic-crms/issues/168).
The storefront owns Orders, Returns, the Refund window, and Customer emails and
Notifications. CREOMS reads through `CREOMS_DATABASE_URL`, using its existing read-only
role, and asks the storefront to make each Staff change. It never writes those tables
or moves money. Terms follow [CONTEXT.md](../CONTEXT.md).

The Staff request and response shapes below are implemented in `lib/storefront.ts`,
`features/returns/actions.ts` and `features/orders/actions.ts`. Customer routes below
are proposed storefront routes, not deployed CREOMS endpoints. The fake storefront
implements Customer creation and Staff decisions; it does not prove the production
Customer authentication, cancellation, Received, emails or Notifications work.

## Credentials and ownership

Set `CREOMS_STOREFRONT_URL` to the storefront origin and securely configure
`CREOMS_SERVICE_SECRET` to the same signing key on both servers, at least 32 characters
long. CREOMS mints a fresh HS256 JWT for each request: base64url JSON header
`{ "alg": "HS256", "typ": "JWT" }`, base64url JSON claims, then the base64url
HMAC-SHA256 signature of `<header>.<claims>` using that secret.

| Claim | Order endpoint | Return endpoint |
| --- | --- | --- |
| `iss` | `creoms` | `creoms` |
| `aud` | `brenraphaels-orders` | `brenraphaels-returns` |
| `scope` | `orders:status` | `returns:status` |
| `iat` | Request time in Unix seconds | Request time in Unix seconds |
| `exp` | `iat + 300` (five minutes) | `iat + 300` (five minutes) |

Send only `Authorization: Bearer <JWT>` and `Content-Type: application/json`.
The storefront must verify the signature, HS256 algorithm, issuer, endpoint-specific
audience and scope, and timestamps before writing. Reject expired or future-issued
tokens; the existing Orders verifier also rejects lifetimes over 900 seconds.
Extend that verifier for Returns without allowing an Orders credential to authorize
Returns or vice versa. The legacy shared-secret header is not accepted. The existing
storefront credential document is `brenraphaels-ecommerce/docs/creoms-service-credential.md`.

CREOMS checks the Returns Module on every decision and the Fulfilment Module on every
delivery, including after revocation. Any Staff member with Returns can take the next
eligible Return step. Staff identity comes from the Portal, never browser input.
The storefront must enforce transitions independently and atomically; a CREOMS read
before a request does not protect against concurrent changes.

Customer endpoints instead use the storefront's own Customer session, ownership checks
and request protections. Neither the service JWT nor gateway key goes to a browser.
`X-Test-Customer` in `tests/fake-storefront.ts` is only fake authentication.

## Customer Return request and Refund window

Build `POST /api/orders/<orderId>/returns` for a signed-in Customer's own Order:

```json
{
  "lineIds": [41, 42],
  "reason": "damaged",
  "note": "Two jars arrived cracked.",
  "imageFileIds": ["<confirmed defect File id>"]
}
```

`lineIds` contains one or more distinct positive integer Order line ids belonging to
that Order. Each selects the entire purchased quantity; partial quantities are refused.
`reason` is exactly `damaged`, `defective`, `wrong item` or `other`. `note` is free text
(a string, which may be empty). Require one to three defect images: nonempty JPG or PNG,
at most 5,242,880 bytes each, checked from real bytes rather than filename or browser
MIME. Upload and confirm Private, Permanent Files through the api-gateway as described
below, then submit their ids. The storefront must validate those Files and their
association with the Customer's upload; arbitrary File ids are not proof of ownership.

The storefront checks all of these at the time of the transactional write:

- The Order belongs to the Customer and is `delivered` or `received`.
- Payment is confirmed: GCash must have reached `paid` before fulfilment; Cash on
  Delivery and Pickup qualify once `delivered`. No extra cash-collection action is added.
- `delivered_at` is present and `delivered_at <= now < delivered_at + 24 hours`, using
  storefront time. The exact 24-hour boundary is refused with a clear Refund window
  closed reason. Missing or future Delivery time does not qualify. This is elapsed
  time, not the end of a calendar day.
- Selected items do not already belong to a Requested, Approved, Goods received or
  Refunded Return. Declined or Cancelled items can be requested again only while the
  original Refund window is open. Serialize competing requests so an item cannot be
  reserved or refunded twice.

Calculate the amount on the server from the purchased line snapshots, capped at what
the Customer paid for the selected items. Include the Delivery fee only when every
Order item is selected; a partial selection excludes it. Never accept an amount or
prices supplied by the Customer. All amounts are integer centavos.

Commit the Requested Return, immutable item snapshots, ordered defect File ids, and
the initial Customer history step together. Return `201 { "id": 15 }`; the visible
Return number is `RMA-` followed by that number. Refuse invalid input with `400`, a
missing/inaccessible Order with `404`, and a closed window or conflicting Return with
`409`, using JSON `{ "error": "<Customer-safe reason>" }`. An unauthenticated request
returns `401` and changes nothing.

The Refund window limits creation alone. An in-time Return remains valid however long
Staff take; approval, goods receipt and refund have no 24-hour deadline. Staff cannot
override the window. Received neither starts nor stops nor extends it; a Customer who
never sets Received can still request a Return. Existing deliveries use their original
`delivered_at` without resetting it at launch.

## Return statuses and who moves them

Database/wire statuses use the exact lowercase values below, including the space in
`goods received`. Display Requested, Approved, Goods received, Refunded, Declined and
Cancelled to people.

| From | To | Actor and condition |
| --- | --- | --- |
| No Return | `requested` | Customer, through the request above, inside the Refund window |
| `requested` | `cancelled` | The same Customer, through the storefront |
| `requested` | `approved` | Returns Staff via CREOMS; explicit `goodsRequired` boolean |
| `requested` | `declined` | Returns Staff via CREOMS; nonempty `declineReason` |
| `approved` | `goods received` | Returns Staff via CREOMS, only if `goodsRequired: true` |
| `approved` | `refunded` | Returns Staff via CREOMS, only if `goodsRequired: false` |
| `goods received` | `refunded` | Returns Staff via CREOMS after paying the refund externally |

These are all the moves. Refunded, Declined and Cancelled are final. Approved cannot
be declined or cancelled; goods-required approval cannot skip Goods received. No Return
changes its Order's status. Staff cannot create a Return. Each move records actor type,
actor id, name snapshot and storefront time. Requested and Cancelled use the Customer's
identity; Staff steps use Portal username and name. Refunded records `refunded_at` in
the same transaction, and only then reduces Total spent by the refunded amount.

Build `POST /api/returns/<id>/cancel` with an empty body for the owning Customer.
Atomically require Requested, write Cancelled and its Customer history step, and return
`{ "id": 15, "status": "cancelled" }`. It remains cancellable after the Refund window
closes if still Requested. Use the same session, ownership and JSON error conventions;
a cancellation racing approval is a `409` and must not overwrite approval.

## Staff decision endpoint CREOMS calls

Build `POST /api/internal/returns/<id>/status` with the Return-scoped credential above.
Each body includes `staffId` (Portal username) and `staffName` (Portal name snapshot).
These are the four complete decision shapes:

```json
{ "status": "approved", "goodsRequired": false, "staffId": "ana", "staffName": "Ana Reyes" }
{ "status": "declined", "declineReason": "The images show no defect.", "staffId": "ana", "staffName": "Ana Reyes" }
{ "status": "goods received", "staffId": "ben", "staffName": "Ben Cruz" }
{ "status": "refunded", "staffId": "ben", "staffName": "Ben Cruz" }
```

Approval requires a boolean even when false. Decline requires a trimmed nonempty
reason, retained for the Customer to see. Require nonblank Staff identity and let the
storefront supply the time. Commit the conditional status change, decision fields and
one Staff history step together; Refunded includes `refunded_at`. Return a 2xx JSON
confirmation only after commit:

```json
{
  "id": 15,
  "status": "approved",
  "goodsRequired": false,
  "actedBy": { "id": "ana", "name": "Ana Reyes", "at": "2026-10-23T08:00:00.000Z" }
}
```

Every success requires the same numeric `id`, requested `status` and matching
`actedBy.id`/`actedBy.name`, plus a parseable ISO timestamp `actedBy.at`. Approval must
echo the exact `goodsRequired`; decline must echo the exact trimmed `declineReason`.
Other decisions need no extra confirmation fields. Non-2xx responses use
`{ "error": "<Staff-safe refusal reason>" }`. Use `401` for invalid credentials,
`400` for invalid fields, `404` for a missing Return, and `409` with an “already changed”
reason for ineligible or concurrently moved Returns, including Customer cancellation.
CREOMS preserves the returned error string.

CREOMS sends no-cache requests, refuses redirects, times out after ten seconds and
makes one attempt. Malformed/mismatched confirmations, timeouts and connection failures
are uncertain, never success. A response can be lost after commit: Staff must refresh
before trying again. Successful confirmed decisions refresh Returns, the related Order
detail and Customer Profiles. See [Staff Return decisions](return-decisions.md).

## Customer Received action

Build `POST /api/orders/<id>/received` with an empty body and the storefront's Customer
session. Only the owning Customer may conditionally change `delivered` to `received`.
Return `{ "id": 81, "status": "received" }` after commit; use `401`/`404` as above
and `409` for any other current status. Staff and service credentials cannot set it.
Preserve `delivered_at` and the Delivery photo. There is no Refund window deadline for
Received and no reverse move. It is solely the Customer's “I have it” signal. It does
not change Return eligibility, existing Returns, Total spent or the existing two-day
Feedback request timer. Total spent continues counting the Order in `received`.

## Delivery photo and file-storage through the api-gateway

`deliverOrder(id, form)` checks Fulfilment and requires exactly one `photo` File for
every fulfilment method, including Pickup. It rejects empty files, non-JPG/PNG content
and sizes over 5,242,880 bytes before uploading or asking for delivery. Exactly that
size is allowed. `gatewayFileStorage` in `lib/gateway.ts` reuses the Ticket Message
upload boundary. With `base = CREOMS_GATEWAY_URL` (trailing slash removed):

1. CREOMS sends `POST <base>/files` with `Authorization: Bearer <CREOMS_GATEWAY_CALLER_KEY>`
   and JSON `{ "filename": "delivery.png", "contentType": "image/png", "size": 1234,
   "visibility": "private", "retentionType": "permanent" }`. Use actual byte type and
   length. The gateway maps its `crms` Caller to the CRMS Client System and forwards
   to file-storage. The response contains `{ "id": "<File id>", "uploadUrl": "<signed URL>" }`.
2. PUT the bytes to that exact `uploadUrl` with the real `Content-Type`, without
   gateway or storefront credentials. This is the signed storage destination.
3. Send `POST <base>/files/<id>/confirm` with the gateway Caller credential. Only a
   successfully confirmed File id can be used for delivery. Storage failure leaves
   the Order alone.
4. CREOMS sends `POST <CREOMS_STOREFRONT_URL>/api/internal/orders/<id>/status` with
   the Orders-scoped JWT, and body `{ "status": "delivered", "deliveryPhotoFileId": "<File id>" }`.

The storefront must verify a confirmed Private, Permanent image File and atomically
require a dispatched Order with no existing Delivery photo, then store its id in
nullable `orders.delivery_photo_file_id` together with `status = 'delivered'` and
`delivered_at`. Return the existing Order confirmation plus the same File id:

```json
{
  "id": 81,
  "status": "delivered",
  "deliveryFeeInCentavos": 15000,
  "deliveryPhotoFileId": "<File id>"
}
```

`deliveryFeeInCentavos` must be an integer or null, including for Pickup. A missing or
different photo id is uncertain. The same refusal and one-attempt rules as the Return
endpoint apply. CREOMS retains the uploaded Permanent File even after refusal or
uncertainty, since a lost response may follow an accepted delivery. The storefront
sends its existing delivery email and keeps its existing Feedback request timer;
CREOMS sends neither.

Keep the File id with the Order, never a saved signed URL. For display, the backend
calls `GET <base>/files/<id>` using its gateway Caller key and obtains `{ "url": "<short-lived signed URL>" }`.
The storefront uses its own registered Caller key, checks the Order belongs to the
Customer before resolving the File, and exposes only the temporary view URL to that
Customer. CREOMS checks Staff Module access before resolving it. The file-storage
service accepts known Client Systems; a File id or Link is not Customer authorization.
Do not expose an unrestricted File-id resolver or either service key to browsers.

The storefront uses the same register/PUT/confirm flow with its own gateway Caller for
Customer defect images. A Delivery photo needs no Ticket Message Link: CREOMS saves
the File id through the Order status request and does not call `linkToMessage` for it.
Neither application may expose replacement/removal for a Delivery photo, including
replacing bytes under the same id. Permanent retention alone does not prevent those
operations; enforce immutability in application routes. Earlier delivered Orders with
no File id show “No photo”; do not require a retroactive photo or reset Delivery time.

## Four Customer emails and Notifications

The storefront must send one Customer email and create one in-app Notification for
each committed transition below, addressed only to the Return's Customer and linking
to their Return/Order detail. Include the Return number and Order number in each.

| Committed status | What the Customer must be told |
| --- | --- |
| `approved` | The Return was approved, and explicitly whether the goods must come back |
| `declined` | The Return was declined, with the stored decline reason |
| `goods received` | The returned goods were received; the refund has not yet been recorded |
| `refunded` | The refund was paid, including the recorded amount |

Tie notification work durably to the committed history step and deduplicate deliveries
so retries or a repeated decision cannot send duplicates. Failed transport must not
roll back or duplicate an accepted decision. CREOMS does not send these four emails
or create these Customer Notifications. This contract adds none for Requested,
Cancelled or Received. The separate Staff Return notification alerts Returns Staff
only when a Return is Requested; it is not one of these Customer Notifications.

## Storefront work and migration checklist

- Build the Customer Return form, authenticated creation/cancellation routes, Return
  history/detail with defect images, the Refund window message, Received action and
  Customer Delivery photo display. The Customer route names above are proposed;
  the two internal Staff endpoint paths and payloads must match CREOMS exactly.
- Deploy the Return decision endpoint, the distinct Return credential scope, atomic
  transitions/history/refund timestamp, and the four Customer emails and Notifications.
- Extend the Order status endpoint for the Delivery photo and add nullable
  `orders.delivery_photo_file_id` in a storefront-owned migration if absent. Add
  `received` wherever storefront status validation/storage needs it. Preserve existing
  Delivery times and leave legacy photo ids null; no backfill is needed.
- Match the four Return tables and exact column/status values in
  [the Returns read contract](returns-read-model.md#storefront-prerequisite-and-schema).
  That document and [the decision rollout record](return-decisions.md#migration-and-rollout)
  record storefront migration `0019_order_returns` and the SELECT-only grants as
  already applied on 2026-10-23. Verify the target database's migration history before
  running schema changes; do not recreate those tables from the test fixture.
- On a fresh environment, apply the storefront schema first, then run the rerunnable
  [Return read permissions migration](db/creoms-returns-readonly.sql) as database owner
  with SQL error-stop enabled. CREOMS retains SELECT-only access and its existing
  environment variables. Deploy storefront support before enabling dependent flows.

This documentation ticket introduces no schema change or migration to run. A migrated
database does not deploy the storefront endpoints. Storefront tests must cover Customer
ownership, payment eligibility, cutoff boundaries, cancellation/approval races, duplicate
item requests, Received preserving Delivery time, immutable photos and notification
deduplication; the CREOMS fake is not a substitute for that coverage.

Verify the implemented CREOMS half without live credentials:

```sh
npx vitest run tests/returns.test.ts tests/return-actions.test.ts tests/fulfilment.test.ts tests/gateway-image-store.test.ts --exclude '.claude/**' --maxWorkers=2
npm run typecheck
```
