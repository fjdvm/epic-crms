# AI Insights

`/dashboard/ai-insights`, under OVERVIEW. Manager-level Roles (CREOMS Manager, General Manager, CEO, VP) act on it; Admin
views it; Staff are sent back to the Summary. Nothing on the page changes the shop.

## What it shows

From top to bottom, for the chosen period (Today · 7 days · This month · Last month · 90 days):

1. **Suggestions**: up to six, from the last 30 days whatever the period, worked out by fixed rules in
   `features/ai-insights/suggestions.ts`. The rules and thresholds are fixed in code, with no setting, as the "AI features
   have fixed defaults" rule in AGENTS.md requires.
2. **Unusual activity**: unchanged (`docs/unusual-activity.md`).
3. **Where our Orders go**: a map of the Philippines shaded by Province, for Orders counted in Sales that have a delivery
   address. It can show Orders, Sales, Failed deliveries %, Returns % or Cash on Delivery share; a rate needs 3 or more
   Orders. Clicking an area shows its figures and top cities. Nothing finer than a city is shown.
4. **Tabs**:
   - **Orders**: how far Orders got (placed, paid, sent out, delivered, with half-within times), busiest weekday and hour,
     cancellation and failed-delivery reasons, products often bought together.
   - **Payments**: method mix against the period before, time from the first proof to Paid (weekdays and weekends),
     proofs asked again and references used on another Order, Orders waiting for payment right now by age, refunds, and
     Orders that paid a Delivery fee within 20% of free delivery.
   - **Customers**: stages, loyal Customers gone quiet, repeat rate, days between Orders, Senior/PWD share, lifetime spend,
     top 10 Customers.
   - **Stock, delivery & service**: Sizes likely to run out within 5 days at the last 14 days' sales (read-only from
     `crms.stock_count`, which only the IMS writes), courier results, returns by product and inspected value, Tickets and
     Feedback.

Each section shows only to people who hold its Module, streams in its own Suspense boundary with a skeleton, and reads
through the five-minute analytics cache. Nothing polls.

## Suggestion rules

| Key | When | Opens |
|---|---|---|
| `area-failed:<area>` | an area with 5+ Orders and 15%+ of them with a failed delivery | Fulfilment |
| `area-rising:<area>` | an area's Orders up 30%+ from at least 3 | Orders |
| `loyal-at-risk` | 3+ At risk or Lost Customers who bought 3+ times | Customers, At risk |
| `slow-proofs-weekend` / `slow-proofs` | 5+ Orders paid; weekend proofs wait 2× weekday ones (and 3h+), or half wait 6h+ | Payments |
| `unpaid-over-3-days` | 3+ online-payment Orders unpaid for over 3 days | Payments |
| `near-free-delivery` | 10+ Orders paid a Delivery fee below the threshold, 25%+ of them within 20% of it | Commerce Settings (Managers only) |
| `bundle:<a>:<b>` | the top pair bought together in 5+ Orders, 30%+ of the less popular one's Orders | Products & Stocks |
| `stock:<size>` | a Size that runs out within 5 days at the last 14 days' sales (3 at most) | Products & Stocks |
| `returns:<product>` | 3+ units of a product returned, 10%+ of those sold | Returns |
| `low-rating:<product>` | a product averaging 3.5 stars or less from 3+ ratings | Feedback |
| `courier:<courier>` | 5+ Orders sent with a courier, 15%+ with a failed delivery | Fulfilment |

A suggestion's numbers are whole numbers that grow when things get worse. **Dismiss** (optimistic, rolled back with the
reason if refused) hides it for that person until a number grows. The action button records **accepted**, then opens the
screen; it waits for the server, since it is a Manager decision. Both are checked against freshly computed figures,
stored in `crms.ai_insight_decisions` with the person's name, and sent to the Audit Logs (`ai_insight.accepted` /
`ai_insight.dismissed`). Admin sees plain links and no Dismiss.

## The AI part

One sentence, "why it matters", per suggestion. The rules decide; the AI only words it.

- Asked for when a Manager-level person opens the page and a suggestion has no kept sentence. Admin and Staff never
  cause a model call, and nothing runs on a timer.
- The model gets only the suggestion's own sentence (masked) and its numbers: province, product and courier names, never
  a Customer.
- A sentence quoting a number that is not in the suggestion, or a link, is thrown away.
- One sentence is kept per suggestion in `crms.ai_insight_notes`, with the model, the exact text sent and the system
  prompt. It is made again only when the suggestion's numbers change.
- It is labelled "AI-written, check before acting". If no model is configured or the call fails, the card shows without it.

## Migration

`docs/db/crms-ai-insights.sql`, additive and safe to rerun, as `creoms_writer`:

```
node --env-file=.env scripts/deploy/migrate-ai-insights.mjs
```

## Map data

`lib/geo/ph-provinces.json` is built by `scripts/build-ph-map.mjs` from the low-resolution
`latest/geojson/regions/lowres/provdists-region-*.0.001.json` files of
[faeldon/philippines-json-maps](https://github.com/faeldon/philippines-json-maps) (MIT, PSA/NAMRIA boundaries). The
boundaries follow the 2023 PSGC while `lib/psgc` is older, so NCR's districts join as Metro Manila and Maguindanao del
Norte and del Sur join as Maguindanao. `tests/ai-insights-areas.test.ts` checks every Province of the address picker has
a shape.
