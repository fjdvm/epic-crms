import { createBrandedPdf, manilaTimestamp } from "@/lib/export/pdf-template";

import { CATEGORY_LABELS, CONFIDENCE_LABELS, PRIORITY_LABELS, type Insight, type Stats } from "./insights";
import { favouriteByPlace, formatMetric, productName, rankProducts } from "./products";
import type { InsightRun } from "./run";

const STAT_LABELS: [keyof Stats, string][] = [
  ["orders", "Orders"], ["lateOrFailed", "Late or failed"], ["returns", "Returns & damage"], ["openTickets", "Open tickets"], ["stockWatch", "Stock watch"],
];

/** The page as a PDF, from the stored run: the same figures and the same cards the person sees. Nothing is worked out again. */
export async function insightsPdf(run: InsightRun, insights: Insight[], stats: Partial<Stats>, now: Date,
  access: { products: boolean; ratings: boolean } = { products: false, ratings: false }): Promise<Buffer> {
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
  const products = access.products && run.products ? run.products : null;
  if (run.enoughData && cities.length) {
    pdf.heading("Top areas");
    if (products) {
      // The favourite is the product with the most units sold in the city, sizes counted together.
      const favourites = favouriteByPlace(products, { scope: "city", bySize: false, metric: "units" });
      pdf.table(["Area", "Orders", "Before", "Late or failed", "Returns", "Complaints", "Favourite product"],
        cities.map((c) => [c.name, String(c.orders), String(c.previousOrders), String(c.lateOrFailed), String(c.returned), String(c.complaints),
          favourites.get(c.key)?.product ?? "—"]),
        { widths: [0.2, 0.09, 0.09, 0.13, 0.1, 0.12, 0.27], right: [1, 2, 3, 4, 5] });
    } else {
      pdf.table(["Area", "Orders", "Before", "Late or failed", "Returns", "Complaints"],
        cities.map((c) => [c.name, String(c.orders), String(c.previousOrders), String(c.lateOrFailed), String(c.returned), String(c.complaints)]),
        { widths: [0.3, 0.12, 0.12, 0.18, 0.14, 0.14], right: [1, 2, 3, 4, 5] });
    }
  }

  const ranked = products && run.enoughData ? rankProducts(products, { scope: "all", bySize: false, metric: "units" }).slice(0, 5) : [];
  if (ranked.length) {
    pdf.heading("Top products");
    const head = ["#", "Product", "Units sold", "Sales value", "Orders", ...(access.ratings ? ["Rating"] : [])];
    pdf.table(head,
      ranked.map((p, i) => [String(i + 1), productName(p), formatMetric(p, "units"), formatMetric(p, "value"), formatMetric(p, "orders"),
        ...(access.ratings ? [formatMetric(p, "rating")] : [])]),
      access.ratings
        ? { widths: [0.06, 0.34, 0.13, 0.17, 0.11, 0.19], right: [2, 3, 4] }
        : { widths: [0.06, 0.44, 0.15, 0.2, 0.15], right: [2, 3, 4] });
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
