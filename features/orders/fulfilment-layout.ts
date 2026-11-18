/** Board wording: Staff, Customers and emails say Out for delivery and Picked up, though stored statuses keep their names. */
const STATUS_WORDS: Record<string, string> = {
  dispatched: "Out for delivery",
  "ready for pickup": "Ready for pickup",
  collected: "Picked up",
};

export function boardStatusLabel(status: string): string {
  return STATUS_WORDS[status] ?? (status.charAt(0).toUpperCase() + status.slice(1));
}

/** The Figma "What each move triggers" card, saying only what the storefront really does. */
export const RULES: { move: string; effect: string }[] = [
  { move: "To pack → Preparing", effect: "Staff with the Orders Module can still cancel it until it is dispatched" },
  { move: "Preparing → Out for delivery", effect: "No courier or tracking number; it can no longer be cancelled" },
  { move: "Out for delivery → Delivered", effect: "The Customer is emailed; Feedback request 2 days later" },
];
