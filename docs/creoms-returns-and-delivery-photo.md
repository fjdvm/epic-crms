# Storefront contract: Returns and the Delivery photo

This updates the [#179 contract](https://github.com/fjdvm/epic-crms/blob/main/docs/creoms-returns-and-delivery-photo.md) for [the Customer Returns spec #194](https://github.com/fjdvm/epic-crms/issues/194), superseding its refund-only rules. Terms follow [CONTEXT.md](../CONTEXT.md). Ownership remains with the storefront: the storefront owns Returns, the Refund window, evidence and refund proof File references, all Customer emails and Notifications. CREOMS reads through its SELECT-only database role and asks the storefront to make Staff changes. Staff settle refunds externally and send replacements; neither application initiates a payment here.

Ticket #117 provides the schema and reusable `createReturnStore(...).transition` persistence boundary. Ticket #119 implements the authenticated Customer request/cancellation endpoints and their direct-upload evidence flow. Ticket #121 implements the Staff decision endpoint, Return-scoped credentials and refund-proof verification. Customer reads, emails, Notifications and UI below remain the contract for dependent tickets; this document does not mean those flows are deployed. CREOMS ticket #195 extends the read model and Staff actions. The Resolution controls, Replaced tab/stat and video/proof display remain frontend ticket #196.

## Credentials and attribution

CREOMS uses `CREOMS_STOREFRONT_URL` and the shared server-only `CREOMS_SERVICE_SECRET` (at least 32 characters). Sign an HS256 JWT: base64url JSON `{ "alg": "HS256", "typ": "JWT" }`, base64url JSON claims, then base64url HMAC-SHA256 of `<header>.<claims>` using the secret. Send `Authorization: Bearer <JWT>` and `Content-Type: application/json`.

| Claim | Order status endpoint | Return status endpoint |
| --- | --- | --- |
| `iss` | `creoms` | `creoms` |
| `aud` | `brenraphaels-orders` | `brenraphaels-returns` |
| `scope` | `orders:status` | `returns:status` |
| `iat` | Current Unix seconds | Current Unix seconds |
| `exp` | `iat + 300` | `iat + 300` |

The storefront verifies signature, algorithm, issuer, audience, scope and timestamps. Reject future-issued/expired tokens and lifetimes over 900 seconds. Orders credentials must not authorize Returns or vice versa. Reject the legacy shared-secret header; coordinate rotation of the shared service secret in both applications. The shared verifier accepts the Returns audience and scope only on the Return endpoint; the Order endpoint keeps its existing scope.

CREOMS checks the Returns Module for every decision and the Fulfilment Module for delivery. Every Staff decision supplies `staffId` (Portal username) and `staffName` (Portal display-name snapshot), sourced from its authenticated Staff session. The storefront validates these with the shared Staff attribution fields and supplies the time. Customer identity instead comes from the storefront session. No caller chooses an action time or impersonates another Customer.

## Stored read contract

Apply storefront migration `0020_return_resolution` after `0019_order_returns` (see [the Returns read model](returns-read-model.md)) before dependent deployments. Keep the existing four table names and columns so current CREOMS reads continue working:

| Table | Contract |
| --- | --- |
| `order_returns` | Numeric `id`, `order_id`, `status`, fixed `reason`, `note`, integer `amount_in_centavos`, `preferred_resolution`, nullable `final_resolution`, nullable `goods_required`, nullable `decline_reason`, nullable `video_file_id`, nullable `refund_proof_file_id`, `requested_at`, nullable `refunded_at`, nullable `replaced_at` |
| `order_return_items` | Whole purchased line snapshots: `return_id`, `order_line_id`, `product_name`, `size_label`, `quantity`, `price_in_centavos`; no partial quantities |
| `order_return_images` | One to three ordered photo File ids: `return_id`, `position` (1–3), `file_id` |
| `order_return_history` | One row per committed step: `return_id`, `status`, `actor_type` (`customer` or `staff`), `actor_id`, `actor_name`, `occurred_at`, optional `note` (decline reason for Declined) |

Resolution wire/database values are `refund` and `replacement`. Final Resolution is null until approval, then immutable. Approval defaults it to the preference and goods-required to false. One nullable video field means at most one video. Save File ids, never signed URLs. The visible Return number is `RMA-` followed by its numeric id, e.g. `RMA-15`. Staff usernames are opaque attribution, without a local Staff foreign key.

Request creation must atomically save at least one whole-line snapshot, one to three confirmed evidence photo ids and the initial Customer history row. The position constraint limits photos to three; the minimum photo/item counts and matching whole purchased lines are enforced by the creation boundary in its own ticket. All later decisions use the transition boundary, which locks the Return, checks ownership/status, and writes status, decision fields and one history step in a transaction. Direct SQL writes bypass these lifecycle rules and are unavailable to CREOMS.

## Customer request and cancellation

Authenticated `POST /api/orders/<id>/returns` accepts JSON input:

```json
{
  "orderLineIds": [31, 32],
  "reason": "damaged",
  "note": "The seal is broken.",
  "preferredResolution": "replacement",
  "photoUploadTokens": ["signed-photo-upload-token"],
  "videoUploadToken": "optional-signed-video-upload-token"
}
```

Reasons are `damaged`, `defective`, `wrong item`, `other`. The note is optional, normalized and limited to 2,000 characters. Fields use the shared validators; unknown fields (including quantities, prices and bare File ids), duplicate lines/photos, unrelated lines and files not uploaded for this Customer/Order are refused. Whole quantities are copied from the purchased line snapshots.

First call authenticated `POST /api/orders/<id>/returns/uploads` for each file with `{ "role": "photo", "contentType": "image/png", "size": 1234 }` (or role `video` and `video/mp4`/`video/quicktime`). The response is `201 { "id": "<File id>", "uploadUrl": "<presigned URL>", "uploadToken": "<signed token>" }`. PUT bytes directly to `uploadUrl` with the declared Content-Type and no gateway credentials. Pass the tokens when submitting the Return. This avoids sending up to 40 MB through a storefront Function. Tokens are signed using the storefront Caller key, scoped to Customer, Order, File id and photo/video purpose, and expire after one hour. A Caller-key rotation invalidates outstanding upload tokens; upload again.

Browser uploads target Private, Temporary staging Files. The request boundary confirms each staging upload, verifies Active/Private/Temporary metadata, downloads its bounded content through a server-only signed view address, and checks actual JPG/PNG/MP4/MOV signatures and size. It then seals the verified bytes in a separate Private, Permanent File, confirms its metadata and persists only that new File id. The sealed File’s PUT URL stays server-side; reusing a browser staging URL cannot change accepted evidence. Unknown/unconfirmed evidence, metadata/content mismatches and uploads for another Customer, Order or purpose are refused. Confirmed Permanent files are kept after failed or uncertain requests rather than risking deletion of accepted evidence. Staging Files expire through file-storage cleanup. No browser API allows File replacement or deletion.

Rollout dependency: file-storage must admit `video/mp4` and `video/quicktime` in its upload allowlist and preserve video bytes without image processing. Verify the deployed file-storage allowlist before enabling video uploads. The storefront supports these types and exercises them with fake storage; the file-storage deployment must support them before enabling video in the Customer form. No live storage upload is part of this ticket.

The boundary rechecks eligibility inside the transactional write, serializing against other requests and the Customer received action:

- The Order belongs to the Customer and is `delivered`; `received` is ineligible.
- Payment is confirmed: GCash reached `paid` before fulfilment; Cash on Delivery and Pickup qualify once delivered.
- `delivered_at` is present and `delivered_at <= now < delivered_at + 24 hours`. Missing/future times and the exact cutoff are refused. Use elapsed storefront time, never a client clock.
- Items in Requested, Approved or Goods received Returns are reserved. Refunded or Replaced items cannot be returned again. Declined and Customer-cancelled Returns release their items while the original window remains open.

Calculate the amount from purchased line snapshots, capped at the amount actually paid for selected items. If a historical paid subtotal is lower than the sum of its line snapshots, allocate that subtotal proportionally across lines in stable id order using integer centavos; splitting selections into disjoint Returns cannot multiply the cap. Include the Delivery fee only when all Order items are selected. Ignore Customer amounts/prices. The Refund window limits creation only: Staff cannot override it and later steps never expire. Return `201 { "id": 15, "number": "RMA-15", "status": "requested" }` after commit.

`POST /api/returns/<id>/cancel` accepts an empty body (or `{}`) for the owning Customer. Only Requested can become Cancelled, even after the window closes. Commit cancellation/history together and return `{ "id": 15, "status": "cancelled" }`. A race with approval has one winner.

## Status moves

Use exact lowercase wire/database values, including the space in `goods received`.

| From | To | Actor and condition |
| --- | --- | --- |
| No Return | `requested` | Owning Customer; eligible request and evidence |
| `requested` | `cancelled` | Owning Customer only |
| `requested` | `approved` | Staff; final Resolution defaults to preference; goods-required defaults to false |
| `requested` | `declined` | Staff; nonblank decline reason |
| `approved` | `goods received` | Staff; goods-required is true |
| `approved` | `refunded` | Staff; goods-required is false, final Resolution is refund, proof required |
| `approved` | `replaced` | Staff; goods-required is false, final Resolution is replacement |
| `goods received` | `refunded` | Staff; final Resolution is refund, proof required |
| `goods received` | `replaced` | Staff; final Resolution is replacement |

All other moves, including repeats and resolution mismatches, are refused without mutation/history. Refunded, Replaced, Declined and Cancelled have no outgoing move. Staff cannot create or cancel a Return. Approved cannot be declined. Every step records actor type, id, name and storefront time. Refunded saves `refunded_at` and proof together; Replaced saves `replaced_at`. A Return never changes its Order's status. Only Refunded reduces Total spent; Replaced creates no new Order and does not reduce Total spent. Store credit is out of scope.

## Staff decision API

Use `POST /api/internal/returns/<id>/status` with the Returns credential. Supported bodies:

```json
{ "status": "approved", "finalResolution": "replacement", "goodsRequired": false, "staffId": "ana", "staffName": "Ana Reyes" }
{ "status": "declined", "declineReason": "The evidence shows no defect.", "staffId": "ana", "staffName": "Ana Reyes" }
{ "status": "goods received", "staffId": "ben", "staffName": "Ben Cruz" }
{ "status": "refunded", "refundProofFileId": "proof-file-id", "staffId": "ben", "staffName": "Ben Cruz" }
{ "status": "replaced", "staffId": "ben", "staffName": "Ben Cruz" }
```

Approval may omit `finalResolution` and `goodsRequired` for the defaults above. Other decision fields must match their shape; decline reason is trimmed, required and at most 2,000 characters. Refunded requires a confirmed Private, Permanent JPG/PNG screenshot, verified by the endpoint's file-storage boundary before calling the persistence boundary. A nonempty File id alone is not verification. Before submitting a refund, CREOMS uploads/confirms the proof with a File Link `{ "system": "CRMS", "entityType": "return", "entityId": "15", "role": "refund-proof" }` for the numeric Return id (without `RMA-`). The endpoint looks up this Link through the storefront Caller, requires matching active/private/permanent metadata with no expiry and a size up to 5,242,880 bytes, and reads the signed original without Caller credentials to check its actual size and decode a valid JPG/PNG screenshot (at most 40 million pixels). Unrelated Files cannot serve as proof. Storage failures fail closed before the decision. This Link is a Return proof Link, never a Ticket Message Link. Staff mark Replaced only after sending the replacement.

Return a 2xx JSON confirmation only after commit:

```json
{
  "id": 15,
  "status": "approved",
  "finalResolution": "replacement",
  "goodsRequired": false,
  "actedBy": { "id": "ana", "name": "Ana Reyes", "at": "2026-10-24T08:00:00.000Z" }
}
```

CREOMS checks matching `id`, `status`, Staff id/name and a parseable ISO `actedBy.at`. Approval echoes effective `finalResolution` and `goodsRequired`; decline echoes the trimmed reason; refund echoes `refundProofFileId`. All failures use `{ "error": "<safe reason>" }`: `401` invalid/missing credentials or Customer session, `400` invalid fields/files, `404` missing/inaccessible Order/Return, `409` closed window or conflicting/illegal move. Storage/database failures return `503` with a safe refresh-before-retry reason because a database acknowledgement failure can be uncertain. Refusals write nothing and send nothing.

CREOMS uses no-cache requests, refuses redirects, times out after ten seconds and makes one attempt. A timeout, malformed/mismatched confirmation or connection failure is uncertain: refresh before retrying, since the commit may have succeeded. Confirmed decisions refresh Returns, Order detail and Customer Profiles. The persistence boundary is internal and supplies Date objects; the HTTP adapter serializes dates to ISO and maps validated actor identity into it.

## Customer received action and Delivery photo

Build `POST /api/orders/<id>/received`, empty body, owning Customer session only. Atomically require `delivered` and no in-progress Return (Requested, Approved, Goods received), then return `{ "id": 81, "status": "received" }`. Staff/service credentials cannot do it. Serialize against Return creation. There is no deadline and no reverse move. Preserve `delivered_at`, Delivery photo, existing Returns, Total spent and the two-day Feedback request timer.

Received **closes the Refund window early**, so no later Return request is accepted. Hide the button while a Return is in progress and require a dialog stating that marking received ends the right to a Return or refund. This replaces #179's rule that received leaves eligibility unchanged.

CREOMS already uploads a Delivery photo through the gateway before calling the Orders-scoped status endpoint with `{ "status": "delivered", "deliveryPhotoFileId": "<File id>" }`. The storefront must verify the confirmed Private, Permanent image, require dispatched, and atomically save `orders.delivery_photo_file_id`, delivered status and `delivered_at`. Echo `id`, `status`, integer-or-null `deliveryFeeInCentavos` and the same File id. Preserve old Delivery times; earlier Orders with no photo show “No photo”.

## File-storage flow and Customer access

Use the api-gateway with a server-only Caller key registered for the application's Client System. CREOMS uses `CREOMS_GATEWAY_URL` and `CREOMS_GATEWAY_CALLER_KEY`; the storefront uses its own registered Caller, never the CREOMS key in the browser.

1. `POST <gateway>/files`, Bearer Caller credential: `{ "filename": "defect.png", "contentType": "image/png", "size": 1234, "visibility": "private", "retentionType": "permanent" }`. Receive `{ "id": "<File id>", "uploadUrl": "<presigned URL>" }`.
2. PUT actual bytes to that upload URL with their actual Content-Type and no service credentials.
3. `POST <gateway>/files/<id>/confirm` with the Caller credential. Only confirmed files may be persisted as evidence/proof/Delivery photo.
4. Resolve for viewing via `GET <gateway>/files/<id>` with the Caller credential; expose only its temporary `{ "url": "<signed URL>" }` after Customer ownership or Staff Module access checks.

Evidence requires 1–3 JPG/PNG photos at most 5,242,880 bytes each and optionally one MP4/MOV video at most 26,214,400 bytes. Verify actual bytes/type, not a browser-supplied MIME or extension. The file-storage upload limit is 25 MB; use presigned uploads for video. Delivery photos and refund proof are JPG/PNG screenshots up to 5 MB. Validate confirmed metadata, ownership/purpose and content before accepting references. Request creation and the Staff endpoint own these checks in their respective tickets.

Save only ids; never persist signed URLs. No unrestricted File-id resolver. Customers can see only evidence, refund proof and Delivery photos belonging to their own Orders/Returns; CREOMS checks Staff access. Files need no Ticket Message Link. Keep Permanent files after uncertain responses; never expose replacement/deletion of committed evidence, proof or Delivery photos, including overwriting bytes under an existing id.

## Customer emails and Notifications

The storefront sends one Customer email and one in-app Notification for each committed step below, linking to the Return in My orders and including its RMA number and Order number. CREOMS sends none of these Customer messages.

| Step | Customer message |
| --- | --- |
| Requested | Request received, RMA number and preferred Resolution |
| Approved | Final Resolution, any difference from preference, whether goods must come back |
| Declined | Stored decline reason |
| Goods received | Goods received; final Resolution still pending |
| Refunded | Recorded refund amount and access to proof |
| Replaced | Replacement sent; Return completed |

Cancellation and received send nothing. Tie delivery durably to history steps and deduplicate so transport failure/retries cannot roll back a decision or duplicate accepted changes. CREOMS's separate Staff Requested notification is independent.

## Rollout and responsibility

The storefront ships schema/migrations first, then Customer request/cancel and received boundaries, Staff endpoint and Return-scoped credential, file verification/authorized reads, Delivery photo support, emails/Notifications and Customer views. CREOMS extends its read model, approval Resolution choice, refund proof upload, video/proof views, Replaced action/tab, Resolution column and Replacements stat. Keep Total spent unchanged for Replaced.

Existing grants on the four Return tables cover new columns. On a fresh environment apply storefront migrations first, then CREOMS's rerunnable `docs/db/creoms-returns-readonly.sql` as owner, retaining SELECT without writes. Do not recreate tables from a CREOMS test fixture. Migration 0020 keeps legacy refund Returns readable; legacy completed refunds may have no proof and must not be fabricated or reopened.

Test dependent server flows against the throwaway database with file/email fakes: eligibility/payment/cutoff, whole lines and refund cap, finished item exclusion, retry after decline/cancel, received exclusivity, status races, default/override Resolution, goods-back paths, evidence/proof validity and notification effects. Ticket #117 tests persistence/migrations, legal/illegal moves and atomic attribution; it does not substitute for those endpoint tests.


## Staff endpoint verification (#121)

`npx vitest run __tests__/internal-return-status-route.test.ts __tests__/creoms-credential.test.ts --maxWorkers=2` exercises the real HTTP handler with signed credentials, migrated throwaway PGlite and a fake file gateway. It covers the full Staff transition matrix, approval defaults/overrides, attribution, proof verification, credential isolation, strict input rejection, races and rollback/uncertain responses. No additional schema migration is needed; this endpoint uses migration 0020 from #117. Customer messaging remains a dependent ticket.

## CREOMS verification and rollout (#195)

The CREOMS server signatures, upload form key and refusal semantics are documented in
[Staff Return decisions](return-decisions.md). New File ids come from server-side upload,
not browser-supplied ids; only the storefront confirms the final status.

On 2026-10-25 the configured database's Drizzle journal matched the SHA-256 of storefront
`0020_return_resolution.sql`. All five new columns, Resolution/status constraints and
legacy final-Resolution backfill were already present. Catalog checks confirmed SELECT
on the new columns and no Return table writes for `creoms_readonly`. No migration or
backfill was run for #195. The local `CREOMS_DATABASE_URL` currently authenticates as
`neondb_owner`; deployments must continue using the documented `creoms_readonly` role.
No credentials were changed by this ticket.
