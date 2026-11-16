import type postgres from "postgres";

/** The first reply target and the resolve target, in hours. Every hour counts, whatever the Priority. */
export interface ServiceTargets {
  firstReplyHours: number;
  resolveHours: number;
}

export const DEFAULT_TARGETS: ServiceTargets = { firstReplyHours: 24, resolveHours: 72 };

/** One saved pair and the moment it came into force. Oldest first. */
export type TargetHistory = { effectiveFrom: Date; firstReplyHours: number; resolveHours: number }[];

export const DEFAULT_HISTORY: TargetHistory = [{ effectiveFrom: new Date(0), ...DEFAULT_TARGETS }];

export const MAX_TARGET_HOURS = 8760;

/** Under this much time left, a running target is "Breaching soon". */
export const BREACHING_SOON_SECONDS = 60 * 60;

/** The pair a Ticket opened at `createdAt` takes and keeps. */
export function targetsAt(history: TargetHistory, createdAt: Date): ServiceTargets {
  let found: ServiceTargets | undefined;

  for (const entry of history) if (entry.effectiveFrom <= createdAt) found = entry;

  return found ?? history[0] ?? DEFAULT_TARGETS;
}

/**
 * SQL for the first reply target, in hours, of the Ticket `t`: the pair in force when it was opened.
 * The Tickets list and the Dashboard's Needs attention both build Overdue from this one fragment, so
 * their counts cannot drift apart.
 */
export function firstReplyHoursSql(sql: postgres.Sql, history: TargetHistory) {
  const rows = history.map((h) => ({ from: h.effectiveFrom.toISOString(), hours: h.firstReplyHours }));

  return sql`coalesce((
    select (h.hours)::int from jsonb_to_recordset(${sql.json(rows)}) as h("from" timestamptz, hours int)
    where h."from" <= t.created_at order by h."from" desc limit 1
  ), ${DEFAULT_TARGETS.firstReplyHours})`;
}

export type ClockKind = "first_reply" | "resolve";

/**
 * What a Ticket's countdown shows.
 * - `running`: time is left; `breaching` when under an hour is left.
 * - `paused`: the clock is stopped (On hold, or waiting on the Customer), with the time left kept.
 * - `met`: the target was reached in time. `missed`: it was not, now or when it ended; this never clears.
 * - `done`: nothing to count any more (Completed without ever being Resolved by Staff).
 */
export type ClockState = "running" | "breaching" | "paused" | "met" | "missed" | "done";

export interface Clock {
  kind: ClockKind;
  state: ClockState;
  targetHours: number;
  /** Seconds left, negative once missed; null when `done`. */
  remainingSeconds: number | null;
  /** Why it is paused. */
  pausedFor?: "hold" | "customer";
}

export interface ServiceLevel {
  targets: ServiceTargets;
  firstReply: Clock;
  resolve: Clock;
  /** What the list and the panel lead with: the first reply until Staff reply, the resolve target after. */
  current: Clock;
}

export interface ClockInput {
  status: "open" | "on_hold" | "resolved" | "completed";
  createdAt: Date;
  /** When Staff last marked it Resolved. */
  resolvedAt: Date | null;
  /** Seconds spent in holds that have ended, and when the current hold began. */
  heldSeconds: number;
  holdStartedAt: Date | null;
  /** Oldest first. */
  messages: { sender: "customer" | "staff"; at: Date }[];
  /** Missed targets already stamped; a stamp is never cleared. */
  stamped?: { firstReply?: boolean; resolve?: boolean };
}

const seconds = (from: Date, to: Date) => Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));

/**
 * The Service level clock. A Ticket's clock runs from when it was opened and stops while it is On
 * hold or waiting on the Customer (the last Message came from Staff). Every hour counts.
 * Time On hold comes from the Ticket itself (a database trigger keeps it); time waiting on the
 * Customer comes from the Messages. The first reply is judged on the hold time up to that reply
 * (all of it, if the hold ended after); the resolve target ends when Staff mark it Resolved.
 */
export function serviceLevel(input: ClockInput, targets: ServiceTargets, now: Date): ServiceLevel {
  const { createdAt, messages } = input;
  const firstStaff = messages.find((m) => m.sender === "staff");

  const heldAt = (until: Date) => {
    const running = input.holdStartedAt ? seconds(input.holdStartedAt, until) : 0;

    return Math.min(seconds(createdAt, until), input.heldSeconds + running);
  };

  /** Seconds waiting on the Customer, up to `until`: from a Staff Message to the Customer's next one. */
  const waitingAt = (until: Date) => {
    let total = 0;
    let since: Date | null = null;

    for (const m of messages) {
      if (m.at >= until) break;
      if (m.sender === "staff" && since === null) since = m.at;
      if (m.sender === "customer" && since !== null) {
        total += seconds(since, m.at);
        since = null;
      }
    }

    return since === null ? total : total + seconds(since, until);
  };

  const lastSender = messages.at(-1)?.sender ?? "customer";
  const waitingNow = input.status === "open" && lastSender === "staff";
  const holdNow = input.status === "on_hold";

  const clock = (
    kind: ClockKind,
    targetHours: number,
    end: Date | null,
    worked: (until: Date) => number,
    stamped: boolean,
  ): Clock => {
    const target = targetHours * 3600;

    if (end) {
      const remaining = target - worked(end);

      return { kind, targetHours, state: stamped || remaining < 0 ? "missed" : "met", remainingSeconds: remaining };
    }

    const remaining = target - worked(now);
    const paused = holdNow ? "hold" : kind === "resolve" && waitingNow ? "customer" : undefined;

    if (stamped || remaining < 0) return { kind, targetHours, state: "missed", remainingSeconds: remaining };
    if (paused) return { kind, targetHours, state: "paused", remainingSeconds: remaining, pausedFor: paused };

    return {
      kind,
      targetHours,
      state: remaining < BREACHING_SOON_SECONDS ? "breaching" : "running",
      remainingSeconds: remaining,
    };
  };

  const firstReply = clock(
    "first_reply",
    targets.firstReplyHours,
    firstStaff?.at ?? null,
    (until) => seconds(createdAt, until) - heldAt(until),
    input.stamped?.firstReply ?? false,
  );

  const finished = input.status === "resolved" || input.status === "completed";
  const resolveEnd = finished ? input.resolvedAt : null;
  const resolve: Clock =
    finished && !input.resolvedAt
      ? { kind: "resolve", targetHours: targets.resolveHours, state: "done", remainingSeconds: null }
      : clock(
          "resolve",
          targets.resolveHours,
          resolveEnd,
          (until) => seconds(createdAt, until) - heldAt(until) - waitingAt(until),
          input.stamped?.resolve ?? false,
        );

  return { targets, firstReply, resolve, current: firstStaff ? resolve : firstReply };
}

/** "2h 15m left", "Breaching soon", "Missed", "Paused" - the words the list and the panel show. */
export function describeClock(clock: Clock): string {
  switch (clock.state) {
    case "missed":
      return "Missed";
    case "met":
      return "Met";
    case "done":
      return "No target";
    case "breaching":
      return "Breaching soon";
    default: {
      const left = formatLeft(clock.remainingSeconds ?? 0);

      return clock.state === "paused" ? `Paused · ${left} left` : `${left} left`;
    }
  }
}

export function formatLeft(secondsLeft: number): string {
  const minutes = Math.max(0, Math.floor(secondsLeft / 60));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;

  return `${minutes}m`;
}

/** The clock text for a target length, such as "24 hours" or "3 days". */
export function describeTarget(hours: number): string {
  return hours >= 72 && hours % 24 === 0 ? `${hours / 24} days` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}
