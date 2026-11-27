import type { OrdersFigure } from "./figures";

/** What each count includes, worded the same on the Summary and its PDF. */
export const BUYERS_CARD_NOTE = "Last six months · Orders counted in Sales · new = first-time Buyer";
export const STAGES_NOTE = "As of today · all verified Customers · counts every Order not cancelled, paid or not";
export const PAYMENT_NOTE = "Orders counted in Sales";
/** Stage "New" means no Orders, unlike a new Buyer, so the Summary spells it out. */
export const NO_ORDERS_STAGE_LABEL = "No Orders yet";

export const buyersCounted = (buyers: number) =>
  `${buyers} ${buyers === 1 ? "Buyer" : "Buyers"} with Orders counted in Sales`;

/** None when no Orders were placed. */
export function ordersNote({ placed, counted }: OrdersFigure): string | null {
  if (placed === 0) return null;

  return counted === placed ? "All counted in Sales" : `${counted} counted in Sales · ${placed - counted} not counted yet`;
}
