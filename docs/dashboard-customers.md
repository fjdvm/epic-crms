# Dashboard Customers figures

`loadDashboardFigures` returns `customersByStage`, `atRisk`, `newCustomers` and
`unverifiedLeads` only with the Customer Profiles Module. Each has an `ok` result;
a failure reading Stage does not prevent sign-ups or Leads from loading.

`customersByStage.counts` contains all five Stage keys, including zeros: `new`,
`first-order`, `repeat`, `at-risk`, `lost`. It uses the same Stage rules as Customer
Profiles: only non-cancelled Orders, with Lost at 120 days and At risk at 60 days
taking precedence over Order count. `atRisk.count` is the At risk Stage count,
excluding Lost, from the same read. Both use `now` and ignore the selected period.
Consumers should label them “As of today”.

`newCustomers` contains `current` and `previous` counts for the selected period
and its equal-length predecessor. Only verified Customers count, dated by auth
sign-up (`Customer since`), rather than verification. The spans are half-open
Philippine Time boundaries supplied by the period model.

`unverifiedLeads.count` counts unverified storefront profiles across all dates,
separately from every Customers count. Walk-in Customers have no storefront auth
identity and appear in none of these figures. CREOMS Walk-in storage is not read.

These figures share the existing five-minute analytics cache. Its key includes
the Philippine date, so a previous-day Stage snapshot is not reused after
midnight. Failed analytics are retried on the next read. This backend ticket adds
no Dashboard cards.
