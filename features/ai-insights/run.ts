import type postgres from "postgres";
import { z } from "zod";

import { quotesOnlyAlertFacts } from "@/features/dashboard/unusual-activity-explain";
import { maskText } from "@/features/tickets/ai-text";
import { configuredStructuredModels, structuredOutput, type StructuredModel } from "@/lib/ai/structured";

import { loadFacts, loadNowFacts, manilaDay, periodSpan, type Sources } from "./facts";
import {
  buildInsights, buildStats, enoughData, PERIOD_DAYS, type AreaFigures, type Confidence, type Insight, type InsightFacts,
  type PeriodDays, type Stats,
} from "./insights";

/** What the page reads: one stored morning run. */
export interface InsightRun {
  id: number;
  days: PeriodDays;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  enoughData: boolean;
  orders: number;
  stats: Stats;
  areas: AreaFigures[];
  unmapped: number;
  insights: Insight[];
  summary: string | null;
  summaryConfidence: Confidence | null;
}

export const SYSTEM = "You write short notes for shop Managers about insights that code worked out from their shop's figures. " +
  "Using only the facts given, write \"summary\": two or three plain sentences (at most 420 characters) on what changed in the period " +
  "and where to look first, and for each numbered insight, a note with its number \"n\" and \"note\": one or two sentences (at most 260 characters) on why it " +
  "matters and what a person could check next. Quote only numbers that appear in the facts, and do not work out new ones. " +
  "Never include links, names of people, promises to Customers, or instructions to change anything automatically. " +
  "You only suggest; a person decides. This is internal assistance and changes nothing.";
/** Notes come back by the card's number: models copy a number reliably, where a key is often replaced by a title. */
export const schema = z.object({
  summary: z.string().trim().max(420),
  notes: z.array(z.object({ n: z.number().int(), note: z.string().trim().max(260) })).max(30),
});

const periodLine = (days: PeriodDays) => `Period: the last ${days} days, compared with the ${days} days before.`;

/** The figures the summary may quote, by name. */
function headlineNumbers(facts: InsightFacts, stats: Stats): Record<string, number> {
  const numbers: Record<string, number> = { days: facts.days, orders: facts.orders, previousOrders: facts.previousOrders, deliveries: facts.wentOut, lateOrFailed: facts.lateOrFailed, returns: facts.returnsRequested };
  if (stats.openTickets.value !== null) numbers.openTickets = stats.openTickets.value;
  if (facts.sla) numbers.ticketsNearTarget = facts.sla.atRisk;
  if (stats.stockWatch.value !== null) numbers.sizesRunningLow = stats.stockWatch.value;
  return numbers;
}
const insightText = (i: Insight) => `${i.headline}. Based on: ${i.basedOn}. ${i.steps.join(" ")} Next step idea: ${i.nextStep}`;

/**
 * The only thing sent to a model: the period, aggregate figures, and each insight's own text and numbers. Names of
 * places, products and couriers; never a Customer. Masked again in case a product or theme label holds a number or email.
 */
export function promptFor(facts: InsightFacts, stats: Stats, insights: Insight[]): string {
  const mask = maskText();
  const numbers = (n: Record<string, number>) => Object.entries(n).map(([k, v]) => `${k}=${v}`).join(", ");
  return [
    periodLine(facts.days),
    `Figures: ${numbers(headlineNumbers(facts, stats))}`,
    ...insights.map((i, index) => mask(`Insight ${index + 1} (${i.category}, ${i.priority} priority, ${i.confidence} confidence): ${insightText(i)} Numbers: ${numbers(i.numbers)}`)),
  ].join("\n");
}

/** Keeps only notes that quote nothing the facts do not hold. A rejected note leaves the card with the rule's own next step. */
export function checkedWords(facts: InsightFacts, stats: Stats, insights: Insight[], output: z.infer<typeof schema>) {
  const all = { rule: `${periodLine(facts.days)} ${insights.map(insightText).join(" ")}`, numbers: headlineNumbers(facts, stats), links: [] };
  const summary = output.summary && quotesOnlyAlertFacts(output.summary, all) ? output.summary : null;
  const notes = new Map<string, string>();
  for (const { n, note } of output.notes) {
    const insight = insights[n - 1];
    if (!insight || !note || notes.has(insight.key)) continue;
    if (quotesOnlyAlertFacts(note, { rule: `${periodLine(facts.days)} ${insightText(insight)}`, numbers: insight.numbers, links: [] })) notes.set(insight.key, note);
  }
  return { summary, notes };
}

