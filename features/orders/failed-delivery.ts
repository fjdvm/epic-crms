/** The reasons Staff pick from, as designed in the Figma "Fulfilment · Failed delivery" frame. */
export const FAILED_REASONS = [
  "Customer not home",
  "Wrong or incomplete address",
  "Refused to pay COD",
  "Refused the item",
  "Damaged in transit",
] as const;

export type NextStep = "rebook" | "request-cancellation";

/** One failed attempt as the screen shows it; the storefront keeps these after rebooking. */
export interface FailedAttempt {
  id: string;
  orderId: number;
  reason: string;
  nextStep: NextStep;
  customerMessage: string;
  staffName: string;
  createdAt: string;
  disposition: "restock" | "write-off" | null;
  disposedAt: string | null;
  rebookedAt: string | null;
  courier: { name: string; trackingUrl: string } | null;
}

/** Plain rows from `loadFailedDeliveryHistory`, as strings the browser can take. */
export function toAttempts(rows: readonly Record<string, unknown>[]): FailedAttempt[] {
  const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
  return rows.map((r) => ({
    id: String(r.id), orderId: Number(r.order_id), reason: String(r.reason),
    nextStep: r.next_step === "request-cancellation" ? "request-cancellation" : "rebook",
    customerMessage: String(r.customer_message), staffName: String(r.staff_name),
    createdAt: iso(r.created_at) as string,
    disposition: r.disposition === "restock" || r.disposition === "write-off" ? r.disposition : null,
    disposedAt: iso(r.disposed_at), rebookedAt: iso(r.rebooked_at),
    courier: r.courier && typeof r.courier === "object" ? (r.courier as FailedAttempt["courier"]) : null,
  }));
}

/** The attempt still waiting on Staff: not rebooked, and its stock not yet handled. */
export function openAttempt(attempts: readonly FailedAttempt[], orderId: number): FailedAttempt | null {
  return [...attempts].reverse().find((a) => a.orderId === orderId && !a.rebookedAt) ?? null;
}

/** The message Staff start from; they can edit it before it is sent. */
export function defaultMessage(firstName: string, orderId: number, step: NextStep): string {
  const plan = step === "rebook"
    ? "We will arrange another delivery. Can you confirm your address and someone who will be home? Salamat!"
    : "We will not be re-sending it, so please reply if you would like to talk it through. Salamat!";
  return `Hi ${firstName}! Our courier tried to deliver Order #${orderId} but could not complete it. ${plan}`;
}

/** What the Customer's earlier attempts say, for the history card. */
export function historySummary(attempts: readonly FailedAttempt[], orderId: number) {
  const before = attempts.filter((a) => a.orderId !== orderId);
  return {
    failedBefore: before.length,
    refusedCod: attempts.filter((a) => a.reason === "Refused to pay COD").length,
    reasons: before.map((a) => a.reason),
    total: attempts.length,
  };
}
