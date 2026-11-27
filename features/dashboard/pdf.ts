import { createBrandedPdf, manilaDate as date, manilaTimestamp as timestamp, BRAND } from "@/lib/export/pdf-template";

import { BUYERS_CARD_NOTE, buyersCounted, NO_ORDERS_STAGE_LABEL, PAYMENT_NOTE, STAGES_NOTE } from "./count-notes";
import type { DashboardFigures, Widget } from "./figures";
import type { Attention } from "./attention";
import { PERIOD_LABELS, type Period, type PeriodPreset } from "./period";

const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 });
const money = (centavos: number) => pesos.format(centavos / 100);

/** The PDF renders only the permitted figures returned by the shared loader; it never queries data. */
export async function dashboardPdf(
  figures: DashboardFigures,
  { period, preset, now }: { period: Period; preset: PeriodPreset; now: Date },
): Promise<Buffer> {
  const pdf = await createBrandedPdf({ title: "Dashboard", now });
  const { doc, width, room, line } = pdf;
  doc.fillColor(BRAND.muted).fontSize(10).text(`${PERIOD_LABELS[preset]}: ${date.format(period.start)} - ${date.format(new Date(period.end.getTime() - 1))}`, 44, doc.y);
  doc.text("Philippine Time (UTC+8)");
  doc.text(`Generated: ${timestamp.format(now)}`);
  doc.moveDown();
  const section = (title: string, widget: { ok: boolean } | undefined) => {
    if (!widget) return false;
    room(84);
    doc.moveDown(0.6);
    doc.fillColor(BRAND.purple).fontSize(13).text(title, 44, doc.y, { width });
    doc.moveDown(0.35);
    if (!widget.ok) line("Couldn't load - this widget is unavailable in this export.", true);
    return widget.ok;
  };
  const tile = <T>(title: string, widget: Widget<T> | undefined, format: (value: T) => string) => {
    if (section(title, widget) && widget?.ok) {
      line(format(widget.current));
      line(`Previous period: ${format(widget.previous)}`, true);
    }
  };
  const percent = (share: number | null) => share === null ? "No Orders in this period" : `${Math.round(share * 100)}%`;
  const bar = (label: string, value: number, maximum: number) => {
    line(label);
    room(15);
    const y = doc.y;
    doc.rect(44, y, width, 5).fill(BRAND.tint);
    if (maximum > 0 && value > 0) doc.rect(44, y, width * Math.min(value / maximum, 1), 5).fill(BRAND.purple);
    doc.y = y + 15;
  };

  tile("Sales", figures.sales, money);
  tile("Orders", figures.orders, ({ placed, counted }) => `${placed} placed - ${counted} counted in Sales`);
  tile("Average order", figures.averageOrder, money);
  tile("Returning Buyers", figures.returningBuyers, (value) => `${percent(value.share)} (${buyersCounted(value.buyers)})`);
  tile("Average rating", figures.averageRating, (value) => value.average === null
    ? "No Feedback yet" : `${value.average.toFixed(1)} stars - From ${value.count} Feedback`);

  const monthlySales = figures.monthlySales;
  if (section("Sales - last six months", monthlySales) && monthlySales?.ok) {
    const maximum = Math.max(0, ...monthlySales.months.map((month) => month.sales));
    for (const month of monthlySales.months) {
      bar(`${month.label}${month.soFar ? " (so far)" : ""}: ${money(month.sales)}`, month.sales, maximum);
    }
  }

  const queueLabels: Record<keyof Attention, string> = {
    paymentProofs: "Payment proofs to check", deliveryFees: "Delivery fees to quote", overdueOrders: "Orders Overdue to confirm", cancelRequests: "Cancel requests to decide", paymentReviews: "Payment reviews for a Manager",
    ordersToPack: "Orders to pack", codToCollect: "COD to collect", openTickets: "Open Tickets",
    returns: "Returns to decide", lowFeedback: "Low Feedback to review",
  };
  const attention = figures.attention;
  if (attention && Object.keys(attention).length > 0) {
    section("Needs attention - as of generation time", { ok: true });
    for (const key of Object.keys(queueLabels) as (keyof Attention)[]) {
      const queue = attention[key];
      if (!queue) continue;
      const title = queueLabels[key];
      if (!queue.ok) { line(`${title}: Couldn't load`, true); continue; }
      const extra = "centavos" in queue ? ` - ${money(queue.centavos)}`
        : "overdue" in queue ? ` - ${queue.overdue} Overdue` : "";
      line(`${title}: ${queue.count}${extra}`, queue.count === 0);
      if (queue.oldest) {
        const hours = Math.max(0, Math.floor((now.getTime() - queue.oldest.getTime()) / 3_600_000));
        line(`Oldest waiting: ${hours} hours (since ${timestamp.format(queue.oldest)} Philippine Time)`, true);
      }
    }
  }

  const best = figures.bestSellers;
  if (section("Best-selling products", best) && best?.ok) {
    if (best.products.length === 0) line("No Orders in this period", true);
    const maximum = Math.max(0, ...best.products.map((product) => product.sales));
    for (const product of best.products) {
      bar(`${product.productName}: ${money(product.sales)} - ${product.units} units - ${percent(product.share)} of Sales`, product.sales, maximum);
    }
    line(`Other products and Delivery fees: ${money(best.remainder.sales)} (${percent(best.remainder.share)})`, true);
  }

  const buyers = figures.monthlyBuyers;
  if (section("New vs returning Buyers - last six months", buyers) && buyers?.ok) {
    line(BUYERS_CARD_NOTE, true);
    if (buyers.months.length === 0) line("No Orders in this period", true);
    const maximum = Math.max(0, ...buyers.months.map((month) => month.new + month.returning));
    for (const month of buyers.months) {
      bar(`${month.label}${month.soFar ? " (so far)" : ""}: ${month.new} New / ${month.returning} Returning (${percent(month.share)})`, month.new + month.returning, maximum);
    }
  }

  const payment = figures.paymentAndReceiving;
  if (section("How customers pay", payment) && payment?.ok) {
    const labels: Record<string, string> = { gcash: "GCash", maya: "Maya", "bank-transfer": "Bank transfer", "cash-on-delivery": "Cash on Delivery" };
    line(PAYMENT_NOTE, true);
    const rows = payment.payment;
    if (rows.length === 0) line("No Orders in this period", true);
    const maximum = Math.max(0, ...rows.map((row) => row.orders));
    for (const row of rows) bar(`${labels[row.method] ?? row.method}: ${row.orders} Orders - ${money(row.sales)}`, row.orders, maximum);
  }

  const stages = figures.customersByStage;
  if (section("Customers by Stage - As of today", stages) && stages?.ok) {
    line(STAGES_NOTE, true);
    const labels = { new: NO_ORDERS_STAGE_LABEL, "first-order": "First order", repeat: "Repeat", "at-risk": "At risk", lost: "Lost" };
    const maximum = Math.max(0, ...Object.values(stages.counts));
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) {
      bar(`${labels[key]}: ${stages.counts[key]}`, stages.counts[key], maximum);
    }
  }
  const atRisk = figures.atRisk;
  if (section("At risk Customers - As of today", atRisk) && atRisk?.ok) line(`${atRisk.count} At risk Customers`);
  tile("New Customers", figures.newCustomers, String);
  const leads = figures.unverifiedLeads;
  if (section("Unverified Leads - As of today", leads) && leads?.ok) line(`${leads.count} Leads (separate from Customers)`);

  if (!Object.values(figures).some((widget) => widget && Object.keys(widget).length > 0)) {
    line("Your Modules do not include any data the Dashboard summarises.", true);
  }
  return pdf.finish();
}
