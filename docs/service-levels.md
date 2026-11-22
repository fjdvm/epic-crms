# Service levels (#383)

Apply `docs/db/crms-service-levels.sql` as `creoms_writer` **after** the ecommerce migration
`0038_ticket_hold_clock` (it adds `tickets.hold_started_at` and `held_seconds`, kept by a trigger).

- Targets live in `crms.service_level_changes`, one row per change, so a Ticket takes the pair in
  force at `created_at`. A Manager edits in Commerce Settings (Management); Staff and Admin are refused.
- The clock is `features/tickets/service-level.ts`. Hold time comes from the Ticket; waiting on the
  Customer comes from the Messages. Misses are stamped in `crms.ticket_service_misses` and never cleared.
- Overdue (Tickets list and Dashboard) both use `firstReplyHoursSql`. If the targets cannot be read,
  the list and the Needs attention queue report unavailable rather than guess.
- Known simplification: the first reply is judged on all hold time recorded on the Ticket, capped at
  the time before the reply; a Ticket reopened after Resolved keeps its earlier Resolved time counted.
