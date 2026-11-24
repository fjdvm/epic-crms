import Link from "next/link";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatPesos } from "@/features/customer-profiles/format";
import { STAGE_LABELS, type Stage } from "@/features/customer-profiles/rules";
import { METHOD_LABELS } from "@/features/dashboard/breakdown-headlines";

import type { CustomerInsights } from "./customers";
import type { OperationsInsights, StockCover } from "./operations";
import type { OrderInsights } from "./orders";
import type { PaymentInsights } from "./payments";

const CARD = "flex min-w-0 flex-col gap-3 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-5 leading-[normal]";
const TITLE = "text-[13px] font-medium text-[#71717a]";
const MUTED = "text-sm text-[#71717a]";
const GRID = "grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3";

export function formatHours(hours: number | null): string {
  if (hours === null) return "–";
  if (hours * 60 < 1) return "under 1 min";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round(hours / 24)} days`;
}
const percent = (part: number, whole: number) => (whole === 0 ? "–" : `${Math.round((part / whole) * 100)}%`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-PH")} ${n === 1 ? one : many}`;
const STAGES_IN_ORDER: Stage[] = ["new", "first-order", "repeat", "at-risk", "lost"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section aria-label={title} className={`${CARD} ${wide ? "md:col-span-2" : ""}`}>
      <h3 className={TITLE}>{title}</h3>
      {children}
    </section>
  );
}

