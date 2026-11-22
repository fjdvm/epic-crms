# Return flag (#477)

Part of #471. Plain rules and a similar-image fingerprint; no model, and no photo leaves our own file storage.

- **Count rule:** a Return is flagged when its Customer has 3 or more Returns requested in the 90 days up to and including it (cancelled Returns do not count). Two do not flag. The flag links the Customer's earlier Returns.
- **Similar photo:** each evidence photo gets a fingerprint, computed here with `sharp` (two 64-bit difference hashes: the whole picture and its middle 80%, so crops and re-saves still match). A photo is similar to a photo on an *earlier* Return (any Customer) when any pairing is within 10 differing bits. The flag links the earlier Return(s); the first use is never flagged.
- Fingerprints are kept in `crms.return_photo_fingerprints` (migration `docs/db/crms-return-photo-fingerprints.sql`). They are computed when the notification sync sees a photo (10 per run), and when Staff open a Return that lacks them. An unreadable photo just has no fingerprint yet.
- Shown on the Return ("Flags" card) and in the Returns list under the number. Nothing is blocked or declined by a flag.

The storefront owns the upload; hashing at upload there would be a later optimisation. This ticket needs no storefront change.

## Explain this flag (#489)

Part of #471. `POST /api/returns/:id/flag-explanation` (header `x-creoms-flag-explain: 1`, body `{ rule }`), asked by a click, never a timer.

- **Only a Manager** can ask. Staff and Admin are refused before anything is read or sent (no model call).
- **Sent:** record data only: the flag rule, this Return's RMA number, date and reason, and each linked earlier Return's RMA number, date, reason and status, plus the counts. No photo, no name or address, no free-text note. The exact text and system prompt are stored with the explanation (`crms.return_flag_explanations`, migration `docs/db/crms-return-flag-explanations.sql`, plus who asked).
- **Fact check:** text quoting a number (including an RMA number) the record does not hold, or a link, is dropped and nothing is kept.
- **Kept** per Return and rule; asked again, the kept text is returned without a model call.
- **Failure** (model down, no key, dropped text) returns `unavailable`; the flag keeps showing without the explanation.
