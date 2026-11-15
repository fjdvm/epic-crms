import type postgres from "postgres";

/** The four plain rules. Each fires on its own; nothing is scored and nothing is blocked. */
export const COD_RULES = ["first-order", "first-order-over-amount", "refused-earlier-order", "earlier-failed-delivery"] as const;
export type CodRule = (typeof COD_RULES)[number];

export const COD_RULE_LABELS: Record<CodRule, string> = {
  "first-order": "First order",
  "first-order-over-amount": "First order over the set amount",
  "refused-earlier-order": "Phone refused an earlier Order",
  "earlier-failed-delivery": "Earlier failed delivery",
};

/** Centavos: the ₱1,500 starting point of the Admin setting. */
export const DEFAULT_COD_AMOUNT = 150_000;

/** Reasons Staff pick on the failed-delivery screen that mean the Customer refused. */
const REFUSED_REASONS = ["Refused to pay COD", "Refused the item"];

/** Orders without a Cash on Delivery payment have no entry. */
export type CodFlags = Map<number, CodRule[]>;

/** Flags for Cash on Delivery Orders among `orderIds`. A phone matches across accounts, by digits only. */
export async function codFlags(sql: postgres.Sql, orderIds: number[], amountInCentavos: number): Promise<CodFlags> {
  const flags: CodFlags = new Map();
  if (orderIds.length === 0) return flags;
  const rows = await sql<{ id: number; first_order: boolean; over: boolean; refused: boolean; failed: boolean }[]>`
    with target as (
      select o.id, o.customer_id, o.subtotal_in_centavos + coalesce(o.delivery_fee_in_centavos, 0) as total,
        nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(c.contact_number, ''), '[^0-9]', '', 'g'), '^63', '0'), '^9', '09'), '') as phone
      from public.orders o join public.customers c on c.id = o.customer_id
      where o.id in ${sql(orderIds)} and o.payment_method = 'cash-on-delivery'),
    earlier as (
      select t.id as target_id, f.reason
      from target t
      join public.failed_deliveries f on f.order_id <> t.id
      join public.orders fo on fo.id = f.order_id and fo.id < t.id
      join public.customers fc on fc.id = fo.customer_id
      where fo.customer_id = t.customer_id
        or (t.phone is not null and nullif(regexp_replace(regexp_replace(regexp_replace(coalesce(fc.contact_number, ''), '[^0-9]', '', 'g'), '^63', '0'), '^9', '09'), '') = t.phone))
    select t.id,
      not exists (select 1 from public.orders e where e.customer_id = t.customer_id and e.id < t.id) as first_order,
      t.total > ${amountInCentavos} and not exists (select 1 from public.orders e where e.customer_id = t.customer_id and e.id < t.id) as over,
      exists (select 1 from earlier x where x.target_id = t.id and x.reason in ${sql(REFUSED_REASONS)}) as refused,
      exists (select 1 from earlier x where x.target_id = t.id) as failed
    from target t`;
  for (const row of rows) {
    const rules: CodRule[] = [];
    if (row.first_order) rules.push("first-order");
    if (row.over) rules.push("first-order-over-amount");
    if (row.refused) rules.push("refused-earlier-order");
    if (row.failed) rules.push("earlier-failed-delivery");
    flags.set(row.id, rules);
  }
  return flags;
}

/** The Admin setting, in centavos; the ₱1,500 default until an Admin changes it. */
export async function codAmountSetting(sql: postgres.Sql): Promise<number> {
  const [row] = await sql<{ amount: string }[]>`select first_order_amount_in_centavos::text as amount from crms.cod_settings where singleton`;
  return row ? Number(row.amount) : DEFAULT_COD_AMOUNT;
}
