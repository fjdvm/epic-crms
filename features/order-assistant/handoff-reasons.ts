import { PILL } from "@/features/tickets/pill";

/** How a stored handoff reason shows in the "Why handed off" column. Unknown codes fall back to their words. */
const REASONS: Record<string, { label: string; note: string; tone: string }> = {
  damaged_item: { label: "Damaged item", note: "needs replacement", tone: PILL.red },
  wrong_item: { label: "Wrong item", note: "needs a person", tone: PILL.red },
  spoiled_item: { label: "Spoiled item", note: "needs a person", tone: PILL.red },
  food_safety: { label: "Food safety", note: "always a person", tone: PILL.red },
  refund: { label: "Refund", note: "not allowed to answer", tone: PILL.grey },
  discount: { label: "Pricing", note: "not allowed to answer", tone: PILL.grey },
  replacement: { label: "Replacement", note: "not allowed to answer", tone: PILL.grey },
  person_requested: { label: "Customer asked", note: "", tone: PILL.grey },
  upset: { label: "Customer upset", note: "needs a person", tone: PILL.amber },
  out_of_scope: { label: "Outside what it answers", note: "", tone: PILL.grey },
  fact_check_failed: { label: "Answer failed a check", note: "", tone: PILL.amber },
  no_matching_order: { label: "No matching Order", note: "", tone: PILL.amber },
  order_with_rider: { label: "Order already with rider", note: "", tone: PILL.amber },
};

export function handoffReason(code: string) {
  const known = REASONS[code];
  if (known) return known;
  const words = code.replaceAll("_", " ");
  return {
    label: words.charAt(0).toUpperCase() + words.slice(1),
    note: "",
    tone: PILL.grey,
  };
}

/** "12 min", "1 h", "2 d": how long a handed-off Ticket has waited. */
export function waitingFor(since: Date, now: Date) {
  const minutes = Math.max(0, Math.floor((+now - +since) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}
