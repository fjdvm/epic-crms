"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Star } from "lucide-react";

import { CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import { Badge, type BadgeProps } from "@/components/ui/badge";

import { Field } from "./field";
import { formatDate, formatPesos } from "./format";
import { isViewableScreenshot } from "@/features/orders/payment-screenshot";
import { orderAnchor, type CustomerOrder } from "./orders";
import { orderLabel as label, paymentStatusOf } from "./rules";
import { ZoomableImage } from "@/components/zoomable-image";
import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

const PAYMENT_VARIANTS: Record<ReturnType<typeof paymentStatusOf>, BadgeProps["variant"]> = {
  Paid: "success",
  Unpaid: "warning",
  Cancelled: "secondary",
};

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "delivered" || status === "received") return "success";
  if (status === "cancelled") return "secondary";

  return "info";
}

const HEAD = "py-1.5 text-left text-xs font-medium text-muted-foreground";
const CELL = "py-[11px] pr-3 text-sm text-foreground";

const itemsText = (o: CustomerOrder) => o.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ");

/** Each column's share of the card, so the table spans it edge to edge; money and the last column sit right. */
const ORDER_COLUMNS: (ColumnDef<CustomerOrder> & { width: string; right?: boolean })[] = [
  { key: "order", label: "Order", width: "w-[10%]", sortValue: (o) => o.id, searchText: (o) => `#${o.id}` },
  { key: "date", label: "Date", width: "w-[13%]", sortValue: (o) => new Date(o.createdAt) },
  { key: "items", label: "Items", width: "w-[34%] min-w-[240px]", sortValue: (o) => o.lines.reduce((n, l) => n + l.quantity, 0), searchText: itemsText },
  { key: "total", label: "Total", width: "w-[13%] pr-6", right: true, sortValue: (o) => o.total },
  {
    key: "payment",
    label: "Payment",
    width: "w-[15%]",
    sortValue: (o) => paymentStatusOf(o.status),
    filter: { label: "Payment", value: (o) => paymentStatusOf(o.status) },
  },
  {
    key: "status",
    label: "Status",
    width: "w-[15%]",
    right: true,
    sortValue: (o) => label(o.status),
    filter: { label: "Status", value: (o) => label(o.status) },
  },
];

function OrderDetails({ order }: { order: CustomerOrder }) {
  const address = order.address;
  const proof = order.paymentProof;

  return (
    <div className="space-y-md rounded-lg bg-secondary p-md">
      <dl className="grid gap-sm sm:grid-cols-2">
        <Field label="Fulfillment">{label(order.fulfillmentMethod)}</Field>
        <Field label="Payment method">{label(order.paymentMethod)}</Field>
      </dl>

      <div className="overflow-x-auto">
<table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 font-medium">Product</th>
            <th className="py-1 font-medium">Size</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Price</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1">{l.product}</td>
              <td className="py-1">{l.size}</td>
              <td className="py-1 text-right">{l.quantity}</td>
              <td className="py-1 text-right">{formatPesos(l.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <dl className="ml-auto w-full max-w-[20rem] space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd>{formatPesos(order.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Delivery fee</dt>
          <dd>{formatPesos(order.deliveryFee ?? 0)}</dd>
        </div>
        <div className="flex justify-between font-medium">
          <dt>Total</dt>
          <dd>{formatPesos(order.total)}</dd>
        </div>
      </dl>

      {address && (
        <p className="text-sm text-foreground">
          <span className="text-xs font-medium text-muted-foreground">Delivery address at checkout: </span>
          {address.label} — {address.street}, {address.barangay}, {address.city}, {address.province} {address.postalCode}, {address.country}
        </p>
      )}

      {proof && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Payment proof</p>
          <p className="text-sm text-foreground">
            Reference: {proof.reference ?? "—"}
            {proof.submittedAt && ` · submitted ${formatDate(proof.submittedAt)}`}
          </p>
          {proof.screenshot &&
            (isViewableScreenshot(proof.screenshot) ? (
              <ZoomableImage src={proof.screenshot} alt={`Payment proof for order ${order.id}`} className="max-h-64 rounded-md border border-border" />
            ) : (
              <p className="text-xs text-muted-foreground">Screenshot: {proof.screenshot}</p>
            ))}
        </div>
      )}

      {order.feedback && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Order feedback</p>
          <p className="flex items-center gap-1 text-sm text-foreground">
            <Star className="size-4" /> {order.feedback.rating} / 5
          </p>
          {order.feedback.comment && <p className="text-sm text-foreground">{order.feedback.comment}</p>}
        </div>
      )}
    </div>
  );
}

