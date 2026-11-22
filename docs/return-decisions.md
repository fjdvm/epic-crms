# Staff Return decisions (#171, #195)

The complete [storefront contract](creoms-returns-and-delivery-photo.md) also covers
Customer requests and cancellation, Received, Delivery photos and Customer Notifications.

`features/returns/actions.ts` exposes these server actions:

| Action | Eligible Return | Decision sent |
| --- | --- | --- |
| `approveReturn(id, goodsRequired = false, finalResolution?)` | Requested | `approved`, boolean `goodsRequired`, explicit `finalResolution` defaulted from the preference |
| `declineReturn(id, reason)` | Requested | `declined`, trimmed nonempty `declineReason` |
| `markReturnGoodsReceived(id)` | Approved with `goodsRequired: true` | `goods received` |
| `markReturnRefunded(id, form)` | Final Resolution refund; Goods received, or Approved with `goodsRequired: false` | `refunded`, uploaded `refundProofFileId` |
| `markReturnReplaced(id)` | Final Resolution replacement; Goods received, or Approved with `goodsRequired: false` | `replaced` |

Every action checks the Returns Module through the Portal before validating input or opening the read-only database. Orders, Payments and Fulfilment grants do not authorize Return decisions. Access is rechecked on every call, including revocations. Any Returns Staff member may perform the next eligible step, regardless of who approved it. Staff identity is always taken from the Portal; neither identity nor timestamps are accepted from the browser. A previously requested Return does not expire with the Customer's Refund window.

CREOMS reads the current Return to reject stale/ineligible steps with an “already changed” reason, then asks the storefront to make the decision. The storefront must independently enforce the same rules atomically, including a race with Customer cancellation or another Staff decision. Once Approved, a Return cannot be declined. Refunded, Replaced, Declined and Cancelled are final. A Return never changes its Order's status.

## Proposed storefront endpoint

This is the proposed decision contract, extending the #170 read contract. It is implemented in `tests/fake-storefront.ts`; deploying the real storefront endpoint is separate storefront work under #168/#179.

`POST /api/internal/returns/<id>/status`, using the existing server-only `CREOMS_STOREFRONT_URL` and `CREOMS_SERVICE_SECRET`. Requests use JSON, no caching, no redirects, and a ten-second timeout. There is exactly one attempt.

Authorization is `Bearer <HS256 JWT>`, signed with the same service secret as Orders (at least 32 characters). Return credentials are scoped separately: `iss: "creoms"`, `aud: "brenraphaels-returns"`, `scope: "returns:status"`, `iat` now, `exp` five minutes later. An Orders credential must not authorize a Return request or vice versa.

Every body includes `staffId` (Portal username) and `staffName` (Portal name snapshot), plus only the decision fields in the table above. For example:

```json
{ "status": "approved", "finalResolution": "refund", "goodsRequired": false, "staffId": "ana", "staffName": "Ana Reyes" }
```

The storefront must commit the new status, any goods/decline decision and one Staff history entry (`actor_type: "staff"`, username, name and storefront time) in one transaction. Refunded also records `refunded_at` in that transaction. The storefront owns Customer emails and Notifications; CREOMS neither sends them nor moves money. Refunded means Staff have already paid the money outside CREOMS.

A successful response is JSON with `id`, the requested `status`, and `actedBy: { id, name, at }`, where `at` is an ISO timestamp recorded by the storefront. Approval must echo the exact `goodsRequired` and `finalResolution`; decline must echo `declineReason`, and refund must echo the uploaded `refundProofFileId`:

```json
{
  "id": 15,
  "status": "approved",
  "goodsRequired": false,
  "finalResolution": "refund",
  "actedBy": { "id": "ana", "name": "Ana Reyes", "at": "2026-10-23T08:00:00.000Z" }
}
```

Return non-2xx JSON `{ "error": "<Customer-safe refusal reason>" }` on refusal. Use 409 with an “already changed” reason when another actor has moved/cancelled the Return. CREOMS preserves the storefront's error string. Missing or mismatched confirmation fields, malformed responses, timeouts and connection failures return `{ ok: false, reason }`, never success. In particular, a response lost after a committed change is uncertain. There are no automatic retries; Staff must refresh before considering another attempt.

Actions return `{ ok: true, return: { id, status } }` only after confirmation. Successful decisions invalidate `/returns` and its nested views, the related Order detail and the Customer Profiles layout. Layout invalidation uses the filesystem route group (`/(app)/returns` and `/(app)/customer-profiles`), as required by the installed Next.js version. Refused or uncertain decisions do not claim that views changed. Confirmation dialogs and the Returns UI are separate tickets.

## Migration and rollout

No new CREOMS schema or environment variable is required for #171. The prerequisite #170 contract already contains `goods_required`, `decline_reason`, `refunded_at` and the Staff history fields. The storefront must deploy its own schema/migrations and the decision endpoint, then the database owner can run the existing `docs/db/creoms-returns-readonly.sql` permissions migration. CREOMS never writes the Return tables.

The initial live inspection found the Return tables absent. After Staff explicitly requested the migration, storefront Drizzle migration `0019_order_returns` was created and tested on an isolated copy of production, then applied to production on 2026-10-23 along with `docs/db/creoms-returns-readonly.sql`. All four tables are present and recorded in Drizzle migration history; `creoms_readonly` has SELECT and no INSERT/UPDATE/DELETE/TRUNCATE privileges. Existing Order and Customer counts were unchanged. The real CREOMS Returns list, stats and detail loaders were verified against the migrated live database. Storefront decision endpoint deployment remains a separate dependency; migrating tables does not deploy those endpoints.

