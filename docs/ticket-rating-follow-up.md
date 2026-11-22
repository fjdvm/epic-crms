# Ticket rating and Follow-up Ticket (#387)

The storefront (ecommerce, migration `0040_ticket_rating_follow_up`) owns the columns on `tickets`: `rating` (1 to 5),
`rating_comment`, `rated_at`, and `follow_up_of_id`. CREOMS only reads them, through the existing `creoms_tickets`
role (table-level SELECT, UPDATE already covers new columns). No CREOMS migration and no new grant.

- **Rating:** given once by the Customer when they confirm a fix or complete their own Ticket, never at auto-complete,
  never edited. Skipping never blocks confirming. No alert is sent and nothing is reopened. CREOMS shows it on the
  Ticket page under "Customer rating" (read-only for every role).
- **Follow-up:** a Completed Ticket offers Need more help on the storefront; the new Ticket stores `follow_up_of_id`
  with Category and Linked order pre-filled and editable. The old Ticket stays Completed. CREOMS shows
  "Follow-up of TKT-x" on the new Ticket and "Follow-up: TKT-y" on the old one under "Related tickets".
- **Reports:** a Ticket with `follow_up_of_id` is a reopen for the Ticket reports (slice 9); that column is the source.
