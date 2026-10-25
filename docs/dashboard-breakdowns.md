# Dashboard breakdown figures

`loadDashboardFigures` returns `bestSellers`, `monthlyBuyers` and
`paymentAndReceiving` only with the Orders Module. Each has its own `ok` result;
a failed breakdown leaves the other figures available.

Money is in centavos and shares are fractions (0–1). Every breakdown uses Orders
counted in Sales (`paid`, `preparing`, `dispatched`, `delivered`, `received`),
dated by when the Order was placed. Walk-in Customers have no storefront Orders
and never count as Buyers.

Best sellers combine the stored product names across sizes, subtract Refunded
whole line items from money and units, and return up to four products ranked by
net money. Ties use product name. Replaced and unfinished Returns change neither
money nor units. The denominator of each share is the Sales figure, including
Delivery fees. `remainder` contains all Sales outside the top four product amounts:
other products and Delivery fees. Products plus remainder therefore reconcile to
Sales; Delivery fees are never presented as product sales. Shares are `null` when
Sales is zero. Fully Refunded products with no units left are omitted.

Monthly Buyers uses the last six Philippine calendar months, independent of the
period picker, and marks the current month `soFar`. A Buyer counts once per month,
as Returning if they had a counted Order before that month started. It returns
an empty months array when the entire six-month window has no Buyers; otherwise
months with no Buyers have zero counts and a `null` returning share.

Payment and receiving breakdowns group the Order's stored `payment_method` and
`fulfillment_method`. Each group includes the count of counted Orders and their
Sales after Refunded Return amounts, including Delivery fees. No Orders produces
empty arrays.

Dashboard analytics share a five-minute cache per database connection and period
(month window for Buyers), across Staff. Module checks happen before exposing results. Sales primes its
dependent aggregates together, even for Payments-only Staff, so later Orders
readers use the same amounts.
All entries expire at the same five-minute clock boundary, so nested readers
cannot extend stale data for another five minutes. The cache coalesces concurrent
reads, expires entries, caps retained entries at
100 per database connection, and never retains failed reads. It is local to the
server instance, so a cold instance reads afresh. Needs attention remains live.
Sales uses the same cached amount as the best-seller denominator, so cached
shares still reconcile when the storefront changes. Tiles and monthly Sales
also cache their analytics; this backend ticket adds no Dashboard cards.
