import { Skeleton } from "@/components/ui/skeleton";

import {
  bestSellersHeadline, buyersHeadline, METHOD_LABELS, paymentHeadline,
} from "./breakdown-headlines";
import { BUYERS_CARD_NOTE, PAYMENT_NOTE } from "./count-notes";
import type { BestSellers, Breakdown, MonthlyBuyers, PaymentAndReceiving } from "./breakdowns";

const CARD =
  "flex min-w-0 flex-col items-start gap-4 rounded-2xl border border-[#e6e1ee] bg-white px-5 py-5 leading-[normal]";
const TITLE = "text-[13px] font-medium text-[#71717a]";
const MUTED = "text-sm text-[#71717a]";
const EMPTY = "No Orders in this period";

const percent = (share: number | null) => (share === null ? "–" : `${Math.round(share * 100)}%`);

const shortMonth = (label: string) =>
  new Date(`${label}-01T00:00:00Z`).toLocaleString("en-PH", { month: "short", timeZone: "UTC" });

function Bar({ share, soft }: { share: number; soft?: boolean }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#f1edf6]">
      <div className={soft ? "h-full rounded-full bg-[#c9b3e0]" : "h-full rounded-full bg-[#5b2a86]"} style={{ width: `${Math.round(share * 100)}%` }} />
    </div>
  );
}

function Failed({ title }: { title: string }) {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>{title}</h2>
      <p className={MUTED}>Couldn&apos;t load</p>
    </section>
  );
}

function Empty({ title }: { title: string }) {
  return (
    <section className={CARD}>
      <h2 className={TITLE}>{title}</h2>
      <p className={MUTED}>{EMPTY}</p>
    </section>
  );
}

function CardSkeleton({ title, rows }: { title: string; rows: number }) {
  return (
    <section role="status" aria-label={`Loading ${title}`} className={CARD}>
      <h2 className={TITLE}>{title}</h2>
      <div className="flex w-full flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    </section>
  );
}

export function BestSellersCard({
  widget,
  format,
}: {
  widget: Breakdown<BestSellers>;
  format: (centavos: number) => string;
}) {
  if (!widget.ok) return <Failed title="Best sellers" />;
  if (widget.products.length === 0) return <Empty title="Best sellers" />;

  return (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold leading-snug text-[#18181b]">{bestSellersHeadline(widget.products)}</h2>
      <ol className="flex w-full flex-col gap-4">
        {widget.products.map((p) => (
          <li key={p.productName} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium text-[#18181b]">{p.productName}</span>
              <span className="text-xs font-medium text-[#71717a]">{percent(p.share)}</span>
            </div>
            <Bar share={p.share ?? 0} />
            <span className="text-xs text-[#71717a]">{`${p.units} sold · ${format(p.sales)}`}</span>
          </li>
        ))}
        {widget.remainder.sales > 0 && (
          <li className="flex items-baseline justify-between gap-2 text-xs text-[#71717a]">
            <span>Other products and Delivery fees</span>
            <span>{percent(widget.remainder.share)}</span>
          </li>
        )}
      </ol>
    </section>
  );
}

export function BestSellersSkeleton() {
  return <CardSkeleton title="Best sellers" rows={4} />;
}

export function BuyersCard({ widget }: { widget: Breakdown<MonthlyBuyers> }) {
  if (!widget.ok) return <Failed title="New vs returning Buyers" />;
  if (widget.months.length === 0) return <Empty title="New vs returning Buyers" />;

  return (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold leading-snug text-[#18181b]">{buyersHeadline(widget.months)}</h2>
      <p className="text-xs text-[#71717a]">{BUYERS_CARD_NOTE}</p>
      <ol className="flex w-full flex-col gap-3">
        {widget.months.map((m) => {
          return (
            <li key={m.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-[#18181b]">
                  {shortMonth(m.label)}
                  {m.soFar && <span className="ml-1 text-[11px] font-normal text-[#71717a]">so far</span>}
                </span>
                <span className="text-xs text-[#71717a]">{m.share === null ? "No Buyers" : `${percent(m.share)} returning`}</span>
              </div>
              <Bar share={m.share ?? 0} soft={m.soFar} />
              <span className="text-xs text-[#71717a]">{`${m.new} new · ${m.returning} returning`}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function BuyersSkeleton() {
  return <CardSkeleton title="New vs returning Buyers" rows={6} />;
}

/** Every method is listed, even at zero, so the shares are of all counted Orders. */
function section(rows: PaymentAndReceiving["payment"], known: string[]) {
  const total = rows.reduce((sum, r) => sum + r.orders, 0);

  return known.map((method) => {
    const orders = rows.find((r) => r.method === method)?.orders ?? 0;

    return { method, orders, share: total === 0 ? 0 : orders / total };
  });
}

function Section({ title, rows }: { title: string; rows: ReturnType<typeof section> }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <h3 className="text-xs font-medium text-[#71717a]">{title}</h3>
      {rows.map((r) => (
        <div key={r.method} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium text-[#18181b]">{METHOD_LABELS[r.method] ?? r.method}</span>
            <span className="text-xs font-medium text-[#71717a]">{percent(r.share)}</span>
          </div>
          <Bar share={r.share} />
          <span className="text-xs text-[#71717a]">{`${r.orders} ${r.orders === 1 ? "Order" : "Orders"}`}</span>
        </div>
      ))}
    </div>
  );
}

export function PaymentCard({ widget }: { widget: Breakdown<PaymentAndReceiving> }) {
  if (!widget.ok) return <Failed title="How customers pay" />;
  if (widget.payment.length === 0) return <Empty title="How customers pay" />;

  return (
    <section className={CARD}>
      <h2 className="text-[15px] font-semibold leading-snug text-[#18181b]">{paymentHeadline(widget.payment)}</h2>
      <p className="text-xs text-[#71717a]">{PAYMENT_NOTE}</p>
      <Section title="Payment method" rows={section(widget.payment, Object.keys(METHOD_LABELS))} />
    </section>
  );
}

export function PaymentSkeleton() {
  return <CardSkeleton title="How customers pay" rows={4} />;
}
