"use client";

import { AlertTriangle, Check, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatPesos, formatWholePesos } from "@/features/customer-profiles/format";

import { CancelPaymentDialog, MarkPaidDialog } from "./payments-actions";
import { PAYMENTS_WINDOW_DAYS, summarize, type PaymentRow, type PaymentTab } from "./payments";

const TABS: { key: PaymentTab; label: string; empty: string }[] = [
  { key: "verify", label: "For verification", empty: "No GCash Orders are waiting for a payment check." },
  { key: "cod", label: "COD to collect", empty: "No Cash on Delivery Orders are waiting to be delivered." },
  { key: "paid", label: "Paid", empty: "No payments in the last 30 days." },
  { key: "rejected", label: "Rejected", empty: "No cancelled GCash Orders in the last 30 days." },
];

const METHOD: Record<PaymentRow["method"], string> = { gcash: "GCash", "cash-on-delivery": "Cash on delivery" };

/** The Figma queue's columns; they share the table width in proportion, so the rows fill the card. */
const COLUMNS: { header: string; className: string }[] = [
  { header: "Receipt", className: "flex-[0_0_56px]" },
  { header: "Order", className: "flex-[1_1_80px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_130px]" },
  { header: "Method", className: "min-w-0 flex-[1_1_110px]" },
  { header: "Reference", className: "min-w-0 flex-[1_1_120px]" },
  { header: "Amount due", className: "flex-[1_1_100px]" },
  { header: "Uploaded", className: "flex-[1_1_90px]" },
  { header: "", className: "flex-[0_0_84px] justify-end" },
];

const HEAD = "flex items-start overflow-clip";
const CELL = "flex items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

/** "10 min ago", "3 hrs ago", "2 days ago". */
function ago(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A screenshot is a link only when the storefront gave one Staff can open; a bare pathname is not. */
const isUrl = (value: string | null): value is string => value !== null && /^https?:\/\//.test(value);

function Receipt({ order, size }: { order: PaymentRow; size: "thumb" | "full" }) {
  const screenshot = order.proof?.screenshot ?? null;
  const frame = size === "thumb" ? "h-10 w-8 rounded-sm" : "w-full rounded-lg p-6";

  return isUrl(screenshot) ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={screenshot}
      alt={`Receipt for Order #${order.id}`}
      className={size === "thumb" ? "h-10 w-8 rounded-sm border border-[#e4ddee] object-cover" : "max-h-72 w-full rounded-lg border border-[#e4ddee] object-contain"}
    />
  ) : (
    <div className={`flex flex-col items-center justify-center gap-2 border border-[#e4ddee] bg-[#f1edf6] text-xs text-[#5a5368] ${frame}`}>
      <ImageIcon aria-hidden className={size === "thumb" ? "size-4" : "size-7"} />
      <span className={size === "thumb" ? "sr-only" : undefined}>{screenshot ? `Screenshot: ${screenshot}` : "No receipt"}</span>
    </div>
  );
}

function VerifyDialog({ order, onMarkPaid }: { order: PaymentRow; onMarkPaid: () => void }) {
  const { reference, submittedAt } = order.proof!;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" className="h-auto rounded-lg px-3 py-1.5 text-[13px] leading-[normal] shadow-none">
          Review
        </Button>
      </DialogTrigger>
      <DialogContent className="flex w-[calc(100%-2rem)] max-w-[820px] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0! leading-[normal] shadow-[0_20px_48px_rgb(0_0_0/0.2)] sm:rounded-2xl md:max-w-[820px] lg:max-w-[820px]">
        <div className="space-y-1 border-b border-[#f0f0f2] pt-5 pr-12 pb-4 pl-6">
          <DialogTitle className="text-lg font-semibold leading-[normal] text-foreground">
            Verify payment · Order #{order.id}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-[#71717a]">
            {order.customer.name} · GCash · uploaded {formatDate(submittedAt)}
          </DialogDescription>
        </div>
        <div className="grid gap-6 px-6 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Receipt order={order} size="full" />
          <dl className="space-y-3 text-sm text-[#1f1a2e]">
            <div className="rounded-lg bg-[#fafafa] px-3.5 py-3">
              <dt className="text-xs text-[#71717a]">Amount due</dt>
              <dd className="text-[22px] font-bold">{formatPesos(order.total)}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-[13px] font-medium text-[#27272a]">Reference no.</dt>
              <dd className="rounded-lg border border-[#e4e4e7] px-3 py-2.5">{reference ?? "—"}</dd>
            </div>
            <p className="rounded-lg bg-[#eff6ff] px-3 py-2.5 text-[13px] text-[#1d4ed8]">
              Marking paid tells the Customer their payment was received. Cancelling cancels the Order; there is
              no asking for another receipt.
            </p>
          </dl>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f2] bg-[#fafafa] px-6 py-3.5">
          <CancelPaymentDialog id={order.id} />
          <MarkPaidDialog id={order.id} onMarkPaid={onMarkPaid} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, note, noteClassName }: { label: string; value: string; note: string; noteClassName: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
      <p className="text-[13px] font-medium text-[#71717a]">{label}</p>
      <p className="text-2xl font-semibold text-[#18181b]">{value}</p>
      <p className={`text-xs ${noteClassName}`}>{note}</p>
    </div>
  );
}

const STEPS: { title: string; note: string }[] = [
  { title: "Customer pays", note: "GCash, outside the website" },
  { title: "Sends the proof", note: "A GCash reference number and, optionally, a screenshot" },
  { title: "Staff check it", note: "Amount, reference number, date and our account" },
  { title: "Mark paid", note: "The Order becomes paid and the Customer is told" },
  { title: "Or cancel", note: "The Order is cancelled; there is no asking for another receipt" },
];

