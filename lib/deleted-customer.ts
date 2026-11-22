/** What every CREOMS screen shows in place of a Deleted Customer's name: no contact details, no profile. */
export const DELETED_CUSTOMER_LABEL = "Deleted customer";

/**
 * SQL for a Customer's display name that turns into the "Deleted customer" tag once the storefront
 * has soft-deleted them. Read through to_jsonb so CREOMS keeps working before the storefront has
 * added the `deleted_at` column.
 */
export function customerNameSql(alias: string, column = "full_name"): string {
  return `case when to_jsonb(${alias})->>'deleted_at' is null then ${alias}.${column} else '${DELETED_CUSTOMER_LABEL}' end`;
}
