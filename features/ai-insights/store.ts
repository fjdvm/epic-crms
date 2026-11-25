import type postgres from "postgres";

import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { cityLabel } from "@/lib/geo/areas";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";

import type { Sources } from "./facts";
import { worsened, type Insight, type PeriodDays, type RecordType } from "./insights";
import { loadLatestRun, type InsightRun } from "./run";

export interface Viewer { id: string; name: string; role: string }
type Numbers = Record<string, number>;

/** Everyone who can open the page may dismiss for themselves and say whether a card helped: both are personal. */
export const canAnswer = (role: string) => ["manager", "admin"].includes(shopRole(role) ?? "");

/** The cards this person sees: from Modules they hold, minus the ones they dismissed (until the numbers get worse). */
export function visibleInsights(insights: Insight[], modules: readonly string[], dismissed: Map<string, Numbers>): Insight[] {
  return insights.filter((i) => modules.includes(i.module) && (!dismissed.has(i.key) || worsened(i.numbers, dismissed.get(i.key)!)));
}

/** What this person dismissed, and their Helpful / Not helpful answers on this run. */
export async function viewerState(crms: postgres.Sql, viewer: Viewer, run: InsightRun) {
  const [dismissed, answers] = await Promise.all([
    crms<{ suggestion_key: string; numbers: Numbers }[]>`
      select suggestion_key, numbers from crms.ai_insight_decisions where staff_id = ${viewer.id} and decision = 'dismissed'`,
    crms<{ insight_key: string; helpful: boolean }[]>`
      select insight_key, helpful from crms.ai_insight_feedback where staff_id = ${viewer.id} and run_id = ${run.id}`,
  ]);
  return {
    dismissed: new Map(dismissed.map((d) => [d.suggestion_key, d.numbers])),
    answers: Object.fromEntries(answers.map((a) => [a.insight_key, a.helpful])) as Record<string, boolean>,
  };
}

type Found = { ok: true; run: InsightRun; insight: Insight } | { ok: false; reason: string };

async function find(crms: postgres.Sql, viewer: Viewer, modules: readonly string[], days: PeriodDays, key: string): Promise<Found> {
  if (!canAnswer(viewer.role)) return { ok: false, reason: "Your Role cannot open AI insights." };
  const run = await loadLatestRun(crms, days);
  const insight = run?.insights.find((i) => i.key === key);
  if (!run || !insight) return { ok: false, reason: "This insight has been updated. Reload the page to see the latest." };
  if (!modules.includes(insight.module)) return { ok: false, reason: "This insight is not in your Modules." };
  return { ok: true, run, insight };
}

/** "Dismiss for me": hides the card for this person until its numbers get worse. Changes nothing in the shop; logged with their name. */
export async function dismissInsight(
  crms: postgres.Sql, audit: AuditTrail, viewer: Viewer, modules: readonly string[], days: PeriodDays, key: string, now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const found = await find(crms, viewer, modules, days, key);
    if (!found.ok) return found;
    const { insight } = found;
    await crms`insert into crms.ai_insight_decisions (staff_id, staff_name, suggestion_key, numbers, decision)
      values (${viewer.id}, ${viewer.name}, ${key}, ${crms.json(insight.numbers)}, 'dismissed')
      on conflict (staff_id, suggestion_key) do update set staff_name = excluded.staff_name, numbers = excluded.numbers,
        decision = excluded.decision, decided_at = now()`;
    await recordAudit(audit, {
      module: DASHBOARD_MODULE, action: "ai_insight.dismissed", outcome: "success",
      actor: staffAuditActor(viewer), target: { type: "ai_insight", id: key, display_name: insight.headline.slice(0, 120) },
      description: `${viewer.name} dismissed the AI insight for themselves: ${insight.headline}`,
      occurred_at: now.toISOString(), operationId: `ai-insight:${viewer.id}:${key}:dismissed:${now.getTime()}`,
      metadata: { key, numbers: insight.numbers, module: insight.module, days },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not save that. Please try again." };
  }
}

/** "Was this useful?": one answer per person, card and morning run; answering again changes it. */
export async function answerInsight(
  crms: postgres.Sql, viewer: Viewer, modules: readonly string[], days: PeriodDays, key: string, helpful: boolean,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const found = await find(crms, viewer, modules, days, key);
    if (!found.ok) return found;
    await crms`insert into crms.ai_insight_feedback (staff_id, staff_name, run_id, insight_key, helpful)
      values (${viewer.id}, ${viewer.name}, ${found.run.id}, ${key}, ${helpful})
      on conflict (staff_id, run_id, insight_key) do update set staff_name = excluded.staff_name, helpful = excluded.helpful, answered_at = now()`;
    return { ok: true };
  } catch {
    return { ok: false, reason: "Could not save that. Please try again." };
  }
}

