import postgres from "postgres";

/**
 * A Replacement Order is a ₱0 Order the storefront links to the original (`replacement_for_order_id`).
 * It never counts toward Total spent, order count, Stage, Buyers or Sales. Read through to_jsonb so CREOMS keeps
 * working before the storefront has added the column.
 */
export function notReplacement(sql: postgres.Sql, alias: string) {
  return sql`to_jsonb(${sql(alias)})->>'replacement_for_order_id' is null`;
}
