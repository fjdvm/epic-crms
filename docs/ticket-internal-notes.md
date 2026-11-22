# Internal notes (#386)

Needs the ecommerce migration `0039_ticket_internal_notes` (adds `ticket_messages.internal` and `author_name`, and makes
the customer reply-notification trigger skip internal rows) applied **before** deploying this change. No CREOMS schema
change. The `creoms_tickets` role already has table-level `SELECT, INSERT` on `ticket_messages`, which covers the new
columns; `docs/sql/creoms-tickets-role.sql` in ecommerce restates the grant.

- A note is a `ticket_messages` row with `sender = 'staff'`, `internal = true` and the writer's name in `author_name`.
  Any Staff or Manager with the Tickets Module may add one, on any Ticket (claimed by someone else, unclaimed or
  Completed). Admin only read. Text only, at most 2,000 characters; permanent.
- Every query that decides "who spoke last" (list Overdue and waiting, Dashboard Needs attention, the Conversations preview,
  the Service level clocks) filters `not internal`, so a note never counts as a Staff reply and never clears Overdue.
- No alert and no audit event. Shown on the Ticket page and in Conversations, styled apart from replies.
- Optimistic: the note shows at once as "sending…" after the confirm dialog; a refusal removes it, says why and restores the text.
- The storefront thread and attachment lookup exclude internal rows (ecommerce, `lib/support/tickets.ts`).
