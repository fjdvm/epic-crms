# Return flag (#477)

Part of #471. Plain rules and a similar-image fingerprint; no model, and no photo leaves our own file storage.

- **Count rule:** a Return is flagged when its Customer has 3 or more Returns requested in the 90 days up to and including it (cancelled Returns do not count). Two do not flag. The flag links the Customer's earlier Returns.
- **Similar photo:** each evidence photo gets a fingerprint, computed here with `sharp` (two 64-bit difference hashes: the whole picture and its middle 80%, so crops and re-saves still match). A photo is similar to a photo on an *earlier* Return (any Customer) when any pairing is within 10 differing bits. The flag links the earlier Return(s); the first use is never flagged.
- Fingerprints are kept in `crms.return_photo_fingerprints` (migration `docs/db/crms-return-photo-fingerprints.sql`). They are computed when the notification sync sees a photo (10 per run), and when Staff open a Return that lacks them. An unreadable photo just has no fingerprint yet.
- Shown on the Return ("Flags" card) and in the Returns list under the number. Nothing is blocked or declined by a flag.

The storefront owns the upload; hashing at upload there would be a later optimisation. This ticket needs no storefront change.
