import { createBrandedPdf, manilaTimestamp } from "@/lib/export/pdf-template";

import { CATEGORY_LABELS, CONFIDENCE_LABELS, PRIORITY_LABELS, type Insight, type Stats } from "./insights";
import type { InsightRun } from "./run";

const STAT_LABELS: [keyof Stats, string][] = [
  ["orders", "Orders"], ["lateOrFailed", "Late or failed"], ["returns", "Returns & damage"], ["openTickets", "Open tickets"], ["stockWatch", "Stock watch"],
];

/** The page as a PDF, from the stored run: the same figures and the same cards the person sees. Nothing is worked out again. */
export async function insightsPdf(run: InsightRun, insights: Insight[], stats: Partial<Stats>, now: Date): Promise<Buffer> {
  const pdf = await createBrandedPdf({ title: "AI insights", subtitle: `Last ${run.days} days · updated ${manilaTimestamp.format(new Date(run.createdAt))}`, now });
  pdf.line("Suggestions only. The AI explains figures worked out in code; a person decides and acts. Nothing here changed an Order, stock, payment, Ticket or Customer.", true);

  pdf.heading(run.days === 7 ? "This week in brief" : "These 30 days in brief");
  if (!run.enoughData) pdf.line(`Not enough data: ${run.orders} Orders in the period. Insights start at about 30, so none were made.`);
  else pdf.line(run.summary ? `${run.summary} (AI-written${run.summaryConfidence ? `, ${CONFIDENCE_LABELS[run.summaryConfidence].toLowerCase()}` : ""})` : "The AI summary was not available for this run.", !run.summary);

  pdf.heading("Figures");
  pdf.table(["Figure", "Value", "Note"],
    STAT_LABELS.filter(([key]) => stats[key]).map(([key, label]) => [label, stats[key]!.value === null ? "—" : String(stats[key]!.value), stats[key]!.note]),
    { widths: [0.3, 0.15, 0.55], right: [1] });

  const cities = run.areas.flatMap((a) => a.cities).filter((c) => c.orders > 0).sort((a, b) => b.orders - a.orders).slice(0, 10);
  if (run.enoughData && cities.length) {
    pdf.heading("Top areas");
    pdf.table(["Area", "Orders", "Before", "Late or failed", "Returns", "Complaints"],
      cities.map((c) => [c.name, String(c.orders), String(c.previousOrders), String(c.lateOrFailed), String(c.returned), String(c.complaints)]),
      { widths: [0.3, 0.12, 0.12, 0.18, 0.14, 0.14], right: [1, 2, 3, 4, 5] });
  }

  pdf.heading("Insights to look at");
  if (!insights.length) pdf.line(run.enoughData ? "Nothing needs a look right now." : "No insights yet.", true);
  for (const insight of insights) {
    pdf.room(110);
    pdf.doc.fontSize(11);
    pdf.line(`${insight.headline}`);
    pdf.line(`${CATEGORY_LABELS[insight.category]} · ${PRIORITY_LABELS[insight.priority]} priority · ${CONFIDENCE_LABELS[insight.confidence]}`, true);
    pdf.line(`Based on: ${insight.basedOn}`);
    if (insight.ai) pdf.line(`Why and what to do (AI-written, check before acting): ${insight.ai}`);
    pdf.line(`Suggested next step: ${insight.nextStep}`);
    if (insight.records.length) pdf.line(`Records: ${insight.records.map((r) => `${r.type === "order" ? "Order" : r.type === "ticket" ? "Ticket" : "Return"} #${r.id}`).join(", ")}`, true);
    pdf.doc.moveDown(0.4);
  }
  return pdf.finish();
}
