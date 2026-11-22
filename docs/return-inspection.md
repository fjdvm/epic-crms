# Returns inspection: restock, write-off and approvals (#348)

After Goods received, Staff inspect each **whole line item** of a Return: **sellable** (the storefront adds it back to IMS stock) or **damaged** (needs a write-off). No part quantities, no exchange for another size, no store credit, no batch parts; resolution stays refund or same-item replacement.

| Action | Who | Notes |
| --- | --- | --- |
| `inspectReturn(id, inspectionId, items)` | Staff, Manager | Return must be Goods received and not yet inspected; every item must be marked. Never optimistic: restocking is an outside effect. Audit `return.inspected`. |
| `writeOffReturn(id, options)` | Staff request, Manager approves (final at any amount) | Shared Request approval workflow (`write-off`). Audit `writeoff.requested` (workflow) and `writeoff.approved` on execution. |
| `markReturnRefunded` | as before | Refused until the items are inspected (when goods came back and the Return has items). Sends the Order's payment method so the refund goes back the way the Customer paid; proof upload still required. Audit `return.refund_approved`. |

Admin can read the inspection but not act.

## Storefront contract

`POST /api/internal/returns/<id>/inspection` (Returns credential), body `{ action: "inspect", inspectionId, items: [{ orderLineId, condition }] }` or `{ action: "write-off", inspectionId }`, plus `staffId`, `staffName`. The response echoes `id`, `inspectionId`, `action`. A repeated `inspectionId` is a no-op, so explicit recovery after a timeout is safe; CREOMS never retries on its own. The storefront owns IMS add-back and the Customer email, once per decision.

Companion columns on `order_return_items` (storefront migration, not applied from this repo): `condition` (`sellable`|`damaged`), `inspected_at`, `inspected_by_id`, `inspected_by_name`, `inspection_id`, `restocked_at`, `written_off_at`. CREOMS reads them with the existing `SELECT` grant and tolerates their absence. No CREOMS schema change. Production migration needs the owner's approval for the exact command; live checks belong to a separate verification ticket.
