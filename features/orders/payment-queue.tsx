"use client";

import { AlertTriangle, Check, Image as ImageIcon } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatPesos, formatWholePesos } from "@/features/customer-profiles/format";

import { ProofAccountView, ProofBadge, proofOutcome } from "./proof-account";
import { PaymentProofChecksView } from "./payment-proof-checks-view";
import { ProofReadFindings } from "./proof-read-view";
import { CELL, COLUMNS, HEAD, STEPS, TABS } from "./payments-layout";
import type { ShopRole } from "@/lib/portal/roles";
import { ApproveAnywayDialog, CancelPaymentDialog, MarkPaidDialog, RejectProofDialog } from "./payments-actions";
import { MANAGER_AFTER_REJECTIONS } from "./payment-methods";
import { isViewableScreenshot } from "./payment-screenshot";
import { OrderActionDialog } from "./action-dialog";
import { claimPaymentReview } from "./payment-review-actions";
import { PAYMENTS_WINDOW_DAYS, summarize, type PaymentRow, type PaymentTab } from "./payments";
import { ZoomableImage } from "@/components/zoomable-image";

const METHOD: Record<PaymentRow["method"], string> = { gcash: "GCash", maya: "Maya", "bank-transfer": "Bank transfer", "cash-on-delivery": "Cash on delivery" };