## Verification

The actions are exercised with the signed-request fake storefront and throwaway Postgres, reading results through `getReturnDetail`. Coverage includes both approval decisions, the full transition matrix, required decline reasons, Staff history and time, different Staff on successive steps, denied/revoked Returns access through the real Portal client, storefront refusals, competing decisions, invalid confirmation responses and a lost response after commit without retry.

```sh
npx vitest run tests/return-actions.test.ts tests/returns-access.test.ts --maxWorkers=2
```

Final verification: the Returns action/access tests pass (14 tests), and typechecking and targeted lint pass. The full suite (`npm test -- --exclude '.claude/**' --maxWorkers=2 --testTimeout=20000 --silent`) reports 808 passed, 27 skipped and two pre-existing failures: the Customer Profile skeleton in `tests/loading-card.test.tsx` requires an App Router context, and `tests/session-end.test.tsx` expects outdated logout copy. Both failures were reproduced in an isolated checkout of prerequisite commit `0f2f52b`. Nested `.claude` worktrees are excluded to avoid running duplicate suites from other branches.

## Resolution and refund proof (#195)

Approval sends the final Resolution explicitly, using the stored Customer preference
when omitted. It rejects values other than `refund` and `replacement`. Existing
`approveReturn(id, goodsRequired)` callers remain valid; omitting goodsRequired defaults
to false. The storefront rechecks the status and Resolution under its row lock.

`markReturnRefunded(id, form)` requires exactly one File under FormData key `proof`.
Empty content, non-JPG/PNG signatures, multiple Files, string ids and sizes over
5,242,880 bytes are refused before upload. The real content type is used despite browser
MIME/extension claims. Through `gatewayFileStorage`, CREOMS registers a Private, Temporary
File, PUTs the bytes without credentials, confirms it, then creates the exact Link
`{ system: "CRMS", entityType: "return", entityId: String(id), role: "refund-proof" }`.
Only then does CREOMS send its id to the storefront, which verifies metadata, purpose,
size and a fully decodable screenshot before committing the refund. Upload or Link failure
never sends a decision. After a matching refund confirmation CREOMS promotes the File
with `PATCH /files/<id>` and checks Permanent retention with no expiry. Refusal or
uncertainty leaves Temporary proof for file-storage's seven-day cleanup; Staff must read
the Return before considering another action. Promotion failure explicitly says the
Return was refunded and warns against repeating the refund. The storefront must accept
Temporary proof first; see [recovery and rollout notes](temporary-evidence.md).

Replacement requires no proof and never reduces Total spent. Both completion actions
require the matching final Resolution and wait for Goods received when goods are required.
The read boundary supplies preferred/final Resolution on list rows, and `videoFileId`,
`refundProofFileId` and `replacedAt` on detail. File ids require authorized server-side URL
resolution; the frontend controls/media display remain #196. Until #196 supplies proof,
the old refund button safely refuses completion with a choose-proof message.

The existing storefront migration 0020 and read grants were verified as already applied;
no new CREOMS schema, environment variable or live migration is required. See the
[contract rollout record](creoms-returns-and-delivery-photo.md#creoms-verification-and-rollout-195).

Validation covers the approval default/override, legal and illegal moves for both
Resolutions, Replaced finality, proof validation and upload/Link failures, the real gateway
protocol, missing/mismatched confirmations, Temporary proof retention after refusal/lost
acknowledgement, Portal access revocation, read fields and unchanged Total spent.

## Decide return: Staff check, Manager decides

Staff never pick a Return's decision. On a Requested Return they use **Request approval · decide return**
(`requestReturnDecision(id, { photoSupportsReason, note })`). CREOMS works out whether the request came inside the Refund
window from the storefront's `requested_at` and `delivered_at` (48 hours once extended), never from the browser, and stores
`{ inWindow, photoSupportsReason }` on a `return.decide` approval request with the note as its reason. One waiting request
per Return; only Staff send it.

A Manager decides on the Return itself with `decideReturn(id, { outcome, goodsRequired?, reason? })`:

| Decision | What happens |
| --- | --- |
| `reject` | `declineReturn` with the reason, which the Customer sees. |
| `refund` | `approveReturn(id, goodsRequired, "refund")`. The refund steps follow at any amount; there is no CEO step. |
| `replacement` | `approveReturn(id, goodsRequired, "replacement")`. With no goods to come back, `markReturnReplaced` then creates the ₱0 Replacement Order at once. |

The `return.decide` request is closed (`completed`, under the Manager's name) by any successful Manager approve or decline,
and the requester is notified through the approval outbox. `decideApproval` refuses a `return.decide` request: the
Approvals list links to the Return instead.

**Stock.** `loadReplacementStock` (`features/returns/replacement-stock.ts`) maps each Return line to its Size through the
original Order's `stock_reservations` lines, the same way the storefront does, and reads the IMS through `readStock`. A
known shortage refuses approving or sending a replacement with the items named. Stock that cannot be read (IMS down, no
Reservation) is left to the storefront, which checks and reserves when the Replacement Order is made.

Tests: `tests/return-decide.test.ts`, `tests/role-approvals-ui.test.tsx`, `tests/return-detail-views.test.tsx`.
