# Cash on Delivery flags (#351)

`loadCodFlags(orderId)` (Orders Module) lists which plain rules fired for a Cash on Delivery Order, and logs each one once as `cod_flag.raised` (stable key per Order and rule). `loadCodFlagsForOrders(ids)` returns the same for a page of Orders without logging. Rules fire independently: first order; first order over the amount; a phone (digits only, across accounts) that refused an earlier Order ("Refused to pay COD" or "Refused the item"); any earlier failed delivery for that Customer or phone. Only earlier Orders count. There is no score or percentage; nothing is blocked; Customers have no endpoint that returns flags. Prepaid Orders have no entry.

The amount is an Admin setting in `crms.cod_settings` (default ₱1,500), changed with `setCodAmount` or `POST /api/cod/amount` (`{}` reads, `{amountInCentavos}` changes; Admin only; same Portal Settings handle as the Approval limit). Each change logs `cod_amount.changed` with the previous amount and the Admin's name.

Rollout: run `docs/db/crms-cod-settings.sql` as `creoms_writer` (additive; production needs the owner's approval for the exact command). The storefront's `customers.contact_number` and `failed_deliveries` are read through the existing read-only role. No screen here; the Portal's automatic-checks form and the Orders UI call these.
