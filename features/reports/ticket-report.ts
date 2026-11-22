import type postgres from "postgres";

import { loadTargetHistory } from "@/features/tickets/service-level-store";
import { serviceLevel, targetsAt, type ServiceLevel, type ServiceTargets } from "@/features/tickets/service-level";
import { shopRole } from "@/lib/portal/roles";

import { resolvePeriod, type Period, type PeriodPreset } from "@/features/dashboard/period";

/** Ticket reports use whole Philippine days; the default is the last 30 days. */
export const TICKET_REPORT_PRESETS = ["30-days", "7-days", "this-month", "last-month", "90-days"] as const;
export type TicketReportPreset = (typeof TICKET_REPORT_PRESETS)[number];
export const TICKET_REPORT_DEFAULT: TicketReportPreset = "30-days";

export const TICKET_REPORT_LABELS: Record<TicketReportPreset, string> = {
  "30-days": "30 days",
  "7-days": "7 days",
  "this-month": "This month",
  "last-month": "Last month",
  "90-days": "90 days",
};

export function parseReportPreset(raw: string | string[] | undefined): TicketReportPreset {
  const value = Array.isArray(raw) ? raw[0] : raw;

  return TICKET_REPORT_PRESETS.find((p) => p === value) ?? TICKET_REPORT_DEFAULT;
}

/** The period, in whole Philippine days ending today (Philippine Time). */
export function resolveReportPeriod(preset: TicketReportPreset, now: Date): Pick<Period, "start" | "end"> {
  if (preset !== "30-days") return resolvePeriod(preset as PeriodPreset, now);

  const ninety = resolvePeriod("90-days", now);

  return { start: new Date(ninety.end.getTime() - 30 * 86_400_000), end: ninety.end };
}

export interface StaffLoad {
  id: string;
  name: string;
  /** Claimed Tickets that are Open or On hold right now. */
  open: number;
  /** Tickets they hold that were marked Resolved in the period. */
  resolved: number;
  averageRating: number | null;
  rated: number;
}

export interface LowRating {
  ticketId: number;
  subject: string;
  customerName: string;
  rating: number;
  comment: string | null;
  ratedAt: Date;
}

export interface TicketReport {
  targets: ServiceTargets;
  /** Median seconds of working time (On hold and waiting on the Customer excluded) to the first Staff reply, for Tickets opened in the period. */
  firstReplyMedian: number | null;
  /** Median seconds of working time to Resolved, for Tickets marked Resolved in the period. */
  resolveMedian: number | null;
  /** Share of judged Tickets opened in the period that missed neither target, 0 to 1. */
  metShare: number | null;
  judged: number;
  /** Tickets resolved in the period that came back (reopened, or followed by a Follow-up Ticket), over all Resolved in it. */
  reopenRate: number | null;
  reopened: number;
  resolvedCount: number;
  averageRating: number | null;
  rated: number;
  /** Escalations raised in the period. */
  escalated: number;
  categories: { category: string; count: number }[];
  staff: StaffLoad[];
  lowest: LowRating[];
}

export type TicketReportResult = { ok: true; report: TicketReport } | { ok: false; reason: "forbidden" | "unavailable" };

/** Managers work the reports; Admin and CEO only view; Staff and unknown Roles never open them. */
export function mayReadTicketReport(role: string): boolean {
  const shop = shopRole(role);

  return shop === "manager" || shop === "admin" || shop === "ceo";
}

export const LOWEST_RATINGS_SHOWN = 10;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

/** Working seconds a finished clock used: its target less what was left. */
const worked = (clock: ServiceLevel["firstReply"]) => Math.max(0, clock.targetHours * 3600 - (clock.remainingSeconds ?? 0));

interface TicketRow {
  id: number; status: "open" | "on_hold" | "resolved" | "completed"; category: string;
  created_at: Date; resolved_at: Date | null; held_seconds: number; hold_started_at: Date | null;
  claimed_by_id: string | null; claimed_by_name: string | null; has_follow_up: boolean;
}

/**
 * Ticket figures for a Philippine-Time period. Read only. Times come from the same Service level clock the
 * Tickets list uses, so On hold and waiting-on-Customer time never counts; Internal notes are never replies.
 * A missed target stays missed once stamped, so the share meeting the Service level is honest.
 */
