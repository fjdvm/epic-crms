"use client";

import { Image as ImageIcon } from "lucide-react";
import Link from "next/link";

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";

import { CancelPaymentDialog, MarkPaidDialog } from "./payments-actions";
import type { PaymentQueueOrder } from "./payments";

/** The Figma queue's columns; they share the table width in proportion, so the rows fill the card. */
const COLUMNS: { header: string; className: string }[] = [
  { header: "Receipt", className: "flex-[0_0_72px]" },
  { header: "Order", className: "flex-[1_1_90px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { header: "GCash reference", className: "min-w-0 flex-[2_1_150px]" },
  { header: "Amount due", className: "flex-[1_1_110px]" },
  { header: "Uploaded", className: "flex-[1_1_110px]" },
  { header: "", className: "flex-[0_0_88px] justify-end" },
];

const HEAD = "flex items-start overflow-clip";
const CELL = "flex items-center overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

/** A screenshot is a link only when the storefront gave one Staff can open; a bare pathname is not. */
const isUrl = (value: string | null): value is string => value !== null && /^https?:\/\//.test(value);

function Receipt({ order, size }: { order: PaymentQueueOrder; size: "thumb" | "full" }) {
  const { screenshot } = order.paymentProof;
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

function VerifyDialog({ order }: { order: PaymentQueueOrder }) {
  const { reference, submittedAt } = order.paymentProof;

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
          <MarkPaidDialog id={order.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** GCash Orders waiting for a payment check, in the order given (oldest proof first). */
export function PaymentQueueView({ orders }: { orders: PaymentQueueOrder[] }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-[#e6e1ee] bg-white p-8 text-center text-sm text-[#6e6680]">
        No GCash Orders are waiting for a payment check.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[#e6e1ee] bg-white p-5">
      <div className="min-w-[860px]">
        <div className="sticky top-0 z-10 flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
          {COLUMNS.map((col) => (
            <div key={col.header || "action"} className={`${HEAD} ${col.className}`}>
              {col.header}
            </div>
          ))}
        </div>
        {orders.map((order) => (
          <div key={order.id} data-payment-row className="flex items-center border-b border-[#efebf4] py-2.5">
            <div className={`${CELL} ${COLUMNS[0].className}`}>
              <Receipt order={order} size="thumb" />
            </div>
            <div className={`${CELL} ${COLUMNS[1].className} font-medium text-[#5b2a86]`}>
              <Link href={`/orders/${order.id}`}>#{order.id}</Link>
            </div>
            <div className={`${CELL} ${COLUMNS[2].className}`}>
              <span className="truncate pr-3">{order.customer.name}</span>
            </div>
            <div className={`${CELL} ${COLUMNS[3].className}`}>
              <span className="truncate pr-3">{order.paymentProof.reference ?? "—"}</span>
            </div>
            <div className={`${CELL} ${COLUMNS[4].className}`}>{formatPesos(order.total)}</div>
            <div className={`${CELL} ${COLUMNS[5].className} text-[13px] text-[#71717a]`}>
              {formatDate(order.paymentProof.submittedAt)}
            </div>
            <div className={`${CELL} ${COLUMNS[6].className}`}>
              <VerifyDialog order={order} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
