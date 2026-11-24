import { z } from "zod";

import { quotesOnlyAlertFacts } from "@/features/dashboard/unusual-activity-explain";
import { maskText } from "@/features/tickets/ai-text";
import { configuredStructuredModels, structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";

import { loadSuggestionInputs, type Sources as SectionSources } from "./load";
import { buildSuggestions, SUGGESTION_LIMIT, worsened, type Suggestion, type SuggestionInputs } from "./suggestions";

/** The databases, and (for tests) where the figures come from. */
export type Sources = SectionSources & { inputs?: (modules: readonly string[], now: Date) => Promise<SuggestionInputs> };

export interface Viewer { id: string; name: string; role: string }
type Numbers = Record<string, number>;
export type Decision = "accepted" | "dismissed";

const SYSTEM = "You help shop Managers read a suggestion worked out from their shop's figures. Using only the suggestion " +
  "and numbers given, write \"why\": one sentence (at most 220 characters) on why it matters to the business. " +
  "Quote only numbers that appear in the suggestion. Never include links, names of people, promises to Customers, " +
  "or instructions to change anything automatically. This is internal assistance and changes nothing.";
const schema = z.object({ why: z.string().trim().max(220) });

/** The suggestions this person can act on, from their Modules, minus the ones they dismissed or accepted (until they get worse). */
async function current(sources: Sources, modules: readonly string[], now: Date): Promise<Suggestion[]> {
  const inputs = await (sources.inputs ? sources.inputs(modules, now) : loadSuggestionInputs(sources, modules, now));
  return buildSuggestions(inputs).filter((s) => modules.includes(s.module));
}

/** The only thing sent to a model: the suggestion's own sentence and numbers. No Customer is ever in it. */
export function suggestionText(s: Pick<Suggestion, "text" | "numbers">): string {
  const mask = maskText();
  return `Suggestion: ${mask(s.text)}\nNumbers: ${Object.entries(s.numbers).map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

/** Read on page open or a user action, never on a timer; never calls a model. */
export async function loadSuggestions(sources: Sources, viewer: Viewer, modules: readonly string[], now = new Date()): Promise<Suggestion[]> {
  const all = await current(sources, modules, now);
  if (all.length === 0) return [];
  const seen = await sources.crms<{ suggestion_key: string; numbers: Numbers }[]>`
    select suggestion_key, numbers from crms.ai_insight_decisions where staff_id = ${viewer.id}`;
  const decided = new Map(seen.map((d) => [d.suggestion_key, d.numbers]));
  const shown = all.filter((s) => !decided.has(s.key) || worsened(s.numbers, decided.get(s.key)!)).slice(0, SUGGESTION_LIMIT);
  if (shown.length === 0) return [];
  const notes = await sources.crms<{ suggestion_key: string; numbers: Numbers; why: string }[]>`
    select suggestion_key, numbers, why from crms.ai_insight_notes where suggestion_key in ${sources.crms(shown.map((s) => s.key))}`
    .catch(() => []);
  const kept = new Map(notes.filter((n) => !worsenedOrChanged(shown.find((s) => s.key === n.suggestion_key)!.numbers, n.numbers)).map((n) => [n.suggestion_key, n.why]));
  return shown.map((s) => ({ ...s, why: kept.get(s.key) ?? null }));
}

const worsenedOrChanged = (now: Numbers, kept: Numbers) =>
  Object.keys(now).length !== Object.keys(kept).length || Object.entries(now).some(([k, v]) => kept[k] !== v);

/**
 * A Manager-level person accepts (opens the action) or dismisses a suggestion. Checked against the figures they saw,
 * recorded with their name in the Audit Logs. Changes nothing in the shop.
 */
export async function decideSuggestion(
  sources: Sources, audit: AuditTrail, viewer: Viewer, modules: readonly string[], key: string, numbers: Numbers, decision: Decision, now = new Date(),
): Promise<{ ok: true; href?: string } | { ok: false; reason: string }> {
  if (shopRole(viewer.role) !== "manager") return { ok: false, reason: "Your Role can only view suggestions." };
  try {
    const suggestion = (await current(sources, modules, now)).find((s) => s.key === key);
    if (!suggestion || worsenedOrChanged(suggestion.numbers, numbers))
      return { ok: false, reason: "This suggestion changed or no longer applies. Reload the page to see the latest." };
    await sources.crms`insert into crms.ai_insight_decisions (staff_id, staff_name, suggestion_key, numbers, decision)
      values (${viewer.id}, ${viewer.name}, ${key}, ${sources.crms.json(numbers)}, ${decision})
      on conflict (staff_id, suggestion_key) do update set staff_name = excluded.staff_name, numbers = excluded.numbers,
        decision = excluded.decision, decided_at = now()`;
    await recordAudit(audit, {
      module: DASHBOARD_MODULE, action: `ai_insight.${decision}`, outcome: "success",
      actor: staffAuditActor(viewer), target: { type: "ai_insight", id: key, display_name: suggestion.text.slice(0, 120) },
      description: `${viewer.name} ${decision} the AI Insights suggestion: ${suggestion.text}`,
      occurred_at: now.toISOString(), operationId: `ai-insight:${viewer.id}:${key}:${decision}:${now.getTime()}`,
      metadata: { key, numbers, decision, module: suggestion.module },
    });
    return { ok: true, ...(decision === "accepted" ? { href: suggestion.action.href } : {}) };
  } catch {
    return { ok: false, reason: "Could not save that. Please try again." };
  }
}

/**
 * Made once per suggestion on a Manager's first sight, kept, and made again only when its numbers change.
 * Admin and Staff never reach a model. A failure returns null and the card shows without it.
 */
export async function explainSuggestion(
  sources: Sources, viewer: Viewer, modules: readonly string[], key: string,
  models: () => StructuredModel[] = configuredStructuredModels, now = new Date(),
): Promise<string | null> {
  try {
    if (shopRole(viewer.role) !== "manager") return null;
    const suggestion = (await current(sources, modules, now)).find((s) => s.key === key);
    if (!suggestion) return null;
    return await sources.crms.begin(async (tx) => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(731, hashtext(${key})) as acquired`;
      if (!lock.acquired) return null;
      const [kept] = await tx<{ numbers: Numbers; why: string }[]>`select numbers, why from crms.ai_insight_notes where suggestion_key = ${key}`;
      if (kept && !worsenedOrChanged(suggestion.numbers, kept.numbers)) return kept.why;
      const sentText = suggestionText(suggestion);
      const result = await structuredOutput({ schema, system: SYSTEM, prompt: sentText, models: models(), maxOutputTokens: 200 });
      if (!result.ok) return null;
      const why = result.output.why;
      if (!why || !quotesOnlyAlertFacts(why, { rule: suggestion.text, numbers: suggestion.numbers, links: [] })) return null;
      await tx`insert into crms.ai_insight_notes (suggestion_key, numbers, why, model, sent_text, system_prompt)
        values (${key}, ${tx.json(suggestion.numbers)}, ${why}, ${result.model}, ${sentText}, ${SYSTEM})
        on conflict (suggestion_key) do update set numbers = excluded.numbers, why = excluded.why, model = excluded.model,
          sent_text = excluded.sent_text, system_prompt = excluded.system_prompt, created_at = now()`;
      return why;
    });
  } catch {
    return null;
  }
}
