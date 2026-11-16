import { DEFAULT_TARGETS, serviceLevel } from "@/features/tickets/service-level";

/** A running countdown for a Ticket opened an hour before `now`, for view fixtures. */
export const someServiceLevel = (now = new Date("2026-10-20T12:00:00Z")) =>
  serviceLevel(
    { status: "open", createdAt: new Date(now.getTime() - 3600_000), resolvedAt: null, heldSeconds: 0, holdStartedAt: null, messages: [] },
    DEFAULT_TARGETS,
    now,
  );
