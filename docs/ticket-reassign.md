# Manager reassign (#384)

Apply `docs/db/crms-ticket-reassign.sql` as `creoms_writer` before deploying. No ecommerce migration: the
Claimer stays on `tickets.claimed_by_id` / `claimed_by_name`, already updated by the `creoms_tickets` role.

- `crms.ticket_reassignments` is the Ticket's activity and the history Admin and CEO read; one row per
  Ticket moved, unique on `(operation_id, ticket_id)` so a retry replays.
- `crms.notifications` gains `detail jsonb` and the kind `ticket-reassigned`, addressed to the previous and
  the new Claimer by Portal username. A bulk move sends one alert each, not one per Ticket. The Manager is
  not alerted about their own move. Alerts reach Portal through the existing copy sync.
- The Claimer update is guarded (`claimed_by_id = <who the Manager saw>`), so a lost race moves nothing.
- Recipients are checked against the Portal staff directory (Tickets Module, Staff or Manager).
- The Claimer change and the history/alert write use two databases and are not one transaction; if the
  second fails the move stands and the failure is logged. A retry does not rewrite the history (the Claimer
  already changed, so it reports that someone else changed the Ticket first); the audit event is separate and
  is also best effort. Known gap, left for a follow-up if it shows up in practice.
- The single move is optimistic with rollback. "Reassign all" shows a toast at once and updates the list when
  the server answers, because it changes many rows of a server-rendered list.