/** The summary's confidence rests on how many Orders the period had. */
const summaryConfidence = (orders: number): Confidence => (orders >= 100 ? "high" : orders >= 60 ? "medium" : "low");

/**
 * The 6:00 am run (Philippine time), for both periods. Called only by the scheduled job: a page open, Admin or Staff
 * never cause a model call. With too little data nothing is sent and the run says so. Rerunning the same day replaces it.
 */
export async function runInsights(sources: Sources, now = new Date(), models: () => StructuredModel[] = configuredStructuredModels) {
  const shared = await loadNowFacts(sources, now);
  const results: { days: PeriodDays; enoughData: boolean; insights: number; worded: boolean }[] = [];
  for (const days of PERIOD_DAYS) {
    const facts = await loadFacts(sources, days, now, shared);
    const insights = buildInsights(facts);
    const stats = buildStats(facts);
    const enough = enoughData(facts);
    let summary: string | null = null, model: string | null = null, sentText: string | null = null;
    if (enough) {
      sentText = promptFor(facts, stats, insights);
      const result = await structuredOutput({ schema, system: SYSTEM, prompt: sentText, models: models(), maxOutputTokens: 2500, timeoutMs: 45_000 });
      if (result.ok) {
        model = result.model;
        const words = checkedWords(facts, stats, insights, result.output);
        summary = words.summary;
        for (const insight of insights) insight.ai = words.notes.get(insight.key) ?? null;
      }
    }
    for (const insight of insights) insight.ai ??= null;
    const span = periodSpan(days, now);
    const figures = { stats, areas: facts.areas, unmapped: facts.unmapped, orders: facts.orders };
    await sources.crms`
      insert into crms.ai_insight_runs (run_day, period_days, period_start, period_end, enough_data, figures, insights, summary,
        summary_confidence, model, sent_text, system_prompt, created_at)
      values (${manilaDay(now)}, ${days}, ${span.start}, ${span.end}, ${enough}, ${sources.crms.json(figures as never)},
        ${sources.crms.json(insights as never)}, ${summary}, ${summary ? summaryConfidence(facts.orders) : null}, ${model},
        ${sentText}, ${model ? SYSTEM : null}, ${now})
      on conflict (run_day, period_days) do update set period_start = excluded.period_start, period_end = excluded.period_end,
        enough_data = excluded.enough_data, figures = excluded.figures, insights = excluded.insights, summary = excluded.summary,
        summary_confidence = excluded.summary_confidence, model = excluded.model, sent_text = excluded.sent_text,
        system_prompt = excluded.system_prompt, created_at = excluded.created_at`;
    results.push({ days, enoughData: enough, insights: insights.length, worded: model !== null });
  }
  return results;
}

interface RunRow {
  id: string; period_days: number; created_at: Date; period_start: Date; period_end: Date; enough_data: boolean;
  figures: { stats: Stats; areas: AreaFigures[]; unmapped: number; orders: number }; insights: Insight[];
  summary: string | null; summary_confidence: Confidence | null;
}

/** The newest stored run for a period, or null before the first one. Never computes anything and never calls a model. */
export async function loadLatestRun(crms: postgres.Sql, days: PeriodDays): Promise<InsightRun | null> {
  const [row] = await crms<RunRow[]>`
    select id, period_days, created_at, period_start, period_end, enough_data, figures, insights, summary, summary_confidence
    from crms.ai_insight_runs where period_days = ${days} order by run_day desc limit 1`;
  if (!row) return null;
  return {
    id: Number(row.id), days: row.period_days as PeriodDays, createdAt: row.created_at.toISOString(),
    periodStart: row.period_start.toISOString(), periodEnd: row.period_end.toISOString(), enoughData: row.enough_data,
    orders: row.figures.orders, stats: row.figures.stats, areas: row.figures.areas, unmapped: row.figures.unmapped,
    insights: row.insights, summary: row.summary, summaryConfidence: row.summary_confidence,
  };
}