export function OrdersTab({
  orders,
  expanded,
  onToggle,
  canOpenOrder = false,
}: {
  orders: CustomerOrder[];
  /** Order ids whose details are open. */
  expanded: ReadonlySet<number>;
  onToggle: (orderId: number) => void;
  /** Staff who hold the Orders, Payments or Fulfilment Module get a link to each Order's detail page. */
  canOpenOrder?: boolean;
}) {
  const table = useTableState(orders, ORDER_COLUMNS);

  return (
    <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Order history</h2>
        <p className="text-[13px] font-medium text-primary">Read-only here · managed in Sales</p>
      </div>

      {orders.length === 0 ? (
        <div className="p-xl text-center text-muted-foreground">This customer has no orders yet.</div>
      ) : (
        <>
        <TableToolbar state={table} label="Search and filter Order history" searchLabel="Search Order history" placeholder="Order no. or product" />
        {table.rows.length === 0 ? (
          <NoMatches noun="Orders" onClear={table.clear} />
        ) : (
        <div className="@container overflow-x-auto">
        <table className="w-full min-w-max whitespace-nowrap">
          <thead>
            <tr className="border-b border-border-subtle">
              {ORDER_COLUMNS.map((c) => (
                <th key={c.key} aria-sort={stateAriaSort(table, c.key)} className={cn(HEAD, c.width, c.right && "text-right")}>
                  <StateSortHeader state={table} columnKey={c.key} align={c.right ? "right" : "left"} />
                </th>
              ))}
            </tr>
          </thead>
          {table.rows.map((o) => {
            const open = expanded.has(o.id);

            return (
              <tbody key={o.id} id={orderAnchor(o.id)} className="border-b border-border-subtle last:border-0">
                {/* The whole row opens the Order, or for someone without its page, shows its details here. */}
                <tr className={CLICKABLE_ROW}>
                  <td className={`${CELL} font-medium text-primary`}>
                    {canOpenOrder ? (
                      <RowLink href={`/orders/${o.id}`} className="inline-flex items-center gap-1">
                        #{o.id}
                      </RowLink>
                    ) : (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => onToggle(o.id)}
                        className="inline-flex items-center gap-1 after:absolute after:inset-0 after:content-['']"
                      >
                        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}#{o.id}
                      </button>
                    )}
                  </td>
                  <td className={CELL}>{formatDate(o.createdAt)}</td>
                  <td className={CELL}>{itemsText(o)}</td>
                  <td className={cn(CELL, "pr-6 text-right")}>{formatPesos(o.total)}</td>
                  <td className={CELL}>
                    <Badge variant={PAYMENT_VARIANTS[paymentStatusOf(o.status)]}>{paymentStatusOf(o.status)}</Badge>
                  </td>
                  <td className={cn(CELL, "pr-0 text-right")}>
                    <Badge variant={statusVariant(o.status)}>{label(o.status)}</Badge>
                  </td>
                </tr>
                {open && !canOpenOrder && (
                  <tr>
                    <td colSpan={6} className="whitespace-normal pb-3 text-left">
                      {/* Zero intrinsic width, pinned to the scroll area's visible width: the details never widen
                          the table's columns and never scroll out of sight with them. */}
                      <div className="sticky left-0 w-[100cqw]">
                        <OrderDetails order={o} />
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
        </div>
        )}
        </>
      )}
    </div>
  );
}
