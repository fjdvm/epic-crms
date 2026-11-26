# POS online sales feed: design

## Intent
The owner wants the POS (`web-pos`) to show CREOMS's online storefront Sales: the overall figure, and per product and Size
the units sold and the money brought in. The POS knows only in-store sales today.

## Decided
- Direction CREOMS → POS; the POS asks CREOMS (pull, read-only).
- One row per product and Size, with the IMS product ID where known, so the POS can match its own products.
- This work covers CREOMS only; the POS screen is a later web-pos ticket. The contract is `docs/pos-sales-feed.md`.

## Approaches
- **Pull endpoint (chosen):** `GET /api/internal/pos-sales?from&to`, signed with a short-lived HS256 JWT like the IMS stock
  push. Reuses the Dashboard's Sales rule, so both systems show the same figures. Little to break.
- **Push on Order change:** always fresh in the POS, but the POS keeps a copy, and retries and ordering must be handled.
  Too much for figures nobody needs to the second.
- **Direct database read by the POS:** fastest to wire, but bypasses CREOMS's Sales rules (refunds, Replacement Orders), so
  the figures would drift. Rejected.

## Builder's calls
- Any range of whole Philippine days, up to 366, future days allowed (they hold nothing), so "this month" works.
- The IMS product comes from the Order's Reservation line (`orderLineId` → `sizeId` → `sizes.ims_product_id`); `null` without one.
- `otherSales` carries delivery fees and refund adjustments so the rows reconcile to `sales`.
- Inherits the Sales rule as is, including not subtracting the approved discount; changing that is a separate ticket.
- Secret `POS_CREOMS_SECRET` (plus `_PREVIOUS` for rotation), set to the same value on CREOMS and the POS.
