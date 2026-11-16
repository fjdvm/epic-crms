# Ticket reports (#389)

Page `/tickets/reports`, opened under the Portal's `Reports` Module (registered by the Portal migration `20261121000000_reports_module`) and the Role rule: Manager, Admin (view) and CEO (view). Staff are sent to the no-access page. The page is read only and needs no CREOMS migration: it reads `tickets`, `ticket_messages`, `customers` (read-only role) and `crms.ticket_service_misses`, `crms.ticket_escalations`, `crms.service_level_changes`.

- Period: whole Philippine days, default last 30 days; also 7 days, this month, last month, 90 days.
- First reply and resolve times come from the Service level clock (`serviceLevel`), so On hold and waiting-on-Customer time is excluded and Internal notes are not replies. First reply covers Tickets opened in the period; resolve covers Tickets marked Resolved in it.
- Share meeting the Service level: Tickets opened in the period that missed neither target, of those already settled (a stamped miss stays missed).
- Reopen rate: of Tickets marked Resolved in the period, those Open or On hold again, or with a Follow-up Ticket.
- Rating, lowest ratings (ten, with comment and link), Tickets by Category and Escalations are for the period; per Staff member: open now, resolved in the period, average rating.
- Dropped from Figma: Where tickets came from, Export, the satisfaction chart beyond the average, AI figures.
