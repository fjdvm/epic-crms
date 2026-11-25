# AI insights

`/dashboard/ai-insights`, under OVERVIEW below Summary. One job: what changed this week, where, and what to look at next.
The Dashboard (Summary) shows today's work and Reports shows numbers over time; AI insights explains the "why" and suggests a
next step. Design: Figma file `76nS6Pw2TXA6fWfUvTmzJ1`, section "AI insights" (main, Evidence drawer, Not enough data).

## Who sees it

Manager-level Roles (CREOMS Manager, General Manager, CEO, VP) and Admin. Staff never see the entry and are sent back to the
Summary. Admin sees a "Read-only" badge. Nothing on the page is a Manager decision: the buttons only open screens, so CEO and
VP see the same page as a Manager (AGENTS.md). "Dismiss for me" and "Was this useful?" are personal and allowed for everyone
who can open the page. Each card, stat tile and the map show only to people who hold their Module.

## The page

1. Header: "Suggestions only", the period (Last 7 days / Last 30 days), Export PDF, and when the run was made.
2. "This week in brief": two or three AI sentences with a confidence label, and "See what this is based on".
3. Stat row: Orders, Late or failed, Returns & damage, Open tickets, Stock watch.
4. "Where it's happening" and "Top areas" (below).
5. "Insights to look at": tabs All, Stock, Payments, Support, Returns, Delivery, and equal-height cards. Each card has its
   category, headline, priority (High / Watch / Info), a "Based on:" line, a "Why and what to do" box with a confidence label,
   "See evidence", "Open <screen>" and "Dismiss for me".
6. Unusual activity (unchanged, `docs/unusual-activity.md`).
7. "How this works".

**Evidence drawer** ("See evidence"): headline and tags, "How the AI got here" (the rule's steps), why the confidence is what it
is, the records behind the card (read when the drawer opens, so names and statuses are current; each links to its Order,
Ticket or Return), the suggested next step, "Was this useful?" and "Dismiss for me".

**Not enough data**: with fewer than 30 Orders in the period no insight is made and no model is asked. The stat row shows
dashes, the map says so, and the grid offers "Open Dashboard" and "Open Reports". Before the first morning run the page says
it is waiting for it.

## The rules (`features/ai-insights/insights.ts`)

Every figure, priority and confidence comes from code and SQL (`facts.ts`); the rules are fixed, with no setting.

| Card | When | Records | Opens |
|---|---|---|---|
| Stock | a Size runs out within 5 days at the last 14 days' sales (`crms.stock_count`, read-only) | Orders that sold it | Stock |
| Payments | GCash, Maya or bank Orders the storefront will cancel at their payment deadline within 24 hours | those Orders | Payments |
| Support: themes | 3+ Tickets about the same problem, with the product and city most of their Orders share | the Tickets | Tickets |
| Support: SLA | open Tickets with no reply yet and 75%+ of the first-reply target used (the clock stops while On hold) | the Tickets | Tickets |
| Returns | a product with 3+ units returned, at 5%+ and at least twice the shop's return rate | the Returns | Returns |
| Delivery: areas | cities with 4+ deliveries, 15%+ late or failed, up 10+ points on the period before | the late or failed Orders | Fulfilment |
| Delivery: couriers | the same rule for Lalamove, Grab or another courier | the late or failed Orders | Fulfilment |

- **Late** means delivered more than 48 hours after payment (after placing, for Cash on Delivery). The repo had no
  definition; this one is fixed in `RULES.lateHours`.
- **Payment deadline**: the storefront's own rule (`lib/orders/stock-reservations.ts` there). The deadline saved at
  confirmation, or 24 hours after confirmation for older Orders. Only confirmed Orders, or Orders awaiting payment with no
  proof waiting to be checked, since a proof waiting pauses it.
- **Ticket themes** reuse the Complaint themes grouping (`docs/complaint-themes.md`): the model only labels groups; counts
  and links come from the Ticket IDs sent. The repo has no product batch, so themes are grouped by product and city.
- **Confidence** comes from the sample: High from 30, Medium from 10, Low below. Themes are never above Medium. Payment
  deadlines and Ticket clocks are High because they are exact.
- **Marketing is left out**: no campaigns, segments, win-back or bundle suggestions.

## The morning run

`GET /api/cron/ai-insights`, called by `.github/workflows/ai-insights.yml` at 22:00 UTC (6:00 am Philippine time) with
`Authorization: Bearer $CRON_SECRET`. It works out both periods, the last 7 and 30 whole Philippine days, each against the
same length before, and keeps one row per day and period in `crms.ai_insight_runs`. A rerun that day replaces it, and the
workflow can be started by hand. GitHub can start a schedule late; the page shows the time the run actually finished.

**The run is the only thing that ever asks a model.** A page open, an Admin or a Staff member never cause a model call. Per
period:

- One call words the summary and each card's "Why and what to do". It gets the period, aggregate figures, and each card's own
  text and numbers. That means names of places, products and couriers, never a Customer's name, phone number or email (masked
  again with `maskText`).
- A sentence that quotes a number not in its facts, or a link, is thrown away. The card then shows the rule's own next step,
  labelled as such.
- What was sent, the system prompt and the model are kept on the run.
- If no model answers, the run is stored without the AI words.

## Per person

- **Dismiss for me**: optimistic, rolled back with the reason if refused. Stored in `crms.ai_insight_decisions` with the
  person's name and sent to the Audit Logs (`ai_insight.dismissed`). The card comes back for that person when one of its
  numbers gets worse.
- **Was this useful?**: optimistic too. One answer per person, card and run, in `crms.ai_insight_feedback`.

`POST /api/dashboard/ai-insights` takes `{ action: "dismiss" | "feedback", days, key, helpful? }` with header
`x-creoms-ai-insight: 1`. `GET /api/dashboard/ai-insights/evidence?days=&key=` reads the records.
`GET /api/dashboard/ai-insights/pdf?days=` exports the stored run with the shared PDF template. Nothing polls.

## The map

Province shading for the whole country (`lib/geo/ph-provinces.json`), as before. On top:

- Zoom with the wheel, by dragging, by pinching, or with the +/− and reset buttons, and switch between "Metro Manila" (the
  default) and "Philippines".
- Zoomed in, the city outlines of Metro Manila, Bulacan, Rizal, Cavite and Laguna appear, with a bubble per city sized by the
  chosen layer.
- Layers: Orders, Late or failed, Returns & damage, Complaints (Tickets about the area's Orders) and Free-delivery reach.
  Rates need 3 or more.
- Figures are aggregated to city; no customer, street or barangay is shown.

`lib/geo/ph-cities.json` is built by `scripts/build-ph-cities.mjs` from the `municities-provdist-*.0.001.json` files of
[faeldon/philippines-json-maps](https://github.com/faeldon/philippines-json-maps) (MIT, PSA/NAMRIA boundaries), in the same
projection as the Province map; the script lists the files. `lib/geo/ph-provinces.json` comes from `scripts/build-ph-map.mjs`.

## Migrations

`docs/db/crms-ai-insights.sql` (decisions) and `docs/db/crms-ai-insights-runs.sql` (runs and feedback), both additive and safe
to rerun, as `creoms_writer`:

```
node --env-file=.env scripts/deploy/migrate-ai-insights.mjs
node --env-file=.env scripts/deploy/migrate-ai-insights-runs.mjs
```

`crms.ai_insight_notes` from the first version is no longer used. It is left in place; dropping it needs the owner's approval.
