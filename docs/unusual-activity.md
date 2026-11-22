# Unusual activity backend (#474)

Part of #471. No AI or model calls. Cards and their event-driven Dashboard consumer are #483;
AI explanations are #484 and the detail drawer is #485. No Dashboard UI changes in this ticket.

## Defaults and records

Named constants live in `features/dashboard/unusual-activity.ts`.

- Unverified payments: more than 5 waiting manual proofs, or the oldest waiting at least 24 hours.
  Includes GCash, Maya and bank transfer Orders awaiting payment, with a submitted, unrejected proof.
  Numbers: queue count and oldest age in whole hours. Links: contributing Orders.
- Returns spike: at least 3 distinct Returns for one product in the last 7 rolling days `(start, now]`.
  Declined/cancelled Returns do not count. Multiple sizes/lines count once per Return.
  Product identity is its immutable name snapshot in Return items; the shared schema exposes no product ID here.
  Numbers: Return count and window days. Links: contributing Returns.
- Failed deliveries: at least 3 distinct dispatched Delivery Orders with an attempt neither rebooked nor disposed.
  This is the unresolved backlog, without a rolling time window. Numbers: Order count.
  Links: each Order's Failed delivery page.
- Rejected proofs: a Customer has an awaiting-payment manual Order with at least 2 rejections.
  One card per Customer uses the highest per-Order rejection count, never a sum across Orders:
  Manager approval starts at 3 on an individual Order. Numbers: that highest count.
  Links: Customer profile and relevant Orders. Settled Orders do not count.

Per the owner’s decision on #474, Staff see no Unusual activity. Managers see only held Modules. Both Payments rules need Payments; the other rules need
Returns and Fulfilment respectively. Admin read all three Modules and cannot dismiss.
Unknown Roles read nothing. The authenticated route checks Dashboard access and discovers Modules server-side.
This owner decision supersedes the Staff access in #471 stories 31–42 and the original #474 Module-gating criterion. It avoids exposing shop-wide records on the Staff Dashboard.

Urgency is the largest ratio to the firing boundary (payment count uses 6, not 5).
Sort descending, then by stable alert key. Apply dismissals before limiting to five so hidden cards
never use a visible slot. An unavailable Module is reported separately rather than claimed to be clear.

## Interface for #483

`GET /api/dashboard/unusual-activity` returns `{ cards, unavailable }`, with private/no-store caching.
Call only on Dashboard mount, a user refresh, data-change WebSocket events and reconnect. Never on a timer,
window focus or tab visibility. The server computes from current records on every call and does not cache
across people. The UI integration and immediate loading state belong to #483.

`POST` to the same URL with header `x-creoms-alert-dismiss: 1` and JSON `{ key, numbers }`, using the exact
numbers on the rendered card. Identity and Modules are never taken from the body. Cross-site/form requests
are refused. Confirm before submitting; optimistically hide the card, then restore it and display the
returned `reason` if `ok` is false. The frontend rollback and refusal-message tests belong to #483.

Dismissal rechecks the current rule and refuses changed snapshots. Only the authenticated person's record
is written. Equal or smaller numbers stay dismissed, even after recovery and recurrence. Any larger number
resurfaces it: for payments this means a higher count **or another whole hour of waiting**; for other rules,
a higher count. Another person's dismissal never applies. Dismissing a resurfaced card atomically preserves the highest dismissed value of each metric, so concurrent requests cannot lower the baseline.
If dismissal storage is unavailable, report unavailability rather than redisplay suppressed alerts.

## Migration and verification

Run `node --env-file=.env scripts/deploy/migrate-unusual-activity.mjs` before deploying, as `creoms_writer`.
It creates only `crms.unusual_activity_dismissals`, keyed by Staff ID and alert key; no storefront migration,
new source permissions, settings or network timers. It is additive and rerunnable. The script uses a direct
Neon connection and verifies the table exists.

`tests/unusual-activity.test.ts` uses the real Postgres test database and the production migration.
It covers all four boundaries, source exclusions, numbers/links, gating, top five, dismissal isolation,
recovery/worsening, stale snapshots and failures. Route tests cover authentication, CSRF, validation,
server-derived identity and failure responses. Existing no-polling scans cover the route and feature.
Track live-production checks separately in #499; do not wait for deployment.

Figma references were requested for the foundation, reference page, redesign pages, alerts and drawer.
The roles and alert context/metadata were available; foundation/redesign context calls failed or returned
no selection. No UI is built or changed here. #471's deliberate exclusions still apply: no daily briefing,
churn/batch cards, Complaint themes on Dashboard, or Admin AI settings.

## AI "why" and "what to do" (#484)

Part of #471. `features/dashboard/unusual-activity-explain.ts`, kept in `crms.unusual_activity_explanations`
(`docs/db/crms-unusual-activity-explanations.sql`, run `node --env-file=.env scripts/deploy/migrate-unusual-activity-explanations.mjs`).

- `POST /api/dashboard/unusual-activity/explain` (header `x-creoms-alert-explain: 1`, body `{ key }`) is asked for by the Dashboard
  open, once per card that has none. The server recomputes the card; client numbers are never trusted.
- Only Staff or a Manager can cause a call. Admin only read kept text (`GET` merges kept explanations; it never calls a model).
- Sent: the rule text and the alert's own numbers, masked. No links, Orders or Customers. The sent text and system prompt are stored.
- Kept per alert key with the numbers it was made from; made again only when a number is larger than the kept one.
- Fact check: each of "why" and "what to do" is dropped if it quotes a digit or spelled-out number, or a link,
  that the alert (numbers, rule text, link labels and hrefs) does not hold. If both are dropped or the model fails, nothing is kept
  and the card shows without the explanation.
