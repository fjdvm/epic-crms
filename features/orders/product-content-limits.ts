/** Shared by the drawer (browser) and the save (server), so it stays free of server-only imports. */
export const MAX_DESCRIPTION = 2000;
/** The longest shop name CREOMS keeps for a product; the IMS name is used when it has none. */
export const MAX_NAME = 120;
/** The highest shop price a Manager can set, in pesos. */
export const MAX_PRICE = 1_000_000;

/** A shop price in pesos from what was typed: positive, at most two decimals, at most `MAX_PRICE`. Null when it is not one. */
export function parsePrice(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.replace(/,/g, "").trim() : "";
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) return null;
  const price = Number(text);
  return price > 0 && price <= MAX_PRICE ? price : null;
}
