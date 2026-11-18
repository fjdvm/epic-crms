# Senior/PWD verification (#342)

A Customer uploads an ID photo and number on the storefront. Staff review it before the Order confirms.
The storefront owns the verification; CREOMS reads it and asks the storefront to record each decision.

## What CREOMS does (`features/senior-pwd/actions.ts`, Orders Module)

- `loadVerifications()`: waiting reviews (oldest first) and the latest decisions. Status is as of now, so a
  photo past 7 days or an ID past its expiry date reads `expired`.
- `loadVerificationPhoto(id)`: short-lived private address, only while the photo waits for review.
- `approveVerification(id, expiresOn)` and `declineVerification(id, reason)`: Staff and Managers. Never
  optimistic (the Customer is emailed). After the storefront confirms, CREOMS deletes the photo; if that
  fails the decision stands and file-storage's seven-day expiry removes it.
- `overrideVerification(id, expiresOn, reason)` (approve a declined or revoked one) and
  `revokeVerification(id, reason)`: Managers only; Staff are told to request a Manager. Admin and CEO are read-only.
- Audit: `pwd.approved` (an override carries `override: true` and the reason), `pwd.declined`, `pwd.revoked`.
  Metadata holds the verification id, ID type, expiry date and reason. Never the ID number, hash or photo.
- Confirming (`confirmPickup`, `quoteDeliveryFee`) is refused while the Order's ID is still pending review.
- Free delivery is checked on the gross subtotal, so the 5% discount never costs free delivery.

## Storefront contract (owned by Ecommerce)

- `public.senior_pwd_verifications(id, customer_id, id_type 'senior'|'pwd', status 'pending'|'approved'|'declined'|'revoked'|'expired',
  id_hash, photo_file_id, submitted_at, decided_at, decided_by_id, decided_by_name, decline_reason, expires_on)` and
  `public.orders.senior_pwd_verification_id`. `id_hash` is an HMAC of the ID number under a server secret; the
  number is never stored, emailed or logged. The same hash is refused on a second account.
- `POST /api/internal/senior-pwd/:id/{approve|decline|revoke}` (credential audience `brenraphaels-senior-pwd`,
  scope `senior-pwd:status`) with `{ action, expiresOn?, override?, reason?, staffId, staffName }`; it answers
  `{ id, status, expiresOn }`, clears `photo_file_id`, emails the decision once without the number, and refuses a
  number already verified on another account.
- Removing an unreviewed photo after 7 days (status `expired`, photo cleared, Customer asked to upload again),
  the one-item 5% discount and its lapse on `expires_on` are storefront behaviour.

Run `docs/db/creoms-senior-pwd-readonly.sql` after the storefront deploys. No CREOMS migration is needed.

## Review screen and Order detail (#343)

- `/orders/senior-pwd` (Orders Module): waiting reviews and latest decisions. Review shows the account name, ID type
  and the private photo (fetched only when the dialog opens); Staff read the number off the photo, which is never stored.
  Approve needs the ID's expiry date; Decline needs a reason. Staff see "Request approval" on a declined, revoked or
  approved ID; Managers get Override and Revoke; Admin and CEO see no buttons. No Figma frame exists, so it is built from
  the foundation node. Never optimistic: the Customer is emailed.
- Order detail's Customer card shows Senior/PWD status ("Not verified" by default) and, for an approved Pickup,
  a reminder to see the original ID at collection.
- Order detail (#571) shows a "Senior/PWD discount" card only when the Order has an approved discount: the discount,
  "₱X of ₱125.00" weekly allowance used, and the reduction reason when the cap cut it. CREOMS reads two optional
  `public.orders` columns the storefront saves at confirmation: `senior_pwd_allowance_used_in_centavos` (this ID's week
  total including this Order) and `discount_reduction_reason`. Missing columns show "Not reported yet". No ID number.
- The checkout step (photo front/back, number) is Storefront work in the Ecommerce repo, not CREOMS.

## ID reading in the review screen (#476)

- Approve opens "Read from the photo": the browser reads the ID with Tesseract (`tesseract.js`, `features/senior-pwd/read-id-photo.ts`)
  and `parseIdText` (`id-reading.ts`) turns the text into name, ID number and expiry. The photo is only handed to the local
  worker: no request carries the image, and nothing read is stored or sent except the confirmed expiry date, as before.
- Each field is pre-filled, Staff can type over it, and a field applies only after Staff press Confirm (typing again un-confirms it).
  Approve needs all three confirmed and the name to match the account name (`nameMatches`).
- If the reading fails or the photo is poor, the fields are empty and Staff type them. The existing expiry rule (server) and the storefront's
  hash and one-ID-one-account check are unchanged. Override has no photo and keeps its manual date.
