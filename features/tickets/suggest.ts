import type postgres from "postgres";

import type { Completer } from "@/features/feedback/sentiment-clients";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { TICKETS_MODULE } from "@/lib/portal/config";

import { changeTicketPriority, type Actor } from "./ticket-actions";
import { TICKET_PRIORITIES, type TicketPriority } from "./tickets";
import { TICKET_CATEGORIES, type SuggestFailure, type SuggestField, type TicketSuggestion } from "./suggest-view";

export { TICKET_CATEGORIES };

/** The most characters of Ticket text sent to the model. */
export const SENT_TEXT_MAX = 4000;

const PROMPT =
  "You triage customer support tickets for a small food store. You only see the ticket text. Choose a Category from: " +
  `${TICKET_CATEGORIES.join(", ")}. Choose a Priority from: low, normal, high, urgent (urgent: food safety, money lost or a customer in distress; ` +
  "high: a missed promise or deadline; normal: usual questions; low: no rush). The text may be English or Taglish. " +
  'Reply with JSON only: {"category": "<one Category exactly as listed>", "categoryReason": "<under 80 characters>", ' +
  '"priority": "<low|normal|high|urgent>", "priorityReason": "<under 80 characters>"}.';

/** Emails and phone numbers are masked; the model needs the problem, not who has it. */
function scrub(text: string): string {
  return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]").replace(/\+?\d[\d\s().-]{7,}\d/g, "[number]");
}

/** The Ticket text, and only that: the subject and the Messages, never Internal notes, names, addresses or the Order. */
export function ticketText(subject: string, messages: { sender: "customer" | "staff"; body: string }[]): string {
  const lines = messages
    .filter((m) => m.body.trim())
    .map((m) => `${m.sender === "customer" ? "Customer" : "Staff"}: ${m.body.trim().replace(/\s+/g, " ")}`);
  const head = `Subject: ${subject.trim()}`;
  let body = lines.join("\n");
  // Keep the newest Messages when the thread is long.
  if (head.length + body.length > SENT_TEXT_MAX) body = body.slice(body.length - (SENT_TEXT_MAX - head.length - 1));

  return scrub(`${head}\n${body}`);
}

/** The Category and Priority in a model's JSON reply, even inside a code fence; a throw otherwise. */
export function parseSuggestion(reply: unknown): { category: string; categoryReason: string; priority: TicketPriority; priorityReason: string } {
  const object = (typeof reply === "string" ? reply : "").match(/\{[\s\S]*\}/)?.[0];
  let parsed: Record<string, unknown> = {};

  try {
    if (object) parsed = JSON.parse(object);
  } catch {
    // Rejected below.
  }

  const category = TICKET_CATEGORIES.find((c) => c.toLowerCase() === String(parsed.category ?? "").trim().toLowerCase());
  const priority = TICKET_PRIORITIES.find((p) => p === String(parsed.priority ?? "").trim().toLowerCase());

  if (!category || !priority) throw new Error(`The model replied with "${String(reply)}", not a Category and Priority`);

  const reason = (v: unknown) => String(v ?? "").trim().slice(0, 120);

  return { category, categoryReason: reason(parsed.categoryReason), priority, priorityReason: reason(parsed.priorityReason) };
}

export interface SuggestDeps {
  /** The ecommerce database; reads the Ticket text and, when Staff accept or change, writes Category and Priority. */
  tickets: postgres.Sql;
  /** CREOMS's own `crms` schema; records what was sent and what Staff decided. */
  crms: postgres.Sql;
  audit: AuditTrail;
  /** The Staff member as the Portal knows them: their id is the Audit Event's actor. */
  staff: { id: string; name: string };
}

type Row = Record<string, unknown>;

function toSuggestion(r: Row): TicketSuggestion {
  const decision = (f: "category" | "priority") =>
    r[`${f}_decision`] ? { kind: r[`${f}_decision`] as "accepted" | "changed", applied: r[`${f}_applied`] as string, by: r[`${f}_decided_by_name`] as string } : null;

  return {
    id: Number(r.id),
    model: r.model as string,
    sentText: r.sent_text as string,
    category: r.category as string,
    categoryReason: r.category_reason as string,
    priority: r.priority as TicketPriority,
    priorityReason: r.priority_reason as string,
    categoryDecision: decision("category"),
    priorityDecision: decision("priority"),
    createdAt: r.created_at as Date,
  };
}

/** The newest suggestion for a Ticket, or null. */
export async function latestSuggestion(crms: postgres.Sql, ticketId: number): Promise<TicketSuggestion | null> {
  const [row] = await crms<Row[]>`select * from crms.ticket_ai_suggestions where ticket_id = ${ticketId} order by created_at desc, id desc limit 1`;

  return row ? toSuggestion(row) : null;
}

/**
 * Asks the model, on demand, for a Category and Priority from the Ticket text only, and records what was sent.
 * The Ticket is not changed. Models are tried in order; if none answers the Ticket stays usable by hand.
 */
