# Complaint themes backend (#481)

Part of #471. Backend only; the Feedback page card, Refresh button and loading state are a separate UI ticket.
Apply `docs/db/crms-complaint-themes.sql` as `creoms_writer` (additive, safe to repeat):

```sh
node --env-file=.env --env-file=.env.local scripts/deploy/migrate-complaint-themes.mjs
```

`openComplaintThemes` (`features/feedback/complaint-themes.ts`) and `POST /api/feedback/complaint-themes`
(`{ from?, to?, refresh? }`, header `x-creoms-complaint-themes: 1`; call only on page open for a period or on Refresh).

- Items: each Ticket's first public Customer Message, Return reason + note, Feedback of 1 to 3 stars, in the period
  (Philippines-time days). IDs are `T<id>`, `R<id>`, `F<orderId>`. The newest 300 are read; `truncated` reports more.
- Sent: masked (Customer names, emails, phone numbers) and cut to 280 characters. No Internal notes, addresses or names.
- The model returns labels and IDs. IDs not sent are ignored; an item stays in the first theme that claims it; one Customer
  counts once per theme; under 3 items drops the theme; at most 5 themes. Counts and links come from valid IDs only.
- Kept per period with time, counts read, what was sent. Made when none exists, remade only on `refresh`. A failed refresh
  keeps the old result. Fewer than 3 items stores an empty result without a model call.
- Managers make and refresh; Admin and CEO read the kept result (never a model call); Staff are refused.
