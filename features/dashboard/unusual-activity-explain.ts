import type postgres from "postgres";
import { z } from "zod";
import { maskText } from "@/features/tickets/ai-text";
import { configuredStructuredModels, structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { shopRole } from "@/lib/portal/roles";
import { loadUnusualActivity, type UnusualActivityCard } from "./unusual-activity";

export interface UnusualActivityExplanation { why: string | null; whatToDo: string | null }
type Numbers = Record<string, number>;
type Deps = { source: postgres.Sql; crms: postgres.Sql };
type Staff = Parameters<typeof loadUnusualActivity>[1];

const SYSTEM = "You help shop Managers read an Unusual activity alert. Using only the rule and numbers given, write " +
  "\"why\": one sentence (at most 250 characters) on why this is unusual, and \"whatToDo\": one sentence (at most 250 characters) " +
  "suggesting a next step for the team. Quote only numbers that appear in the alert. Never include links, names, " +
  "promises of refunds or replacements, or anything about a Customer. This is internal assistance and changes nothing.";
const schema = z.object({ why: z.string().trim().max(250), whatToDo: z.string().trim().max(250) });

/** The only thing sent: the alert's rule text and its own numbers. No links, Orders or Customers. */
export function alertText(card: Pick<UnusualActivityCard, "rule" | "numbers">): string {
  const mask = maskText();
  return `Rule: ${mask(card.rule)}\nNumbers: ${Object.entries(card.numbers).map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

const NUMBER = /\d+(?:[.,]\d+)*/g;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred"];
const WORD_VALUE: Record<string, string> = Object.fromEntries(WORDS.map((w, i) => [w, String(i <= 20 ? i : i === 29 ? 100 : (i - 18) * 10)]));
const WORD = new RegExp(`\\b(${WORDS.join("|")})\\b`, "gi");
const norm = (n: string) => n.replace(/,/g, "");
/** True when the text quotes no number or link that the alert itself does not hold. */
export function quotesOnlyAlertFacts(text: string, card: Pick<UnusualActivityCard, "rule" | "numbers" | "links">): boolean {
  const hrefs = card.links.map(l => l.href);
  let rest = text;
  for (const href of hrefs) rest = rest.split(href).join(" ");
  if (/https?:\/\/|www\.|(?:^|\s)\/[a-z]/i.test(rest)) return false;
  const held = new Set<string>([
    ...Object.values(card.numbers).map(String),
    ...(card.rule.match(NUMBER) ?? []).map(norm),
    ...card.links.flatMap(l => (l.label.match(NUMBER) ?? []).map(norm)),
  ]);
  const quoted = [...(rest.match(NUMBER) ?? []).map(norm), ...(rest.match(WORD) ?? []).map(w => WORD_VALUE[w.toLowerCase()])];
  return quoted.every(n => held.has(n));
}

function worse(current: Numbers, kept: Numbers) {
  return Object.entries(current).some(([k, v]) => v > (kept[k] ?? v));
}
const view = (r: { why: string | null; what_to_do: string | null }): UnusualActivityExplanation => ({ why: r.why, whatToDo: r.what_to_do });

/** Kept explanations for the given cards, keyed by alert key. Never calls a model. */
export async function keptExplanations(crms: postgres.Sql, cards: UnusualActivityCard[]): Promise<Map<string, UnusualActivityExplanation>> {
  if (!cards.length) return new Map();
  const rows = await crms<{ alert_key: string; numbers: Numbers; why: string | null; what_to_do: string | null }[]>`
    select alert_key, numbers, why, what_to_do from crms.unusual_activity_explanations
    where alert_key in ${crms(cards.map(c => c.key))}`;
  const byKey = new Map(rows.map(r => [r.alert_key, r]));
  const out = new Map<string, UnusualActivityExplanation>();
  for (const c of cards) {
    const r = byKey.get(c.key);
    if (r && !worse(c.numbers, r.numbers)) out.set(c.key, view(r));
  }
  return out;
}

/**
 * Made once per alert on first sight by Staff or a Manager, kept, and made again only when the numbers get worse.
 * Admin never reach a model. A failure returns null and the card simply shows without it.
 */
export async function explainUnusualActivity(
  deps: Deps, staff: Staff, modules: readonly string[], key: string,
  models: () => StructuredModel[] = configuredStructuredModels, now = new Date(),
): Promise<UnusualActivityExplanation | null> {
  try {
    const role = shopRole(staff.role);
    if (role !== "staff" && role !== "manager") return null;
    // Recompute from current records: client-supplied numbers are never trusted or sent.
    const card = (await loadUnusualActivity(deps, staff, modules, now)).cards.find(c => c.key === key);
    if (!card) return null;
    return await deps.crms.begin(async tx => {
      const [lock] = await tx`select pg_try_advisory_xact_lock(484, hashtext(${key})) as acquired`;
      if (!lock.acquired) return null;
      const [kept] = await tx<{ numbers: Numbers; why: string | null; what_to_do: string | null }[]>`
        select numbers, why, what_to_do from crms.unusual_activity_explanations where alert_key = ${key}`;
      if (kept && !worse(card.numbers, kept.numbers)) return view(kept);
      const sentText = alertText(card);
      const result = await structuredOutput({ schema, system: SYSTEM, prompt: sentText, models: models(), maxOutputTokens: 300 });
      if (!result.ok) return null;
      const why = result.output.why && quotesOnlyAlertFacts(result.output.why, card) ? result.output.why : null;
      const whatToDo = result.output.whatToDo && quotesOnlyAlertFacts(result.output.whatToDo, card) ? result.output.whatToDo : null;
      if (!why && !whatToDo) return null;
      await tx`insert into crms.unusual_activity_explanations (alert_key, numbers, why, what_to_do, model, sent_text, system_prompt)
        values (${key}, ${tx.json(card.numbers)}, ${why}, ${whatToDo}, ${result.model}, ${sentText}, ${SYSTEM})
        on conflict (alert_key) do update set numbers = excluded.numbers, why = excluded.why, what_to_do = excluded.what_to_do,
          model = excluded.model, sent_text = excluded.sent_text, system_prompt = excluded.system_prompt, created_at = now()`;
      return { why, whatToDo };
    });
  } catch {
    return null;
  }
}
