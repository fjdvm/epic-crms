# Refund destination (#610)

Staff see where the Customer asked their refund to go (captured by the storefront, #609), masked. It locks at approval.

- **Read.** `loadReturnDetail` returns the destination masked (`•••••••4567`); the full number never reaches a page or browser from it.
  Columns: `order_returns.refund_method`, `refund_account_name`, `refund_account_number`, `refund_bank_name` (storefront migration `0059_refund_destination.sql`, #609; the change endpoint is in the same storefront PR, ecommerce #338).
- **Locked** from approval on (`approved`, `goods received`, `refunded`). Nobody types a destination at refund time: `markReturnRefunded` refuses any form field besides the proof.
- **Full number.** `revealRefundDestination(id)` returns it only for an approved refund whose goods are back (or not required) and that is not Refunded yet, to Staff and Managers; Admin see it masked. Each look is audited as `return.refund_destination_viewed`, masked. The card answers the click at once with a pending label.
- **Change.** `changeRefundDestination(id, details + reason + customerConfirmed)` is the approval action `return.change-destination` (amount 0): a Manager does it; Staff see "Request approval". Only before money is sent. Never optimistic (it decides where money goes); it shows a spinner and the page updates when the storefront confirms. The approval request holds only the masked form and a digest of the details, never the full number. Audited as `return.refund_destination_changed`, number masked.
- **Storefront contract.** `POST /api/internal/returns/{id}/refund-destination` (returns-scoped service credential) with `{ method, accountName, accountNumber, bankName, reason, customerConfirmed: true, staffId, staffName }`; answers `{ returnId, changedAt }`, or an error with a reason (409 when money was already sent or the refund is not approved).
