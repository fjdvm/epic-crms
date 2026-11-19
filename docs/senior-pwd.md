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

- `/orders/senior-pwd` (now moved, see Approvals below): waiting reviews and latest decisions. Review shows the account name, ID type
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

## Same ID number on another account

- CREOMS can never read `id_hash`. The storefront compares the hashes when an ID is sent and saves `public.senior_pwd_verifications.same_id_as_verification_id`, the other account's verification that carries the same number (set for a number last seen declined, revoked or expired; a number pending or approved elsewhere is refused before it is saved). Grant it with `docs/db/creoms-senior-pwd-readonly.sql`.
- The checks list shows "ID already used by another account" under the Customer, and the check detail shows a warning naming the other account (name, hidden email, status) with a link to its check. It warns; it does not block, and the storefront still refuses approving a number already verified on another account. Names are not copied: Staff compare the name on the ID with the account name as before.

## Senior/PWD checks in Approvals

- The "Senior/PWD checks" sidebar tab is gone. ID checks are the "ID checks" type on Approvals (`/approvals?type=id-check`, `APPROVALS_ID_CHECKS` in
  `lib/portal/pages.ts`). `/customer-profiles/senior-pwd` and `/orders/senior-pwd` redirect there. The review pages are still held by the Senior/PWD Portal Module.
- Each ID check is a row: Customer, "Waiting for review" until decided, then Approved or Declined (revoked and expired count as declined), with Review (Staff and
  Manager) or View (Admin and CEO) opening the detail page. The old per-row "ID already used by another account" flag now shows only on the detail page.
- Detail (`/customer-profiles/senior-pwd/<id>`): the private photo (zoom, rotate, back of the ID when sent) beside "Check each field". The browser reads the
  photo and pre-fills Full name and Valid until; Staff confirm each. ID type shows as the Customer chose it. The ID number is never read into a field: the
  Figma shows it as "Shown only on the photo · not stored". Approve stays disabled until name (which must match the account) and expiry are confirmed; Decline
  needs a reason. Both are confirm-first and never optimistic (the Customer is emailed). A decided ID shows its decision, never a photo, and a Manager gets
  Override or Revoke; Staff see "Request approval". Admin and CEO see a "Read-only" badge and no buttons.
- File storage: the photo address is short-lived and fetched only while the ID waits; the photo is deleted right after a decision (unchanged).
- Audit: decisions as before, plus `pwd.photo_viewed` when Staff open the photo (module Senior/PWD, who and which ID, never the number), at most one per Staff
  member per ten minutes.
- Notifications (live): a new upload raises a `senior-pwd-waiting` alert for every Staff member with the Senior/PWD Module (`syncSeniorPwdEvents`, same ledger,
  baseline and lock as Return alerts; `crms.notifications.verification_id`, `seen_senior_pwd`, `senior_pwd_sync_state`). It is created by the existing
  notification sync (storefront signal or scheduler, no timer), which nudges the Staff WebSocket, so the bell and toast update at once and the page refreshes.
  The text is "<Customer> uploaded a Senior/PWD ID to review" and leads to the detail page. Apply `docs/db/crms-senior-pwd-notifications.sql` as
  `creoms_writer` (`node --env-file=.env scripts/deploy/migrate-senior-pwd-notifications.mjs`); applied to production on 2026-11-19. The Ecommerce
  storefront should signal CREOMS after saving an upload so the alert does not wait for the next sync.

## Senior/PWD discount setting (Commerce Settings)

- A Manager or the CEO sets the rule on Commerce Settings: the discount as a percentage or pesos, and a limit in pesos per day, week or month
  (for example "₱1,500 per week"). A pesos discount cannot be over the limit. Never optimistic, confirm-first, audited as `senior_pwd_discount.changed`
  with the old and new rule. Admin and Staff are refused on the server.
- Stored in one row of `crms.senior_pwd_discount_settings` (`docs/db/crms-senior-pwd-discount.sql`, applied with
  `node --env-file=.env scripts/deploy/migrate-senior-pwd-discount.mjs`; applied to production on 2026-11-19). The default is today's rule: 5% off, up to
  ₱125 per week. `discount_hundredths` is a percentage times 100 or centavos by `discount_kind`.
- **Storefront contract (Ecommerce):** the storefront must read this row (it needs SELECT on the table, as for `crms.delivery_settings`) instead of its fixed
  5% and ₱125 per week, and orders keep the rule they were placed under. Until it does, saving here changes only what CREOMS shows.

## ID reading in the review screen (#476)

- Approve opens "Read from the photo": the browser reads the ID with Tesseract (`tesseract.js`, `features/senior-pwd/read-id-photo.ts`)
  and `parseIdText` (`id-reading.ts`) turns the text into name, ID number and expiry. The photo is only handed to the local
  worker: no request carries the image, and nothing read is stored or sent except the confirmed expiry date, as before.
- Each field is pre-filled, Staff can type over it, and a field applies only after Staff press Confirm (typing again un-confirms it).
  Approve needs the name and expiry confirmed and the name to match the account name (`nameMatches`). Superseded in part by the Senior/PWD
  checks tab: the ID number is no longer read into a field.
- If the reading fails or the photo is poor, the fields are empty and Staff type them. The existing expiry rule (server) and the storefront's
  hash and one-ID-one-account check are unchanged. Override has no photo and keeps its manual date.
