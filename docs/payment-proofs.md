# Payment methods and proof (#340)

Customers pay by GCash, Maya, bank transfer or Cash on Delivery. The first three are manual:
a reference number and an optional screenshot. Cash on Delivery has no proof and no refund to send.

## What CREOMS does

- `rejectPaymentProof(id, reason)` (Payments Module; Staff and Managers). A reason is required.
  CREOMS refuses it before calling the storefront unless the Order is awaiting payment with a proof that
  has not been rejected. Not optimistic: it emails the Customer. Audit: `payment_proof.rejected`
  (reason and rejection number in the metadata).
- `markPaid(id, { reason?, approvalId? })`. Before 3 rejections it is the ordinary check and the proof must
  not be rejected (audit `payment.marked_paid`). At 3 or more rejections it is "approve anyway":
  a reason is always required; a Manager approves directly; Staff get "Waiting for approval" and a request
  (`payment.approve-anyway` in `crms.approval_requests`, no CEO step), then retry with the `approvalId`.
  Audit `payment.approved_anyway` carries the reason. Admin and CEO cannot do either.
- Reads: the Payments queue only lists proofs waiting for a check (not rejected). `loadOrder` returns
  `paymentProofs` (every proof, oldest first, each with its rejection reason and who rejected it) and
  `proofRejections`. A new proof raises a Staff alert; each resubmission has its own alert key.

## Storefront contract (owned by Ecommerce)

CREOMS only reads these tables; the storefront migration creates them.

- `public.order_payment_proofs(id, order_id, reference, screenshot_file_id, screenshot_pathname, submitted_at,
  rejected_at, rejected_by_id, rejected_by_name, rejection_reason)`: one row per submission, never deleted.
- `public.orders.payment_proof_rejected_at` (null while the latest proof waits for a check or after a new one
  arrives) and `payment_proof_rejections integer not null default 0`. The existing proof columns on the Order
  mirror the latest proof.
- `payment_method` is one of `gcash`, `maya`, `bank-transfer`, `cash-on-delivery`.
- `POST /api/internal/orders/:id/payment-proof/reject` `{ reason, staffId, staffName }` records the rejection,
  keeps the Order `awaiting payment`, emails the re-upload link once, and answers
  `{ id, status: "awaiting payment", rejections, deliveryFeeInCentavos }`.
- `POST /api/internal/orders/:id/status` with `status: "paid"` accepts `approvedAnyway: { reason }`. The storefront
  refuses `paid` at 3 or more rejections without it, and refuses it for a rejected proof below 3.
- A Customer resubmission inserts a new proof and returns the Order to checking.
- Audit `payment_proof.submitted` is written by the storefront. A refund goes back the way the Customer paid
  (`payment_method`); Cash on Delivery has none.

Run `docs/db/creoms-payment-proofs-readonly.sql` after the storefront deploys.

## Portal

The GCash number, Maya number and bank account are Admin settings in General, logged as
`payment_settings.changed`. They live in the Portal and the storefront reads them at checkout, so they are
not built in this repository.
