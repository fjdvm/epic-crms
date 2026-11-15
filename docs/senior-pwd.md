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

## Not built here

No review screen yet (no Figma frame exists); it is a follow-up front-end ticket built from the UI foundation node.
The Portal's Module list has no separate Senior/PWD Module, so review uses the Orders Module for now.
