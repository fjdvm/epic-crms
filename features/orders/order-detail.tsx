import { Check } from "lucide-react";
import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";
import { cn } from "@/lib/utils";

import type { OrderDetail } from "./orders";
import { PaymentPill, StatusPill } from "./status-pill";

/** The steps an Order moves through. Only GCash Delivery Orders go through the payment steps, plus any Order already in one. */
function progressFor(order: OrderDetail): string[] {
  const pays =
    (order.paymentMethod === "gcash" && order.fulfillmentMethod !== "pickup") ||
    order.status === "awaiting payment" ||
    order.status === "paid";

  return [
    "placed",
    "confirmed",
    ...(pays ? ["awaiting payment", "paid"] : []),
    "preparing",
    "dispatched",
    "delivered",
  ];
}

function Progress({ order }: { order: OrderDetail }) {
  if (order.status === "cancelled") {
    return <p className="text-sm text-[#6e6680]">This Order was cancelled.</p>;
  }

  const steps = progressFor(order);
  const current = steps.indexOf(order.status);

  return (
    <ol aria-label="Order progress" className="flex items-start">
      {steps.map((step, i) => (
        <li
          key={step}
          data-done={i <= current}
          aria-current={i === current ? "step" : undefined}
          className={cn("flex items-start", i < steps.length - 1 && "flex-1")}
        >
          <div className="flex w-[84px] shrink-0 flex-col items-center gap-2 text-center">
            <span
              aria-hidden
              className={cn(
                "flex size-8 items-center justify-center rounded-full border-2",
                i < current && "border-[#5b2a86] bg-[#5b2a86] text-white",
                i === current && "border-[#5b2a86] bg-white",
                i > current && "border-[#d9d3e3] bg-white",
              )}
            >
              {i < current && <Check className="size-4" />}
              {i === current && <span className="size-2.5 rounded-full bg-[#5b2a86]" />}
            </span>
            <span className={cn("text-xs leading-[normal]", i <= current ? "font-medium text-[#1f1a2e]" : "text-[#9a93a8]")}>
              {orderLabel(step)}
            </span>
          </div>
          {i < steps.length - 1 && (
            <span aria-hidden className={cn("mt-4 h-0.5 flex-1", i < current ? "bg-[#5b2a86]" : "bg-[#e6e1ee]")} />
          )}
        </li>
      ))}
    </ol>
  );
}

function DeliveryFee({ order }: { order: OrderDetail }) {
  if (order.fulfillmentMethod === "pickup") return null;

  const text =
    order.deliveryFee !== null ? formatPesos(order.deliveryFee) : order.status === "cancelled" ? "Not quoted" : "Pending";

  return (
    <div className="flex justify-between">
      <dt className="text-[#6e6680]">Delivery fee</dt>
      <dd>{text}</dd>
    </div>
  );
}

function PaymentProof({ order }: { order: OrderDetail }) {
  const proof = order.paymentProof;

  if (order.paymentMethod !== "gcash") return <p className="text-sm text-[#6e6680]">Cash on delivery: no proof needed.</p>;
  if (!proof) return <p className="text-sm text-[#6e6680]">No Payment proof submitted yet.</p>;

  return (
    <div className="space-y-2 text-sm text-[#1f1a2e]">
      <p>
        GCash reference: {proof.reference ?? "—"}
        {proof.submittedAt && ` · submitted ${formatDate(proof.submittedAt)}`}
      </p>
      {proof.screenshot &&
        (/^https?:\/\//.test(proof.screenshot) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={proof.screenshot}
            alt={`Payment proof for order ${order.id}`}
            className="max-h-64 rounded-md border border-[#e6e1ee]"
          />
        ) : (
          <p className="text-xs text-[#6e6680]">Screenshot: {proof.screenshot}</p>
        ))}
    </div>
  );
}

/** An Order with everything Staff need to read it. Read-only: nothing here changes the Order. */
export function OrderDetailView({ order }: { order: OrderDetail }) {
  const address = order.address;

  return (
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 space-y-2">
        <Link href="/orders" className="text-sm font-medium text-[#5b2a86]">
          ← Orders
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Order #{order.id}</h1>
          <StatusPill status={order.status} />
        </div>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Placed {formatDate(order.createdAt)} · {orderLabel(order.fulfillmentMethod)} ·{" "}
          {orderLabel(order.paymentMethod)}
        </p>
      </div>

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[2fr_1fr] lg:overflow-y-auto">
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Order status</h2>
            <Progress order={order} />
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Items</h2>
            <table className="w-full text-sm text-[#1f1a2e]">
              <thead>
                <tr className="text-left text-xs text-[#6e6680]">
                  <th className="py-1 font-medium">Product</th>
                  <th className="py-1 font-medium">Size</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l, i) => (
                  <tr key={i} className="border-t border-[#efebf4]">
                    <td className="py-2">{l.product}</td>
                    <td className="py-2">{l.size}</td>
                    <td className="py-2 text-right">{l.quantity}</td>
                    <td className="py-2 text-right">{formatPesos(l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ml-auto w-full max-w-[20rem] space-y-1 text-sm text-[#1f1a2e]">
              <div className="flex justify-between">
                <dt className="text-[#6e6680]">Subtotal</dt>
                <dd>{formatPesos(order.subtotal)}</dd>
              </div>
              <DeliveryFee order={order} />
              <div className="flex justify-between font-medium">
                <dt>Total</dt>
                <dd>{formatPesos(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>{address ? "Delivery address" : "Pickup"}</h2>
            <p className="text-sm text-[#1f1a2e]">
              {address
                ? `${address.street}, ${address.barangay}, ${address.city}, ${address.province} ${address.postalCode}, ${address.country}`
                : "The Customer collects this Order; there is nothing to deliver."}
            </p>
          </section>
        </div>

        <div className="space-y-5">
          <section className={CARD}>
            <div className="flex items-center justify-between">
              <h2 className={CARD_TITLE}>Payment</h2>
              <PaymentPill label={order.paymentLabel} />
            </div>
            <dl className="space-y-1 text-sm text-[#1f1a2e]">
              <div className="flex justify-between">
                <dt className="text-[#6e6680]">Method</dt>
                <dd>{orderLabel(order.paymentMethod)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#6e6680]">Amount</dt>
                <dd>{formatPesos(order.total)}</dd>
              </div>
              {order.paidBy && (
                <div className="flex justify-between">
                  <dt className="text-[#6e6680]">Verified by</dt>
                  <dd>
                    {order.paidBy.name} · {formatDate(order.paidBy.at)}
                  </dd>
                </div>
              )}
            </dl>
            <PaymentProof order={order} />
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Link href={`/customer-profiles/${order.customer.id}`} className="text-sm font-medium text-[#5b2a86]">
              {order.customer.name}
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
