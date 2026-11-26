# Online sales feed for the POS

The POS reads CREOMS's online storefront Sales from one read-only endpoint. The figures follow the **Sales** rule in
`CONTEXT.md` (paid or fulfilled Orders placed in the days asked for, less Refunded Returns, never a Replacement Order),
so they match the CREOMS Dashboard for the same days.

## Request

```
GET https://<creoms-host>/api/internal/pos-sales?from=2026-11-01&to=2026-11-30
Authorization: Bearer <token>
```

- `from` and `to` are Philippine calendar dates (`YYYY-MM-DD`), both included, `from` on or before `to`, at most 366 days.
  Days still to come are allowed and simply hold no Orders.
- `<token>` is an HS256 JWT signed with `POS_CREOMS_SECRET` (the same value is set on CREOMS and on the POS), with claims
  `iss: "pos"`, `aud: "creoms-sales"`, `scope: "sales:read"`, and integer `iat`/`exp` at most 15 minutes apart. Mint a fresh
  one per request. CREOMS also accepts `POS_CREOMS_SECRET_PREVIOUS` while the secret rotates.

## Response

All money is integer centavos (divide by 100 for pesos).

```json
{
  "from": "2026-11-01", "to": "2026-11-30", "timeZone": "Asia/Manila", "currency": "PHP",
  "sales": 1234500,
  "orders": 87,
  "products": [
    { "imsProductId": 22, "productName": "Ube Halaya Smooth", "sizeLabel": "500g", "unitsSold": 40, "sales": 1596000 }
  ],
  "otherSales": 52000
}
```

- `sales`: overall online Sales. `orders`: the Orders counted in it.
- `products`: one row per product and Size, most money first. Refunded items reduce both `unitsSold` and `sales`.
  `imsProductId` is the IMS product of the Size, or `null` when CREOMS cannot tell which Size the line was.
- `otherSales`: delivery fees and refund adjustments, so the products' `sales` plus `otherSales` equal `sales`.

| Status | Meaning |
|---|---|
| 200 | The figures above. Sent with `Cache-Control: no-store`. |
| 400 | `{ "error": … }`: the dates are missing or wrong. |
| 401 | Missing, wrongly signed, expired or other-purpose token, or the secret is not set on CREOMS. |
| 503 | `{ "error": "sales unavailable" }`: the shop database could not be read; try again on the next user action. |

Fetch on a user action or page load, never on a timer (no polling, ADR-0005 in the Portal repo).

## Signing the token (Node)

```ts
import { createHmac } from "node:crypto";

export function creomsSalesToken(secret = process.env.POS_CREOMS_SECRET!): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: "pos", aud: "creoms-sales", scope: "sales:read", iat, exp: iat + 300 })}`;
  return `${input}.${createHmac("sha256", secret).update(input).digest("base64url")}`;
}

const response = await fetch(`${process.env.CREOMS_URL}/api/internal/pos-sales?from=2026-11-01&to=2026-11-30`, {
  headers: { Authorization: `Bearer ${creomsSalesToken()}` }, cache: "no-store",
});
```

Call it from the POS server only; the secret must never reach a browser. Who in the POS may see these figures is the
POS's decision (for example, the same Module as its own Sales Reports).

Code: `app/api/internal/pos-sales/route.ts`, `features/pos-sales/sales.ts`, `lib/pos-credential.ts`.
