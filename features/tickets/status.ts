import { PILL } from "./pill";
import type { TicketStatus } from "./tickets";

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  on_hold: "On hold",
  resolved: "Resolved",
  completed: "Completed",
};

export const STATUS_PILLS: Record<TicketStatus, string> = {
  open: PILL.red,
  on_hold: PILL.amber,
  resolved: PILL.green,
  completed: PILL.green,
};
