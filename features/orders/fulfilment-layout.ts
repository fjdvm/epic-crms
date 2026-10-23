import type { FulfilmentBoard } from "./fulfilment";

/** The Figma board's columns, named after the storefront's statuses rather than the design's. */
export const COLUMNS: { key: keyof FulfilmentBoard; title: string }[] = [
  { key: "ready", title: "Ready to prepare" },
  { key: "preparing", title: "Preparing" },
  { key: "dispatched", title: "Dispatched" },
  { key: "delivered", title: "Delivered (7 days)" },
];

/** The Figma "What each move triggers" card, saying only what the storefront really does. */
export const RULES: { move: string; effect: string }[] = [
  { move: "Ready to prepare → Preparing", effect: "Staff with the Orders Module can still cancel it until it is dispatched" },
  { move: "Preparing → Dispatched", effect: "No courier or tracking number; it can no longer be cancelled" },
  { move: "Dispatched → Delivered", effect: "The Customer is emailed; Feedback request 2 days later" },
];
