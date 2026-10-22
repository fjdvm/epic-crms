import { orderLabel } from "@/features/customer-profiles/rules";
import { PILL, Pill } from "@/features/tickets/pill";

import type { PaymentLabel } from "./orders";

const STATUS_PILLS: Record<string, string> = {
  placed: PILL.amber,
  confirmed: PILL.blue,
  "awaiting payment": PILL.amber,
  paid: PILL.green,
  preparing: PILL.purple,
  dispatched: PILL.blue,
  delivered: PILL.green,
  cancelled: PILL.grey,
};

const PAYMENT_PILLS: Record<PaymentLabel, string> = {
  Paid: PILL.green,
  Unpaid: PILL.amber,
  Cancelled: PILL.grey,
};

export function StatusPill({ status }: { status: string }) {
  return <Pill className={STATUS_PILLS[status] ?? PILL.grey}>{orderLabel(status)}</Pill>;
}

export function PaymentPill({ label }: { label: PaymentLabel }) {
  return <Pill className={PAYMENT_PILLS[label]}>{label}</Pill>;
}
