# Staff Return decisions (#171)

The complete [storefront contract](creoms-returns-and-delivery-photo.md) also covers
Customer requests and cancellation, Received, Delivery photos and Customer Notifications.

`features/returns/actions.ts` exposes these server actions:

| Action | Eligible Return | Decision sent |
| --- | --- | --- |
| `approveReturn(id, goodsRequired)` | Requested | `approved`, explicit boolean `goodsRequired` |
| `declineReturn(id, reason)` | Requested | `declined`, trimmed nonempty `declineReason` |
| `markReturnGoodsReceived(id)` | Approved with `goodsRequired: true` | `goods received` |
| `markReturnRefunded(id)` | Goods received, or Approved with `goodsRequired: false` | `refunded` |

Every action checks the Returns Module through the Portal before validating input or opening the read-only database. Orders, Payments and Fulfilment grants do not authorize Return decisions. Access is rechecked on every call, including revocations. Any Returns Staff member may perform the next eligible step, regardless of who approved it. Staff identity is always taken from the Portal; neither identity nor timestamps are accepted from the browser. A previously requested Return does not expire with the Customer's Refund window.

CREOMS reads the current Return to reject stale/ineligible steps with an “already changed” reason, then asks the storefront to make the decision. The storefront must independently enforce the same rules atomically, including a race with Customer cancellation or another Staff decision. Once Approved, a Return cannot be declined. Refunded, Declined and Cancelled are final. A Return never changes its Order's status.

## Proposed storefront endpoint

This is the proposed decision contract, extending the #170 read contract. It is implemented in `tests/fake-storefront.ts`; deploying the real storefront endpoint is separate storefront work under #168/#179.

`POST /api/internal/returns/<id>/status`, using the existing server-only `CREOMS_STOREFRONT_URL` and `CREOMS_SERVICE_SECRET`. Requests use JSON, no caching, no redirects, and a ten-second timeout. There is exactly one attempt.

Authorization is `Bearer <HS256 JWT>`, signed with the same service secret as Orders (at least 32 characters). Return credentials are scoped separately: `iss: "creoms"`, `aud: "brenraphaels-returns"`, `scope: "returns:status"`, `iat` now, `exp` five minutes later. An Orders credential must not authorize a Return request or vice versa.

Every body includes `staffId` (Portal username) and `staffName` (Portal name snapshot), plus only the decision fields in the table above. For example:

```json
{ "status": "approved", "goodsRequired": false, "staffId": "ana", "staffName": "Ana Reyes" }
```

The storefront must commit the new status, any goods/decline decision and one Staff history entry (`actor_type: "staff"`, username, name and storefront time) in one transaction. Refunded also records `refunded_at` in that transaction. The storefront owns Customer emails and Notifications; CREOMS neither sends them nor moves money. Refunded means Staff have already paid the money outside CREOMS.

A successful response is JSON with `id`, the requested `status`, and `actedBy: { id, name, at }`, where `at` is an ISO timestamp recorded by the storefront. Approval must also echo `goodsRequired`; decline must echo `declineReason`:

```json
{
  "id": 15,
  "status": "approved",
  "goodsRequired": false,
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
