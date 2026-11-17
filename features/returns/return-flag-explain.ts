import type postgres from "postgres";
import { z } from "zod";

import { configuredStructuredModels, structuredOutput, type StructuredModel } from "@/lib/ai/structured";
import { shopRole } from "@/lib/portal/roles";

import { loadAutomaticChecks } from "@/features/settings/automatic-checks";
import { FREQUENT_RETURNS_DAYS, loadReturnFlags, type ReturnFlag, type ReturnFlagRule } from "./return-flags";

type Deps = { reader: postgres.Sql; crms: postgres.Sql };
export type FlagExplanation = { ok: true; explanation: string } | { ok: false; reason: "forbidden" | "not-flagged" | "unavailable" };
const DAY = 24 * 60 * 60 * 1000;

const SYSTEM = "You help a shop Manager understand why a Return was flagged. Using only the record given, write one short " +
  "paragraph (at most 400 characters) describing the pattern: counts, dates and Return reasons. Quote only numbers and RMA " +
  "numbers that appear in the record. Never mention photos, names, addresses or links, and never promise or recommend a " +
  "refund, replacement or decision. This is internal assistance and changes nothing.";
const schema = z.object({ explanation: z.string().trim().min(1).max(400) });

interface Record_ { text: string; held: Set<string> }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const NUMBER = /\d+/g;

/**
 * Everything the model sees, and everything it may quote: counts, dates, Return reasons and RMA numbers.
 * No photo, no Customer or Order identity, no free-text note.
 */
export async function flagRecord(reader: postgres.Sql, returnId: number, flag: ReturnFlag, days = FREQUENT_RETURNS_DAYS): Promise<Record_ | null> {
  const ids = [returnId, ...flag.earlier.map(e => e.id)];
  const rows = await reader<{ id: number; requested_at: Date; reason: string; status: string }[]>`
    select id, requested_at, reason, status from public.order_returns where id in ${reader(ids)}`;
  const self = rows.find(r => r.id === returnId);
  if (!self) return null;
  const earlier = rows.filter(r => r.id !== returnId).sort((a, b) => a.id - b.id);
  const lines = [
    `Flag: ${flag.rule === "frequent-returns" ? "frequent Returns" : "similar evidence photo to an earlier Return"}`,
    `This Return: RMA-${self.id}, requested ${iso(self.requested_at)}, reason: ${self.reason}`,
    ...earlier.map(r => `Earlier Return: RMA-${r.id}, requested ${iso(r.requested_at)} (${Math.round((self.requested_at.getTime() - r.requested_at.getTime()) / DAY)} days before), reason: ${r.reason}, status: ${r.status}`),
    `Earlier Returns linked to this flag: ${earlier.length}`,
  ];
  if (flag.rule === "frequent-returns") lines.push(`Returns by this Customer in the last ${days} days, including this one: ${earlier.length + 1}`);
  const text = lines.join("\n");
  return { text, held: new Set((text.match(NUMBER) ?? []).map(n => String(Number(n)))) };
}

/** True when the text quotes only numbers (and no link) that the record holds. */
export function quotesOnlyRecord(text: string, held: Set<string>): boolean {
  if (/https?:\/\/|www\./i.test(text)) return false;
  return (text.match(NUMBER) ?? []).every(n => held.has(String(Number(n))));
}

/** The kept explanation, if any. Never calls a model; any role that can open the Return may read it. */
export async function keptFlagExplanation(crms: postgres.Sql, returnId: number, rule: ReturnFlagRule): Promise<string | null> {
  const [row] = await crms<{ explanation: string }[]>`
    select explanation from crms.return_flag_explanations where return_id = ${returnId} and rule = ${rule}`;
  return row?.explanation ?? null;
}

/**
 * "Explain this flag". Only a Manager can cause the call; Staff, Admin and CEO are refused before anything is read or sent.
 * The explanation is kept with what was sent. A failure or a quoted number not in the record keeps nothing, and the flag stays as it was.
 */
export async function explainReturnFlag(
  deps: Deps, staff: { id: string; name: string; role: string }, returnId: number, rule: ReturnFlagRule,
  models: () => StructuredModel[] = configuredStructuredModels,
): Promise<FlagExplanation> {
  if (shopRole(staff.role) !== "manager") return { ok: false, reason: "forbidden" };
  try {
    const settings = (await loadAutomaticChecks(deps.crms)).returns;
    const flag = (await loadReturnFlags(deps.reader, deps.crms, [returnId], settings)).get(returnId)?.find(f => f.rule === rule);
    if (!flag) return { ok: false, reason: "not-flagged" };
    const kept = await keptFlagExplanation(deps.crms, returnId, rule);
    if (kept) return { ok: true, explanation: kept };
    const record = await flagRecord(deps.reader, returnId, flag, settings.frequentReturns.days);
    if (!record) return { ok: false, reason: "not-flagged" };
    const result = await structuredOutput({ schema, system: SYSTEM, prompt: record.text, models: models(), maxOutputTokens: 300 });
    if (!result.ok || !quotesOnlyRecord(result.output.explanation, record.held)) return { ok: false, reason: "unavailable" };
    const [saved] = await deps.crms<{ explanation: string }[]>`
      insert into crms.return_flag_explanations (return_id, rule, explanation, model, sent_text, system_prompt, asked_by)
      values (${returnId}, ${rule}, ${result.output.explanation}, ${result.model}, ${record.text}, ${SYSTEM}, ${staff.name})
      on conflict (return_id, rule) do update set explanation = return_flag_explanations.explanation
      returning explanation`;
    return { ok: true, explanation: saved.explanation };
  } catch (error) {
    console.error("The Return flag could not be explained", error);
    return { ok: false, reason: "unavailable" };
  }
}