function Figures({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-[#71717a]">{label}</dt>
          <dd className="text-base font-semibold tabular-nums text-[#18181b]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Bars({ rows, empty }: { rows: { label: string; value: number; note?: string }[]; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0 || max === 0) return <p className={MUTED}>{empty}</p>;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.label} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-[#18181b]">{row.label}</span>
            <span className="tabular-nums text-[#52525b]">{row.note ?? row.value.toLocaleString("en-PH")}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#f1edf6]">
            <div className="h-full rounded-full bg-[#5b2a86]" style={{ width: `${row.value === 0 ? 0 : Math.max(2, Math.round((row.value / max) * 100))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PanelUnavailable() {
  return <p className={`${MUTED} rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4`}>Couldn&apos;t load these figures. Reload the page to try again.</p>;
}

export function PanelSkeleton() {
  return (
    <div role="status" aria-label="Loading figures" className={GRID}>
      {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}
    </div>
  );
}

const FUNNEL_LABELS: Record<OrderInsights["funnel"][number]["key"], string> = {
  placed: "Placed",
  paid: "Paid (Cash on Delivery once it is being prepared)",
  handedOver: "Sent out or picked up",
  delivered: "Delivered or picked up",
};

/** Busiest weekday and hour, for the headline above the heatmap. */
export function busiest(peak: number[][]): { day: number; hour: number; count: number } | null {
  let best: { day: number; hour: number; count: number } | null = null;
  peak.forEach((hours, day) => hours.forEach((count, hour) => { if (count > 0 && (!best || count > best.count)) best = { day, hour, count }; }));
  return best;
}

function Heatmap({ peak }: { peak: number[][] }) {
  const max = Math.max(0, ...peak.flat());
  const top = busiest(peak);
  if (!top) return <p className={MUTED}>No Orders in this period</p>;
  const shade = (n: number) => (n === 0 ? "#f4f4f5" : ["#e4d8f1", "#c9b3e0", "#a985cf", "#8256b3", "#5b2a86"][Math.min(4, Math.floor((n / max) * 5))]);
  return (
    <>
      <p className="text-sm text-[#18181b]">Busiest: {DAYS[top.day]} around {hourLabel(top.hour)} ({plural(top.count, "Order")})</p>
      <div aria-hidden="true" className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-0.5 text-[10px] text-[#71717a]">
        <span />
        {Array.from({ length: 24 }, (_, h) => <span key={h} className="overflow-visible whitespace-nowrap">{h % 6 === 0 ? hourLabel(h) : ""}</span>)}
        {peak.map((hours, day) => [
          <span key={`d${day}`}>{DAYS[day]}</span>,
          ...hours.map((count, hour) => (
            <span key={`${day}:${hour}`} title={`${DAYS[day]} ${hourLabel(hour)}: ${plural(count, "Order")}`}
              className="aspect-square rounded-sm" style={{ background: shade(count) }} />
          )),
        ])}
      </div>
      <table className="sr-only">
        <caption>Orders placed by weekday and hour, Philippine time</caption>
        <thead><tr><th scope="col">Day</th>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col">{hourLabel(h)}</th>)}</tr></thead>
        <tbody>
          {peak.map((hours, day) => (
            <tr key={day}><th scope="row">{DAYS[day]}</th>{hours.map((count, hour) => <td key={hour}>{count}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function OrdersPanel({ data }: { data: OrderInsights }) {
  const placed = data.funnel[0].count;
  return (
    <div className={GRID}>
      <Card title="How far Orders got" wide>
        {placed === 0 ? <p className={MUTED}>No Orders in this period</p> : (
          <>
            <ol className="flex flex-col gap-2.5">
              {data.funnel.map((step) => (
                <li key={step.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 text-[#18181b]">{FUNNEL_LABELS[step.key]}</span>
                    {step.medianHours !== null && <span className="text-xs text-[#71717a]">half within {formatHours(step.medianHours)}</span>}
                    <span className="w-24 text-right tabular-nums text-[#52525b]">{step.count} · {percent(step.count, placed)}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f1edf6]">
                    <div className="h-full rounded-full bg-[#5b2a86]" style={{ width: `${Math.round((step.count / placed) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ol>
            <p className={MUTED}>{plural(data.cancelled, "Order")} cancelled ({percent(data.cancelled, placed)}).</p>
          </>
        )}
      </Card>
      <Card title="When Customers order">
        <Heatmap peak={data.peak} />
      </Card>
      <Card title="Why Orders were cancelled">
        <Bars rows={data.cancelReasons.map((r) => ({ label: r.label, value: r.count }))} empty="No cancellations in this period" />
      </Card>
      <Card title="Why deliveries failed">
        <Bars rows={data.failedReasons.map((r) => ({ label: r.label, value: r.count }))} empty="No failed deliveries in this period" />
      </Card>
      <Card title="Often bought together">
        {data.pairs.length === 0 ? <p className={MUTED}>No Orders with two different products yet</p> : (
          <ul className="flex flex-col gap-2 text-sm">
            {data.pairs.map((p) => (
              <li key={`${p.a}|${p.b}`} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-[#18181b]">{p.a} + {p.b}</span>
                <span className="tabular-nums text-[#52525b]">{plural(p.orders, "Order")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const AGE_LABELS = { "under-1-day": "Under 1 day", "1-to-3-days": "1 to 3 days", "over-3-days": "Over 3 days" } as const;

export function PaymentsPanel({ data }: { data: PaymentInsights }) {
  const { verify, proofs, refunds, nearFreeDelivery } = data;
  return (
    <div className={GRID}>
      <Card title="Payment methods">
        <Bars
          rows={data.methods.map((m) => ({
            label: METHOD_LABELS[m.method] ?? m.method, value: m.orders,
            note: `${plural(m.orders, "Order")} · ${formatPesos(m.sales)}${m.previousOrders > 0 ? ` · ${m.orders >= m.previousOrders ? "▲" : "▼"} ${Math.abs(Math.round(((m.orders - m.previousOrders) / m.previousOrders) * 100))}%` : ""}`,
          }))}
          empty="No paid Orders in this period"
        />
      </Card>
      <Card title="Time to check a payment proof">
        <Figures rows={[
          ["Half within", formatHours(verify.medianHours)],
          ["Slowest", formatHours(verify.slowestHours)],
          ["Weekdays (half within)", formatHours(verify.weekdayMedianHours)],
          ["Weekends (half within)", formatHours(verify.weekendMedianHours)],
        ]} />
        <p className={MUTED}>From the first proof to Paid, for {plural(verify.orders, "Order")} marked Paid in the period.</p>
      </Card>
      <Card title="Payment proofs">
        <Figures rows={[
          ["Sent", proofs.submitted.toLocaleString("en-PH")],
          ["Asked for a new one", `${proofs.rejected} (${percent(proofs.rejected, proofs.submitted)})`],
          ["Reference used on another Order", proofs.reusedReference.toLocaleString("en-PH")],
        ]} />
      </Card>
      <Card title="Waiting for payment right now">
        <Bars rows={data.unpaid.map((b) => ({ label: AGE_LABELS[b.key], value: b.orders, note: `${plural(b.orders, "Order")} · ${formatPesos(b.value)}` }))}
          empty="No Orders waiting for an online payment" />
        <Link href="/payments" prefetch className="text-sm font-medium text-[#5b2a86] hover:underline">Open Payments</Link>
      </Card>
      <Card title="Refunds">
        <Figures rows={[["Refunded", refunds.count.toLocaleString("en-PH")], ["Amount", formatPesos(refunds.amount)]]} />
        <Bars rows={refunds.reasons.map((r) => ({ label: r.label, value: r.count }))} empty="No refunds in this period" />
      </Card>
      <Card title="Close to free delivery">
        {nearFreeDelivery.eligible === 0 ? <p className={MUTED}>No Orders paid a Delivery fee under a free-delivery threshold</p> : (
          <p className="text-sm text-[#18181b]">
            {percent(nearFreeDelivery.orders, nearFreeDelivery.eligible)} of the {plural(nearFreeDelivery.eligible, "Order")} that paid a Delivery fee
            were within 20% of free delivery.
          </p>
        )}
      </Card>
    </div>
  );
}

export function CustomersPanel({ data, now }: { data: CustomerInsights; now: Date }) {
  const days = (date: Date) => Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  return (
    <div className={GRID}>
      <Card title="Customers by stage">
        <Bars rows={STAGES_IN_ORDER.map((s) => ({ label: STAGE_LABELS[s], value: data.stages[s] }))} empty="No verified Customers yet" />
        <Link href="/customer-profiles?stage=at-risk" prefetch className="text-sm font-medium text-[#5b2a86] hover:underline">See At risk Customers</Link>
      </Card>
      <Card title="Coming back">
        <Figures rows={[
          ["Bought more than once", data.repeatRate === null ? "–" : `${Math.round(data.repeatRate * 100)}%`],
          ["Days between Orders (half within)", data.medianDaysBetweenOrders === null ? "–" : String(data.medianDaysBetweenOrders)],
          ["Bought in the period", data.buyersInPeriod.toLocaleString("en-PH")],
          ["…of them returning", percent(data.returningBuyersInPeriod, data.buyersInPeriod)],
          ["Loyal Customers gone quiet", data.loyalAtRisk.toLocaleString("en-PH")],
          ["Senior/PWD Orders", data.seniorPwdShare === null ? "–" : `${Math.round(data.seniorPwdShare * 100)}%`],
        ]} />
      </Card>
      <Card title="Lifetime spend">
        <Bars rows={data.valueBuckets.map((b) => ({ label: b.label, value: b.customers, note: plural(b.customers, "Customer") }))} empty="No Customer has bought yet" />
      </Card>
      <Card title="Top Customers by lifetime spend" wide>
        {data.top.length === 0 ? <p className={MUTED}>No Customer has bought yet</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[#71717a]">
              <tr><th className="py-1 font-normal">Customer</th><th className="py-1 text-right font-normal">Orders</th><th className="py-1 text-right font-normal">Spent</th><th className="py-1 text-right font-normal">Last Order</th></tr>
            </thead>
            <tbody>
              {data.top.map((c) => (
                <tr key={c.id} className="border-t border-[#f1edf6]">
                  <td className="max-w-0 truncate py-1.5 pr-2"><Link href={`/customer-profiles/${encodeURIComponent(c.id)}`} prefetch={false} className="text-[#5b2a86] hover:underline">{c.name}</Link></td>
                  <td className="py-1.5 text-right tabular-nums">{c.orders}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatPesos(c.spent)}</td>
                  <td className="py-1.5 text-right tabular-nums text-[#52525b]">{days(c.lastOrder) === 0 ? "Today" : `${plural(days(c.lastOrder), "day")} ago`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

export interface OperationsShown { fulfilment: boolean; returns: boolean; tickets: boolean; feedback: boolean; stock: boolean }

export function OperationsPanel({ data, stock, show }: { data: OperationsInsights | null; stock: StockCover[] | null; show: OperationsShown }) {
  return (
    <div className={GRID}>
      {show.stock && (
        <Card title="May run out soon">
          {stock === null ? <p className={MUTED}>Couldn&apos;t read the stock count</p> : stock.length === 0 ? (
            <p className={MUTED}>Nothing looks like running out within 5 days at the last two weeks&apos; sales.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {stock.map((s) => (
                <li key={s.name} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 text-[#18181b]">{s.name}</span>
                  <span className="tabular-nums text-[#52525b]">{s.available} left · ~{s.daysLeft === 0 ? "under 1 day" : plural(s.daysLeft, "day")}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[#a1a1aa]">Stock is counted by the factory&apos;s IMS; nothing here changes it.</p>
        </Card>
      )}
      {data === null ? <PanelUnavailable /> : (
        <>
          {show.fulfilment && (
            <Card title="Fulfilment">
              <Figures rows={[["Sent out", data.fulfilment.dispatched.toLocaleString("en-PH")], ["Paid to sent out (half within)", formatHours(data.fulfilment.medianDispatchHours)]]} />
              <Bars
                rows={data.fulfilment.couriers.map((c) => ({ label: c.courier, value: c.dispatched, note: `${plural(c.dispatched, "Order")} · ${percent(c.failed, c.dispatched)} failed` }))}
                empty="No Orders sent out in this period"
              />
            </Card>
          )}
          {show.returns && (
            <Card title="Returns">
              <Figures rows={[
                ["Requested", data.returns.requested.toLocaleString("en-PH")],
                ["Back to stock", formatPesos(data.returns.restockedValue)],
                ["Written off", formatPesos(data.returns.writtenOffValue)],
              ]} />
              <Bars rows={data.returns.products.map((p) => ({ label: p.product, value: p.returned, note: `${p.returned} of ${p.sold} sold` }))}
                empty="No returns in this period" />
            </Card>
          )}
          {show.tickets && (
            <Card title="Tickets">
              <Figures rows={[
                ["Opened", data.tickets.opened.toLocaleString("en-PH")],
                ["Resolved", data.tickets.resolved.toLocaleString("en-PH")],
                ["Resolved (half within)", formatHours(data.tickets.medianResolveHours)],
                ["Customer rating", data.tickets.averageRating === null ? "–" : `${data.tickets.averageRating} / 5`],
              ]} />
              <Bars rows={data.tickets.categories.map((c) => ({ label: c.label, value: c.count }))} empty="No Tickets opened in this period" />
              <Link href="/tickets/reports" prefetch className="text-sm font-medium text-[#5b2a86] hover:underline">Open the Ticket report</Link>
            </Card>
          )}
          {show.feedback && (
            <Card title="Feedback">
              <Figures rows={[
                ["Ratings", data.feedback.ratings.toLocaleString("en-PH")],
                ["Average", data.feedback.average === null ? "–" : `${data.feedback.average} / 5`],
                ["Negative", data.feedback.negativeShare === null ? "–" : `${Math.round(data.feedback.negativeShare * 100)}%`],
              ]} />
              {data.feedback.lowestProducts.length > 0 && (
                <>
                  <h4 className="text-xs text-[#71717a]">Lowest rated (3 or more ratings)</h4>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {data.feedback.lowestProducts.map((p) => (
                      <li key={p.product} className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-[#18181b]">{p.product}</span>
                        <span className="tabular-nums text-[#52525b]">{p.average} / 5 · {plural(p.ratings, "rating")}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
