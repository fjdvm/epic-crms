/** Order statuses whose totals count toward a Customer's Total spent. */
export const PAID_OR_FULFILLED = ["paid", "preparing", "dispatched", "delivered"];

export interface OrderAmounts {
  status: string;
  subtotalInCentavos: number;
  deliveryFeeInCentavos: number | null;
}

/** Total spent, in centavos: subtotal plus delivery fee of paid or fulfilled Orders. */
export function totalSpent(orders: OrderAmounts[]): number {
  return orders
    .filter((o) => PAID_OR_FULFILLED.includes(o.status))
    .reduce((sum, o) => sum + o.subtotalInCentavos + (o.deliveryFeeInCentavos ?? 0), 0);
}

/** A Customer is a person whose auth user has a verified email; everyone else is a Lead. */
export function isCustomer(authUser: { emailVerified: boolean } | null): boolean {
  return authUser?.emailVerified === true;
}