export async function suggestForTicket(
  deps: SuggestDeps,
  actor: Actor,
  ticketId: number,
  models: { model: string; complete: Completer }[],
  operationId: string,
): Promise<{ ok: true; suggestion: TicketSuggestion } | { ok: false; reason: SuggestFailure }> {
  const [ticket] = await deps.tickets<Row[]>`select subject, status from tickets where id = ${ticketId}`;
  if (!ticket) return { ok: false, reason: "not-found" };
  if (ticket.status === "completed") return { ok: false, reason: "completed" };

  const [replay] = await deps.crms<Row[]>`select * from crms.ticket_ai_suggestions where requested_by_id = ${actor.id} and operation_id = ${operationId}`;
  if (replay) return { ok: true, suggestion: toSuggestion(replay) };

  if (!models.length) return { ok: false, reason: "no-keys" };

  const messages = await deps.tickets<Row[]>`
    select sender, body from ticket_messages where ticket_id = ${ticketId} and internal is not true order by created_at, id`;
  const sent = ticketText(
    ticket.subject as string,
    messages.map((m) => ({ sender: m.sender as "customer" | "staff", body: (m.body as string) ?? "" })),
  );

  for (const { model, complete } of models) {
    try {
      const s = parseSuggestion(await complete(PROMPT, sent));
      const [row] = await deps.crms<Row[]>`
        insert into crms.ticket_ai_suggestions
          (ticket_id, requested_by_id, requested_by_name, operation_id, model, sent_text, category, category_reason, priority, priority_reason)
        values (${ticketId}, ${actor.id}, ${actor.name}, ${operationId}, ${model}, ${sent}, ${s.category}, ${s.categoryReason}, ${s.priority}, ${s.priorityReason})
        returning *`;

      return { ok: true, suggestion: toSuggestion(row) };
    } catch (error) {
      console.error(`The model ${model} could not suggest for TKT-${ticketId}`, error);
    }
  }

  return { ok: false, reason: "model-failed" };
}

/**
 * Staff set one field, by Accept (the suggested value) or Change (their own). Nothing applies without this call.
 * When a suggestion is given, the decision is recorded on it and audited with the Staff member's name.
 */
export async function applyField(
  deps: SuggestDeps,
  actor: Actor,
  ticketId: number,
  field: SuggestField,
  value: string,
  suggestionId: number | null,
  operationId: string,
): Promise<{ ok: true } | { ok: false; reason: SuggestFailure }> {
  if (field === "category" ? !(TICKET_CATEGORIES as readonly string[]).includes(value) : !(TICKET_PRIORITIES as string[]).includes(value))
    return { ok: false, reason: "invalid-value" };

  const [ticket] = await deps.tickets<Row[]>`select status, category, priority from tickets where id = ${ticketId}`;
  if (!ticket) return { ok: false, reason: "not-found" };
  if (ticket.status === "completed") return { ok: false, reason: "completed" };

  let suggested: TicketSuggestion | null = null;

  if (suggestionId !== null) {
    const [row] = await deps.crms<Row[]>`select * from crms.ticket_ai_suggestions where id = ${suggestionId} and ticket_id = ${ticketId}`;
    if (!row) return { ok: false, reason: "no-suggestion" };
    suggested = toSuggestion(row);
  }

  if (ticket[field] !== value) {
    if (field === "category") await deps.tickets`update tickets set category = ${value} where id = ${ticketId} and status <> 'completed'`;
    else {
      const result = await changeTicketPriority(deps.tickets, ticketId, value);
      if (!result.ok && result.reason !== "unchanged") return { ok: false, reason: result.reason === "completed" || result.reason === "not-found" ? result.reason : "invalid-value" };
    }
  }

  if (!suggested) {
    await audit(deps, actor, ticketId, `ticket.${field}_changed`, `changed ${field === "category" ? "Category" : "Priority"} to ${value} on`, operationId);

    return { ok: true };
  }

  const kind = value === suggested[field] ? "accepted" : "changed";
  if (field === "category")
    await deps.crms`update crms.ticket_ai_suggestions set category_decision = ${kind}, category_applied = ${value}, category_decided_by_name = ${actor.name} where id = ${suggested.id}`;
  else
    await deps.crms`update crms.ticket_ai_suggestions set priority_decision = ${kind}, priority_applied = ${value}, priority_decided_by_name = ${actor.name} where id = ${suggested.id}`;

  await audit(
    deps,
    actor,
    ticketId,
    `ticket.ai_${field}_${kind}`,
    `${kind} the AI-suggested ${field === "category" ? "Category" : "Priority"} (${suggested[field]})${kind === "changed" ? ` and set ${value}` : ""} on`,
    operationId,
  );

  return { ok: true };
}

async function audit(deps: SuggestDeps, actor: Actor, ticketId: number, action: string, change: string, operationId: string) {
  await recordAudit(deps.audit, {
    module: TICKETS_MODULE,
    action,
    outcome: "success",
    actor: staffAuditActor(deps.staff),
    target: { type: "ticket", id: String(ticketId), display_name: `TKT-${ticketId}` },
    description: `${actor.name} ${change} TKT-${ticketId}.`,
    occurred_at: new Date().toISOString(),
    operationId: JSON.stringify([actor.id, operationId, action]),
  }).catch(() => {});
}
