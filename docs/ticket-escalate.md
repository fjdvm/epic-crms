# Escalate (#385)

Apply `docs/db/crms-ticket-escalate.sql` as `creoms_writer` before deploying. No ecommerce migration and no
new database-role grant: `crms.ticket_escalations` lives in CREOMS's own schema, owned by `creoms_writer`.

- "Escalated" is derived from an open row (`resolved_at is null`); one open row per Ticket (partial unique index).
  The row is also the Ticket's activity: who escalated and why, then who took it or sent it back and their note.
- `crms.notifications` gains the kinds `ticket-escalated` (one alert per Manager holding the Tickets Module, from
  the Portal staff directory; never to the person escalating) and `ticket-sent-back` (to the Claimer).
- Take uses Reassign (`reassignTickets`), so the previous Claimer gets the usual alert and the move is in the
  reassign history. A Manager who already holds the Ticket just closes the escalation.
- Release is hidden while a Ticket is escalated (the Claimer "stays on the Ticket"); the server does not enforce it.
- The escalation and its alerts are one transaction. Take is two databases (the Claimer, then the escalation); a
  retry replays the move and then closes the escalation. Audit events are best effort.
- Escalate shows only on the Ticket page, which loads the escalation; Conversations does not offer it.