/** "10 min ago", "3 hrs ago", "2 days ago". */
function ago(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function Receipt({ order, size }: { order: PaymentRow; size: "thumb" | "full" }) {
  const screenshot = order.proof?.screenshot ?? null;
  const frame = size === "thumb" ? "h-10 w-8 rounded-sm" : "w-full rounded-lg p-6";

  return isViewableScreenshot(screenshot) ? (
    <ZoomableImage
      src={screenshot}
      alt={`Receipt for Order #${order.id}`}
      className={size === "thumb" ? "h-10 w-8 rounded-sm border border-[#e4ddee] object-cover" : "block h-auto w-full rounded-lg border border-[#e4ddee] object-cover"}
    />
  ) : (
    <div className={`flex flex-col items-center justify-center gap-2 border border-[#e4ddee] bg-[#f1edf6] text-xs text-[#5a5368] ${frame}`}>
      <ImageIcon aria-hidden className={size === "thumb" ? "size-4" : "size-7"} />
      <span className={size === "thumb" ? "sr-only" : undefined}>{screenshot ? `Screenshot: ${screenshot}` : "No receipt"}</span>
    </div>
  );
}

export type ProofApproval = { approvalId?: string; waiting?: boolean };

/** A money step that stays disabled until Staff have found the payment in the shop's GCash history. */
function GatedButton({ label, open, children }: { label: string; open: boolean; children: React.ReactNode }) {
  return open ? <>{children}</> : (
    <Button type="button" disabled title="Tick the payment history check first" className="h-auto rounded-lg px-3 py-1.5 text-[13px] leading-[normal] shadow-none">{label}</Button>
  );
}

function VerifyDialog({ order, role, approval, onMarkPaid }: { order: PaymentRow; role: ShopRole | null; approval?: ProofApproval; onMarkPaid: () => void }) {
  const { reference, submittedAt } = order.proof!;
  const reusedOn = order.proofChecks?.checks.reference.otherOrderIds ?? [];
  const [found, setFound] = useState(false);
  // Admin and the CEO only look; nobody's reading of the screenshot ever marks an Order paid.
  const canWork = role === "staff" || role === "manager";
  const needsManager = order.rejections >= MANAGER_AFTER_REJECTIONS || reusedOn.length > 0;
  const last4 = reference ? reference.replace(/\s/g, "").slice(-4) : "";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" className="h-auto rounded-lg px-3 py-1.5 text-[13px] leading-[normal] shadow-none">
          Review
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[1040px] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0! leading-[normal] shadow-[0_20px_48px_rgb(0_0_0/0.2)] sm:rounded-2xl md:max-w-[1040px] lg:max-w-[1040px]">
        <div className="space-y-1 border-b border-[#f0f0f2] pt-5 pr-12 pb-4 pl-6">
          <DialogTitle className="text-lg font-semibold leading-[normal] text-foreground">
            Verify payment · Order #{order.id}
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-[#71717a]">
            {order.customer.name} · {METHOD[order.method]} · uploaded {formatDate(submittedAt)} · order total {formatPesos(order.total)}
            {" "}<ProofBadge outcome={proofOutcome({ rejected: order.proofRejectedAt !== null }, order.status)} />
          </DialogDescription>
        </div>
        <div className="grid min-h-0 gap-6 overflow-y-auto px-6 py-5 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4 text-sm text-[#1f1a2e]">
            <ProofAccountView account={order.proof?.account ?? null} method={order.method} />
            {order.proofChecks && <PaymentProofChecksView {...order.proofChecks} reference={reference} read={order.proofRead} />}
            <ProofReadFindings read={order.proofRead} role={role} />
            {reusedOn.length > 0 && (
              <p role="alert" className="rounded-lg bg-[#fdf1d8] px-3 py-2.5 text-[13px] text-[#8a5a00]">
                Reference already used on {reusedOn.map((n, i) => <span key={n}>{i > 0 && ", "}<Link href={`/orders/${n}`} className="font-medium underline">Order #{n}</Link></span>)}.
                {" "}{role === "manager" ? "You can approve it anyway with a reason." : canWork ? "Only a Manager can mark this paid: request approval." : "Only a Manager can mark this paid."}
              </p>
            )}
            <section className="space-y-2 rounded-lg border border-[#e4e4e7] px-4 py-3">
              <h3 className="font-semibold">Before you mark it paid</h3>
              <p role="note" className="rounded-md bg-[#fdf1d8] px-2.5 py-2 text-[13px] text-[#8a5a00]">Verify the real transfer with the payment provider first. A matching screenshot is not proof of payment.</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={found} disabled={!canWork} onChange={(e) => setFound(e.target.checked)} className="mt-1" />
                <span>
                  I found {formatPesos(order.total)}{last4 && <> with reference …{last4}</>} in the shop&apos;s {METHOD[order.method]} history
                  <span className="block text-xs text-[#71717a]">Required · a screenshot can be edited</span>
                </span>
              </label>
              <p className="text-xs text-[#71717a]">Reading the screenshot never marks an Order paid. Only a person who ticks this and confirms does.</p>
            </section>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm font-semibold">
              <h3>Screenshot</h3>
            </div>
            <Receipt order={order} size="full" />
            <p className="flex items-start gap-2 rounded-lg bg-[#fdf1d8] px-3 py-2.5 text-[13px] text-[#8a5a00]">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span><b>Duplicate reference rule.</b> If the same reference number was used on another Order, Mark paid is stopped for Staff and both Orders are shown. A Manager can approve it anyway with a reason.</span>
            </p>
          </div>
        </div>
        {canWork && (
          <div className="flex items-center justify-end gap-2 border-t border-[#f0f0f2] bg-[#fafafa] px-6 py-3.5">
            <CancelPaymentDialog id={order.id} />
            {order.rejections < MANAGER_AFTER_REJECTIONS && <RejectProofDialog id={order.id} />}
            {needsManager ? (
              <GatedButton label={role === "manager" || approval?.approvalId ? "Approve anyway" : approval?.waiting ? "Waiting for approval" : "Request approval…"} open={found}>
                <ApproveAnywayDialog id={order.id} role={role} approvalId={approval?.approvalId} waiting={approval?.waiting} reusedOn={reusedOn} />
              </GatedButton>
            ) : (
              <GatedButton label="Mark paid" open={found}>
                <MarkPaidDialog id={order.id} onMarkPaid={onMarkPaid} />
              </GatedButton>
            )}
          </div>
        )}
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

function Row({ order, tab, now, role, approval, onMarkPaid }: { order: PaymentRow; tab: PaymentTab; now: Date; role: ShopRole | null; approval?: ProofApproval; onMarkPaid: () => void }) {
  const cells = [
    order.proof ? <Receipt order={order} size="thumb" /> : <span className="text-[#a1a1aa]">—</span>,
    <Link key="o" href={`/orders/${order.id}`} className="font-medium text-[#5b2a86]">#{order.id}</Link>,
    <span key="c" className="flex min-w-0 flex-col pr-3">
      <span className="truncate">{order.customer.name}</span>
      {tab === "review" && order.review && (
        <span className="truncate text-xs text-[#71717a]">{order.review.owner ? `Owner: ${order.review.owner.name}` : "Not claimed"}</span>
      )}
    </span>,
    METHOD[order.method],
    <span key="r" className="truncate pr-3">{order.proof ? (order.proof.reference ?? "—") : "—"}</span>,
    <span key="a" className="flex items-center gap-1.5">
      {formatPesos(order.total)}
      {tab === "paid" && <Check aria-label="Paid" className="size-3.5 text-[#16a34a]" />}
      {tab === "rejected" && <AlertTriangle aria-label="Cancelled" className="size-3.5 text-[#dc2626]" />}
    </span>,
    tab === "review" && order.review ? (
      <span key="u" className="flex flex-col items-start gap-0.5 text-[13px] text-[#71717a]">
        {order.review.overdue && <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-xs font-medium text-[#b91c1c]">Overdue</span>}
        <span>Rejected {ago(order.review.startedAt, now)}</span>
      </span>
    ) : (
      <span key="u" className="text-[13px] text-[#71717a]">{order.proof ? ago(order.proof.submittedAt, now) : "—"}</span>
    ),
    tab === "verify" ? (
      <VerifyDialog order={order} role={role} approval={approval} onMarkPaid={onMarkPaid} />
    ) : tab === "review" ? (
      <span key="v" className="flex flex-col items-end gap-1">
        {role === "manager" && order.review && !order.review.owner && (
          <OrderActionDialog
            trigger="Claim review"
            triggerClassName="h-auto px-2.5 py-1 text-xs"
            title={`Claim the payment review on Order #${order.id}?`}
            description="You become its owner. Opening an Order never claims it."
            confirm="Claim review"
            busy="Claiming…"
            run={() => claimPaymentReview(order.id)}
            successMessage="You now own this payment review."
          />
        )}
        <Link href={`/orders/${order.id}`} className="text-[13px] font-medium text-[#5b2a86]">Open</Link>
      </span>
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
export function PaymentsView({ rows: served, now, role = "staff", approvals = {} }: { rows: PaymentRow[]; now: Date; role?: ShopRole | null; approvals?: Record<number, ProofApproval> }) {
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
                <Row key={order.id} order={order} tab={tab} now={now} role={role} approval={approvals[order.id]} onMarkPaid={() => markPaid(order.id)} />
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
