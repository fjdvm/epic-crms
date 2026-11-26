import type { PaymentTab } from "./payments";

export const TABS: { key: PaymentTab; label: string; empty: string }[] = [
  { key: "verify", label: "For verification", empty: "No GCash Orders are waiting for a payment check." },
  { key: "anomalies", label: "Anomalies", empty: "No payment proofs look wrong. Anything the reader flags appears here." },
  { key: "review", label: "Manager review", empty: "No payments are waiting for a Manager review." },
  { key: "cod", label: "COD to collect", empty: "No Cash on Delivery Orders are waiting to be delivered." },
  { key: "paid", label: "Paid", empty: "No payments in the last 30 days." },
  { key: "rejected", label: "Rejected", empty: "No cancelled GCash Orders in the last 30 days." },
];

/**
 * The Figma queue's columns. Header and rows share one grid template, so they always line up; the `fr`
 * tracks share out the card width, so the columns spread edge to edge.
 */
export const COLUMNS: { key: string; header: string; className: string; align?: "right" }[] = [
  { key: "details", header: "", className: "" },
  { key: "order", header: "Order", className: "" },
  { key: "customer", header: "Customer", className: "" },
  { key: "method", header: "Method", className: "" },
  { key: "reference", header: "Reference", className: "" },
  { key: "amount", header: "Amount due", className: "" },
  { key: "uploaded", header: "Uploaded", className: "" },
  { key: "action", header: "", className: "justify-end" },
];

export const GRID =
  "grid grid-cols-[36px_minmax(80px,1fr)_minmax(130px,2fr)_minmax(110px,1fr)_minmax(120px,1fr)_minmax(100px,1fr)_minmax(90px,1fr)_84px]";
export const HEAD = "flex min-w-0 items-start overflow-clip";
export const CELL = "flex min-w-0 items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

export const STEPS: { title: string; note: string }[] = [
  { title: "Customer pays", note: "GCash, outside the website" },
  { title: "Sends the proof", note: "A GCash reference number and, optionally, a screenshot" },
  { title: "Staff check it", note: "Amount, reference number, date and our account" },
  { title: "Mark paid", note: "The Order becomes paid and the Customer is told" },
  { title: "Or cancel", note: "The Order is cancelled; there is no asking for another receipt" },
];

