import type postgres from "postgres";

import { loadFreeDeliveryThreshold } from "@/features/management/free-delivery-threshold";

/** What the Order itself says about free delivery, as saved when it was placed (#579). Null columns mean nothing was saved. */
export interface SavedFreeDelivery { applied: boolean | null; thresholdInCentavos: number | null }

export type FreeDeliveryRule = { qualifies: boolean; thresholdInCentavos: number | null };

/**
 * The saved Order rule decides, never the current threshold. Only an Order placed before the rule was saved is
 * judged now, once, against the current threshold, with the subtotal after discounts strictly over it.
 */
export async function freeDeliveryRule(sql: postgres.Sql, saved: SavedFreeDelivery, subtotalAfterDiscountsInCentavos: number): Promise<FreeDeliveryRule> {
  if (saved.applied !== null) return { qualifies: saved.applied, thresholdInCentavos: saved.thresholdInCentavos };
  const threshold = await loadFreeDeliveryThreshold(sql).catch(() => null);
  return { qualifies: threshold !== null && subtotalAfterDiscountsInCentavos > threshold, thresholdInCentavos: threshold };
}

/** A plain reason when the fee Staff entered breaks the rule, otherwise null. ₱0 by hand is always allowed. */
export function feeRefusal(rule: FreeDeliveryRule, feeInCentavos: number): string | null {
  if (rule.qualifies && feeInCentavos !== 0) return "This Order qualifies for free delivery, so the Delivery fee is locked at ₱0.00. Confirm it with no fee.";
  return null;
}
