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
  second fails the move stands, the failure is logged, and repeating the same operation id writes it.
