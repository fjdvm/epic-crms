# AI-suggested Category and Priority (#388)

Apply `docs/db/crms-ticket-ai-suggestions.sql` as `creoms_writer` before deploying. No ecommerce migration and no new
role grant: `crms.ticket_ai_suggestions` is CREOMS's own table.

- **On demand only.** Staff press "Suggest with AI" on the Ticket page; nothing runs on open, on a timer or on focus.
- **Text only.** The model gets the subject and the non-internal Messages (newest kept, 4,000 characters at most), with
  emails and phone numbers masked. No names, addresses, Order or Internal notes. Exactly what was sent is stored in
  `sent_text` and shown under "What the AI saw".
- **Nothing applies without a click.** Accept (suggested value) or Change (another), each after a confirm. Each field
  records `accepted` or `changed`, the applied value and the Staff name, and writes an Audit Event
  (`ticket.ai_category_accepted`, `ticket.ai_priority_changed`, ...) with the Portal user as actor.
- **Failure is harmless.** Groq is tried, then Gemini (shared `configuredCompleters` in the feedback AI plumbing, #323).
  If none answers, or no key is set, the card says so and Category and Priority stay editable by hand.
- Staff and Managers work; Admin see the card read-only. Not sent to the Customer, ever.