export async function loadTicketReport(
  deps: { tickets: postgres.Sql; crms: postgres.Sql },
  { role, period, now = new Date() }: { role: string; period: Pick<Period, "start" | "end">; now?: Date },
): Promise<TicketReportResult> {
  if (!mayReadTicketReport(role)) return { ok: false, reason: "forbidden" };

  try {
    const { tickets: sql, crms } = deps;
    const { start, end } = period;

    const history = await loadTargetHistory(crms);
    const rows = await sql<TicketRow[]>`
      select t.id, t.status, t.category, t.created_at, t.resolved_at, t.held_seconds, t.hold_started_at,
        t.claimed_by_id, t.claimed_by_name,
        exists (select 1 from tickets f where f.follow_up_of_id = t.id) as has_follow_up
      from tickets t
      where (t.created_at >= ${start} and t.created_at < ${end})
        or (t.resolved_at >= ${start} and t.resolved_at < ${end})`;

    const ids = rows.map((r) => r.id);
    const messages = ids.length
      ? await sql<{ ticket_id: number; sender: "customer" | "staff"; created_at: Date }[]>`
          select ticket_id, sender, created_at from ticket_messages
          where ticket_id = any(${ids}::int[]) and not internal order by ticket_id, created_at, id`
      : [];
    const byTicket = new Map<number, { sender: "customer" | "staff"; at: Date }[]>();
    for (const m of messages) (byTicket.get(m.ticket_id) ?? byTicket.set(m.ticket_id, []).get(m.ticket_id)!).push({ sender: m.sender, at: m.created_at });

    const stamps = ids.length
      ? await crms<{ ticket_id: number; kind: string }[]>`
          select ticket_id, kind from crms.ticket_service_misses where ticket_id = any(${ids}::int[])`
      : [];
    const stamped = new Map<number, { firstReply?: boolean; resolve?: boolean }>();
    for (const s of stamps) {
      const entry = stamped.get(s.ticket_id) ?? {};
      if (s.kind === "first_reply") entry.firstReply = true;
      else entry.resolve = true;
      stamped.set(s.ticket_id, entry);
    }

    const inPeriod = (d: Date | null) => d !== null && d >= start && d < end;
    const firstReplies: number[] = [];
    const resolves: number[] = [];
    let judged = 0;
    let met = 0;
    let resolvedCount = 0;
    let reopened = 0;
    const categories = new Map<string, number>();

    for (const row of rows) {
      const level = serviceLevel(
        {
          status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at,
          heldSeconds: row.held_seconds, holdStartedAt: row.hold_started_at,
          messages: byTicket.get(row.id) ?? [], stamped: stamped.get(row.id),
        },
        targetsAt(history, row.created_at),
        now,
      );

      if (inPeriod(row.created_at)) {
        categories.set(row.category, (categories.get(row.category) ?? 0) + 1);

        if (byTicket.get(row.id)?.some((m) => m.sender === "staff")) firstReplies.push(worked(level.firstReply));

        const missed = level.firstReply.state === "missed" || level.resolve.state === "missed";
        const settled = ["met", "missed"].includes(level.firstReply.state) && ["met", "missed", "done"].includes(level.resolve.state);
        if (missed || settled) {
          judged += 1;
          if (!missed) met += 1;
        }
      }

      if (inPeriod(row.resolved_at)) {
        resolvedCount += 1;
        if (row.status === "open" || row.status === "on_hold" || row.has_follow_up) reopened += 1;
        if (["met", "missed"].includes(level.resolve.state)) resolves.push(worked(level.resolve));
      }
    }

    const ratedRows = await sql<{ id: number; subject: string; customer_name: string; rating: number; rating_comment: string | null; rated_at: Date; claimed_by_id: string | null; claimed_by_name: string | null }[]>`
      select t.id, t.subject, c.full_name as customer_name, t.rating, t.rating_comment, t.rated_at, t.claimed_by_id, t.claimed_by_name
      from tickets t join customers c on c.id = t.customer_id
      where t.rating is not null and t.rated_at >= ${start} and t.rated_at < ${end}
      order by t.rating, t.rated_at desc, t.id`;

    const openNow = await sql<{ claimed_by_id: string; claimed_by_name: string; open: number }[]>`
      select claimed_by_id, max(claimed_by_name) as claimed_by_name, count(*)::int as open from tickets
      where claimed_by_id is not null and status in ('open', 'on_hold') group by claimed_by_id`;

    const staff = new Map<string, StaffLoad & { sum: number }>();
    const person = (id: string, name: string | null) => {
      const found = staff.get(id);
      if (found) return found;
      const created = { id, name: name ?? "Staff", open: 0, resolved: 0, averageRating: null, rated: 0, sum: 0 };
      staff.set(id, created);

      return created;
    };
    for (const o of openNow) person(o.claimed_by_id, o.claimed_by_name).open = o.open;
    for (const row of rows) if (row.claimed_by_id && inPeriod(row.resolved_at)) person(row.claimed_by_id, row.claimed_by_name).resolved += 1;
    for (const r of ratedRows) {
      if (!r.claimed_by_id) continue;
      const p = person(r.claimed_by_id, r.claimed_by_name);
      p.rated += 1;
      p.sum += r.rating;
    }

    const [escalations] = await crms<{ n: number }[]>`
      select count(*)::int as n from crms.ticket_escalations where created_at >= ${start} and created_at < ${end}`;

    return {
      ok: true,
      report: {
        targets: (({ firstReplyHours, resolveHours }) => ({ firstReplyHours, resolveHours }))(targetsAt(history, now)),
        firstReplyMedian: median(firstReplies),
        resolveMedian: median(resolves),
        metShare: judged === 0 ? null : met / judged,
        judged,
        reopenRate: resolvedCount === 0 ? null : reopened / resolvedCount,
        reopened,
        resolvedCount,
        averageRating: mean(ratedRows.map((r) => r.rating)),
        rated: ratedRows.length,
        escalated: escalations?.n ?? 0,
        categories: [...categories].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
        staff: [...staff.values()]
          .map(({ sum, ...p }) => ({ ...p, averageRating: p.rated ? sum / p.rated : null }))
          .sort((a, b) => b.open - a.open || b.resolved - a.resolved || a.name.localeCompare(b.name)),
        lowest: ratedRows.slice(0, LOWEST_RATINGS_SHOWN).map((r) => ({
          ticketId: r.id, subject: r.subject, customerName: r.customer_name, rating: r.rating, comment: r.rating_comment, ratedAt: r.rated_at,
        })),
      },
    };
  } catch (error) {
    console.error("Ticket reports could not be read", error);

    return { ok: false, reason: "unavailable" };
  }
}
