import type { PaymentTab } from "./payments";

export const TABS: { key: PaymentTab; label: string; empty: string }[] = [
  { key: "verify", label: "For verification", empty: "No GCash Orders are waiting for a payment check." },
  { key: "cod", label: "COD to collect", empty: "No Cash on Delivery Orders are waiting to be delivered." },
  { key: "paid", label: "Paid", empty: "No payments in the last 30 days." },
  { key: "rejected", label: "Rejected", empty: "No cancelled GCash Orders in the last 30 days." },
];

/** The Figma queue's columns; they share the table width in proportion, so the rows fill the card. */
export const COLUMNS: { header: string; className: string }[] = [
  { header: "Receipt", className: "flex-[0_0_56px]" },
  { header: "Order", className: "flex-[1_1_80px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_130px]" },
  { header: "Method", className: "min-w-0 flex-[1_1_110px]" },
  { header: "Reference", className: "min-w-0 flex-[1_1_120px]" },
  { header: "Amount due", className: "flex-[1_1_100px]" },
  { header: "Uploaded", className: "flex-[1_1_90px]" },
  { header: "", className: "flex-[0_0_84px] justify-end" },
];

export const HEAD = "flex items-start overflow-clip";
export const CELL = "flex items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

export const STEPS: { title: string; note: string }[] = [
  { title: "Customer pays", note: "GCash, outside the website" },
  { title: "Sends the proof", note: "A GCash reference number and, optionally, a screenshot" },
  { title: "Staff check it", note: "Amount, reference number, date and our account" },
  { title: "Mark paid", note: "The Order becomes paid and the Customer is told" },
  { title: "Or cancel", note: "The Order is cancelled; there is no asking for another receipt" },
];