export interface EvidenceRecord { type: RecordType; id: number; label: string; detail: string; status: string; href: string }

const STATUS: Record<string, string> = {
  open: "Open", on_hold: "On hold", resolved: "Resolved", completed: "Completed", placed: "Placed", confirmed: "Confirmed",
  "awaiting payment": "Awaiting payment", paid: "Paid", preparing: "Preparing", dispatched: "Dispatched", delivered: "Delivered",
  received: "Received", cancelled: "Cancelled", requested: "Requested", approved: "Approved", "goods received": "Goods received",
  refunded: "Refunded", replaced: "Replaced", declined: "Declined",
};
const status = (s: string) => STATUS[s] ?? s;

/**
 * The records behind a card, read now so names and statuses are current. Shown only to the person on the page; none of
 * it is ever sent to a model. Records the run listed but that are gone are left out.
 */
export async function loadEvidence(
  { source, crms }: Sources, viewer: Viewer, modules: readonly string[], days: PeriodDays, key: string,
): Promise<{ ok: true; records: EvidenceRecord[] } | { ok: false; reason: string }> {
  const found = await find(crms, viewer, modules, days, key);
  if (!found.ok) return found;
  const ids = (type: RecordType) => found.insight.records.filter((r) => r.type === type).map((r) => r.id);
  const [orders, tickets, returns] = await Promise.all([
    ids("order").length ? source<{ id: number; name: string; city: string | null; status: string }[]>`
      select o.id, c.full_name as name, a.city, o.status from public.orders o join public.customers c on c.id = o.customer_id
      left join public.order_delivery_addresses a on a.order_id = o.id where o.id in ${source(ids("order"))}` : [],
    ids("ticket").length ? source<{ id: number; name: string; subject: string; city: string | null; status: string }[]>`
      select t.id, c.full_name as name, t.subject, a.city, t.status from public.tickets t join public.customers c on c.id = t.customer_id
      left join public.order_delivery_addresses a on a.order_id = t.order_id where t.id in ${source(ids("ticket"))}` : [],
    ids("return").length ? source<{ id: number; order_id: number; name: string; products: string[] | null; status: string }[]>`
      select r.id, r.order_id, c.full_name as name, r.status,
        (select array_agg(distinct i.product_name) from public.order_return_items i where i.return_id = r.id) as products
      from public.order_returns r join public.orders o on o.id = r.order_id join public.customers c on c.id = o.customer_id
      where r.id in ${source(ids("return"))}` : [],
  ]);
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ");
  const byKey = new Map<string, EvidenceRecord>([
    ...orders.map((o): [string, EvidenceRecord] => [`order:${o.id}`, {
      type: "order", id: o.id, label: `Order #${o.id}`, detail: join(o.name, o.city ? cityLabel(o.city) : null), status: status(o.status), href: `/orders/${o.id}`,
    }]),
    ...tickets.map((t): [string, EvidenceRecord] => [`ticket:${t.id}`, {
      type: "ticket", id: t.id, label: `Ticket #${t.id}`, detail: join(t.name, t.city ? cityLabel(t.city) : null, t.subject), status: status(t.status), href: `/tickets/${t.id}`,
    }]),
    ...returns.map((r): [string, EvidenceRecord] => [`return:${r.id}`, {
      type: "return", id: r.id, label: `Return #${r.id}`, detail: join(r.name, `Order #${r.order_id}`, (r.products ?? []).join(", ")), status: status(r.status), href: `/returns/${r.id}`,
    }]),
  ]);
  return { ok: true, records: found.insight.records.map((r) => byKey.get(`${r.type}:${r.id}`)).filter((r): r is EvidenceRecord => !!r) };
}

/** Parses the period a request names: "7" or "30" (also "7-days" / "30-days"), else null. */
export function parseDays(value: unknown): PeriodDays | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return n === 7 || n === 30 ? n : null;
}
