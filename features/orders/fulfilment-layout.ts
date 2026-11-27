/** Board wording: Staff, Customers and emails say Out for delivery, though stored statuses keep their names. */
const STATUS_WORDS: Record<string, string> = {
  dispatched: "Out for delivery",
};

export function boardStatusLabel(status: string): string {
  return STATUS_WORDS[status] ?? (status.charAt(0).toUpperCase() + status.slice(1));
}

/** The All active board, left to right; each is also a tab. */
export const BOARD_COLUMNS = [
  { key: "to-pack", label: "To pack" },
  { key: "preparing", label: "Preparing" },
  { key: "out-for-delivery", label: "Out for delivery" },
  { key: "failed", label: "Failed" },
  { key: "completed", label: "Completed" },
] as const;

/** Shared by the board and its loading skeleton, so nothing shifts when the Orders arrive. */
export const PAGE_FRAME = "flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-4 py-7 sm:px-8";
export const COLUMNS_FRAME = "grid min-h-0 flex-1 grid-cols-5 grid-rows-[minmax(0,1fr)] gap-2.5";
export const COLUMN_FRAME = "flex min-h-0 min-w-0 flex-col rounded-xl bg-[#efebf4] p-2 leading-[normal]";

/** The Figma "What each move triggers" card, saying only what the storefront really does. */
export const RULES: { move: string; effect: string }[] = [
  { move: "To pack → Preparing", effect: "Staff with the Orders Module can still cancel it until it is dispatched" },
  { move: "Preparing → Out for delivery", effect: "Needs the courier and its share link; it can no longer be cancelled" },
  { move: "Out for delivery → Delivered", effect: "The Customer is emailed; Feedback request 2 days later" },
];
