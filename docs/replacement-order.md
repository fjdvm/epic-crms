# Replacement Order and the Refund window extension (#349)

CREOMS never owns these rules; it asks the storefront (`returns` credential) and audits the result.

- **Replacement Order.** `markReturnReplaced` (a Manager approves; Staff "Request approval") first calls
  `POST /api/internal/returns/{id}/replacement-order`. The storefront creates a ₱0 Order linked by `replacement_for_order_id`
  and `replacement_for_return_id`, reserves its stock, quotes no Delivery fee, and emails the Customer once. The Return id
  is the idempotency key. A refusal (for example no stock) leaves the Return un-Replaced. Audit: `return.replacement_order_created`.
- **Not counted.** Total spent, order count, Stage, Buyers and Sales filter these Orders out with `notReplacement()`
  (`lib/replacement-order.ts`), read through `to_jsonb` so CREOMS works before the storefront adds the column.
- **Window extension.** `extendRefundWindow(orderId, reason)` is an approval action `return.extend-window` (amount 0).
  The storefront (`POST /api/internal/orders/{id}/refund-window/extend`) allows one extension of 24 hours on a delivered Order
  and stores `refund_window_extended_at` and the reason. Audit: `return.window_extended`.

Storefront columns CREOMS reads on `orders`: `replacement_for_order_id`, `replacement_for_return_id`, `refund_window_extended_at`.
CREOMS has no database migration of its own for this; the storefront owns them.
