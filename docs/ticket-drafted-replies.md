# Drafted reply backend (#479)

Part of #471. The caller is the Claimer of an Open Ticket, with the Tickets Module and Staff or Manager Role. Admin and CEO never configure a model. `requestDraftedReply(ticketId, { language, shorterThanId? })` is an explicit server action; nothing generates on a timer, focus, visibility or Ticket open.

The backend reads the latest six public Messages in chronological order. It masks known Customer and Staff names, delivery address components, email addresses and phone-like numbers before truncating. Internal notes, subject, rider details, payment references, amounts and other Customer data are excluded. Order inputs are limited to the status, payment kind, courier and record dates. The tracking URL stays local: the model sees only whether one is available. Booking time is the latest rebooking timestamp or the initial dispatch timestamp; it never invents a promised arrival date.

The model composes an array of checked English or Taglish sentences and fact tokens (`{{status}}`, `{{courier}}`, `{{booked_at}}`, `{{payment_method}}`, `{{created_at}}`, `{{paid_at}}`, `{{dispatched_at}}`, `{{delivered_at}}`, `{{tracking_link}}`). The server inserts facts from the Linked order. Other prose, unknown tokens and unavailable facts are refused with a plain explanation. This intentionally limits phrasing to greetings, acknowledgements, an apology, a request for more detail and record facts: arbitrary prose cannot be reliably fact-checked in both languages. Staff can edit the resulting draft in the ordinary reply box. No arrival promise, refund, discount or replacement promise can pass this vocabulary.

Make shorter asks the model again with the requested language and a strict character ceiling from the saved draft, using fresh Messages and Order facts. It never resends an edited or unmasked draft. A result that is not strictly shorter is refused. Changed Claim, Ticket status, Linked order or Order facts during generation also invalidate the result.

`crms.ticket_drafts` retains the exact user and system prompts, requester, language, prior-draft reference, model, result or refusal and timestamp. Input is saved before calling a model, including failed attempts. Successful responses return `sentText` and `systemPrompt` for the future What the AI saw view. The UI controls belong to the follow-on frontend ticket; this backend does not modify or overwrite the composer.

When the ordinary `reply` action receives optional FormData `draftId`, it verifies that the saved draft belongs to this Ticket and Claimer, calls the normal guarded Message sender and then emits `ticket.drafted_reply_sent` with the Claimer's name, draft and Message ids, and `sent as drafted` or `sent as edited` (compared to the exact saved text after the existing send trim). Normal manual replies require neither a draft nor the CREOMS database. No failed send is audited as successful. Auditing uses the existing gateway boundary and a stable Message-based operation identity.

Apply the additive migration before deployment:

```sh
node --env-file=.env scripts/deploy/migrate-ticket-drafts.mjs
```

The migration runs as `creoms_writer`, verifies the table and is safe to rerun. It changes no storefront table or grant. Use the deployment's authorized environment file.

Verification uses the parent spec's server-function seam with a real PGlite database and fake AI SDK model: `tests/ticket-draft.test.ts` and `tests/ticket-draft-actions.test.ts`. These cover generation privacy and exact persistence, access and Module gates, fact rejection, both languages, shorter drafts, failed providers, manual send, Claim/Order changes, forged references and named send audits. Production/provider and later UI checks belong in a separate verification issue.
