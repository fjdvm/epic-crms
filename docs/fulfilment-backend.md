# Fulfilment backend

The Fulfilment Module's backend lives at the Order actions boundary:

- `getFulfilmentBoard()` returns `{ ok: true, board }` or `{ ok: false }` when reads are unavailable.
- `startPreparing(id)`, `dispatchOrder(id)` and `deliverOrder(id, form)` return the existing Order change result.

Every entry point checks the Fulfilment Module, including direct calls and calls after a
Module is revoked. Holding Orders or Payments alone is insufficient. The Fulfilment page
(#149) reads the board with `loadFulfilmentBoard` after checking the Module itself, and its
cards and the Order detail call the three moves through the shared Order action dialog.

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

## Delivery photo (#169)

`deliverOrder(id, form)` requires a `FormData` containing exactly one `photo` File.
Missing, duplicate, empty, non-JPG/PNG and over-5-MB photos are refused before any
storefront request. The real bytes determine the content type; the filename and browser
MIME claim are ignored for validation. Exactly 5 MB is accepted. Pickup uses the same rule.
Every call checks the Fulfilment Module before reading the Order or storing a photo.

The existing Ticket Message file-storage boundary uploads the photo through the gateway:
register with `visibility: "private"`, `retentionType: "permanent"`, PUT the bytes to the
signed URL without credentials, then confirm the File. Only then does CREOMS POST
`{ status: "delivered", deliveryPhotoFileId: "<File id>" }` to the storefront's existing
Order status endpoint with its service credential. Storage failure leaves the Order alone.
The storefront must atomically store that id with the status and Delivery time, accept it
only for a dispatched Order without an existing photo, and return the same
`deliveryPhotoFileId` alongside `id`, `status` and `deliveryFeeInCentavos`. A response
missing or changing the photo id is uncertain, never success. No automatic retry occurs.
CREOMS exposes no operation to replace or remove the photo. Uploaded evidence is retained
even on refusal or uncertainty, because a lost response may follow an accepted write.

`loadOrder` exposes `deliveryPhotoFileId: string | null`; null means "No photo". It reads
the storefront's nullable `delivery_photo_file_id` through the Order's JSON representation,
so old Orders and a storefront schema without that field remain readable. No CREOMS
migration or backfill is needed. The test schema models the new nullable field. Adding
and writing the storefront column and accepting/confirming the File id belong to the
storefront implementation, excluded by parent spec #168.

The photo picker (#176) lives in the Mark as delivered dialog. The Order detail page shows
the photo through the file-storage view URL, or "No photo" when `deliveryPhotoFileId` is null.
