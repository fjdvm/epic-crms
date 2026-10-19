import { ChevronDown, ChevronRight, Star } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";

import { Field } from "./field";
import { formatDate, formatPesos } from "./format";
import { orderAnchor, type CustomerOrder } from "./orders";
import { orderLabel as label, paymentStatusOf } from "./rules";

const PAYMENT_VARIANTS: Record<ReturnType<typeof paymentStatusOf>, BadgeProps["variant"]> = {
  Paid: "success",
  Unpaid: "warning",
  Cancelled: "secondary",
};

function statusVariant(status: string): BadgeProps["variant"] {
  if (status === "delivered") return "success";
  if (status === "cancelled") return "secondary";

  return "info";
}

const HEAD = "py-1.5 text-left text-xs font-medium text-muted-foreground";
const CELL = "py-[11px] pr-3 text-sm text-foreground";

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
<table className="w-full min-w-max whitespace-nowrap text-sm">
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

      <dl className="ml-auto max-w-xs space-y-1 text-sm">
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
            (/^https?:\/\//.test(proof.screenshot) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={proof.screenshot} alt={`Payment proof for order ${order.id}`} className="max-h-64 rounded-md border border-border" />
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
}: {
  orders: CustomerOrder[];
  /** Order ids whose details are open. */
  expanded: ReadonlySet<number>;
  onToggle: (orderId: number) => void;
}) {
  return (
    <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Order history</h2>
        <p className="text-[13px] font-medium text-primary">Read-only here · managed in Sales</p>
      </div>

      {orders.length === 0 ? (
        <div className="p-xl text-center text-muted-foreground">This customer has no orders yet.</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-max whitespace-nowrap">
          <thead>
            <tr className="border-b border-border-subtle">
              <th className={`${HEAD} w-[90px]`}>Order</th>
              <th className={`${HEAD} w-[110px]`}>Date</th>
              <th className={`${HEAD} min-w-[240px]`}>Items</th>
              <th className={`${HEAD} w-[90px]`}>Total</th>
              <th className={`${HEAD} w-[100px]`}>Payment</th>
              <th className={`${HEAD} w-[110px]`}>Status</th>
            </tr>
          </thead>
          {orders.map((o) => {
            const open = expanded.has(o.id);

            return (
              <tbody key={o.id} id={orderAnchor(o.id)} className="border-b border-border-subtle last:border-0">
                <tr>
                  <td className={`${CELL} font-medium text-primary`}>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => onToggle(o.id)}
                      className="inline-flex items-center gap-1"
                    >
                      {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}#{o.id}
                    </button>
                  </td>
                  <td className={CELL}>{formatDate(o.createdAt)}</td>
                  <td className={CELL}>{o.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")}</td>
                  <td className={CELL}>{formatPesos(o.total)}</td>
                  <td className={CELL}>
                    <Badge variant={PAYMENT_VARIANTS[paymentStatusOf(o.status)]}>{paymentStatusOf(o.status)}</Badge>
                  </td>
                  <td className={CELL}>
                    <Badge variant={statusVariant(o.status)}>{label(o.status)}</Badge>
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} className="pb-3">
                      <OrderDetails order={o} />
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
        </div>
      )}
    </div>
  );
}