function Row({ order, tab, now, onMarkPaid }: { order: PaymentRow; tab: PaymentTab; now: Date; onMarkPaid: () => void }) {
  const cells = [
    order.proof ? <Receipt order={order} size="thumb" /> : <span className="text-[#a1a1aa]">—</span>,
    <Link key="o" href={`/orders/${order.id}`} className="font-medium text-[#5b2a86]">#{order.id}</Link>,
    <span key="c" className="truncate pr-3">{order.customer.name}</span>,
    METHOD[order.method],
    <span key="r" className="truncate pr-3">{order.proof ? (order.proof.reference ?? "—") : "—"}</span>,
    <span key="a" className="flex items-center gap-1.5">
      {formatPesos(order.total)}
      {tab === "paid" && <Check aria-label="Paid" className="size-3.5 text-[#16a34a]" />}
      {tab === "rejected" && <AlertTriangle aria-label="Cancelled" className="size-3.5 text-[#dc2626]" />}
    </span>,
    <span key="u" className="text-[13px] text-[#71717a]">{order.proof ? ago(order.proof.submittedAt, now) : "—"}</span>,
    tab === "verify" ? (
      <VerifyDialog order={order} onMarkPaid={onMarkPaid} />
    ) : (
      <Link key="v" href={`/orders/${order.id}`} className="text-[13px] font-medium text-[#5b2a86]">View</Link>
    ),
  ];

  return (
    <div data-payment-row className="flex items-center border-b border-[#efebf4] py-2.5">
      {cells.map((cell, i) => (
        <div key={COLUMNS[i].header || "action"} className={`${CELL} ${COLUMNS[i].className}`}>
          {cell}
        </div>
      ))}
    </div>
  );
}

/**
 * The Payments page: what is waiting, what has come in and what was turned down, all derived from one
 * list of Orders. Mark paid moves its Order to Paid and adjusts the counts at once, and rolls back
 * with the reason if the storefront refuses (the Customer is only emailed once it accepts).
 */
export function PaymentsView({ rows: served, now }: { rows: PaymentRow[]; now: Date }) {
  const [rows, markPaid] = useOptimistic(served, (current, id: number) =>
    current.map((r) => (r.id === id ? { ...r, status: "paid" } : r)),
  );
  const [tab, setTab] = useState<PaymentTab>("verify");
  const summary = summarize(rows, now);
  const shown = summary.tabs[tab];
  const empty = TABS.find((t) => t.key === tab)!.empty;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="flex shrink-0 gap-4">
        <Stat
          label="Receipts to check"
          value={String(summary.tabs.verify.length)}
          note={summary.oldestProof ? `Oldest uploaded ${ago(summary.oldestProof, now)}` : "Nothing waiting"}
          noteClassName="text-[#8a5a00]"
        />
        <Stat
          label={`Paid (${PAYMENTS_WINDOW_DAYS} days)`}
          value={formatWholePesos(summary.paid.centavos)}
          note={`${summary.paid.count} payment${summary.paid.count === 1 ? "" : "s"}`}
          noteClassName="text-[#71717a]"
        />
        <Stat
          label="COD to collect"
          value={formatWholePesos(summary.toCollect.centavos)}
          note={`${summary.toCollect.count} order${summary.toCollect.count === 1 ? "" : "s"} · ${formatWholePesos(summary.collected.centavos)} collected`}
          noteClassName="text-[#1d4f91]"
        />
        <Stat
          label={`Rejected (${PAYMENTS_WINDOW_DAYS} days)`}
          value={String(summary.rejected.count)}
          note={`${formatWholePesos(summary.rejected.centavos)} cancelled after proof`}
          noteClassName="text-[#9a3412]"
        />
      </div>

      <div role="tablist" className="flex shrink-0 gap-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium leading-[normal] ${tab === key ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#71717a] hover:bg-[#f6f2fa]"}`}
          >
            {label} {summary.tabs[key].length}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-[#e6e1ee] bg-white p-5">
          {shown.length === 0 ? (
            <p className="p-3 text-center text-sm text-[#6e6680]">{empty}</p>
          ) : (
            <div className="min-w-[860px]">
              <div className="sticky top-0 z-10 flex items-center border-b border-[#efebf4] bg-white pt-1 pb-2 text-xs font-medium leading-[normal] text-[#6e6680]">
                {COLUMNS.map((col) => (
                  <div key={col.header || "action"} className={`${HEAD} ${col.className}`}>
                    {col.header}
                  </div>
                ))}
              </div>
              {shown.map((order) => (
                <Row key={order.id} order={order} tab={tab} now={now} onMarkPaid={() => markPaid(order.id)} />
              ))}
            </div>
          )}
        </div>
        <div className="hidden w-[340px] shrink-0 flex-col gap-4 overflow-auto xl:flex">
          <section className="flex flex-col gap-3.5 rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
            <h2 className="text-[15px] font-semibold text-[#18181b]">How a payment is confirmed</h2>
            {STEPS.map(({ title, note }, i) => (
              <div key={title} className="flex items-start gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#efe6f8] text-xs font-semibold text-[#5b2a86]">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-sm font-medium text-[#18181b]">{title}</p>
                  <p className="text-xs text-[#71717a]">{note}</p>
                </div>
              </div>
            ))}
          </section>
          <section className="flex flex-col gap-3.5 rounded-xl border border-[#e6e1ee] bg-white p-5 leading-[normal]">
            <h2 className="text-[15px] font-semibold text-[#18181b]">Cash on delivery</h2>
            <p className="text-[13px] text-[#71717a]">
              No receipt needed. The Order ships as COD to collect and counts as collected once it is delivered.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
