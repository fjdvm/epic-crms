import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";
import { cn } from "@/lib/utils";

import type { OrderDetail } from "./orders";
import { PaymentPill, StatusPill } from "./status-pill";

/** The steps an Order moves through. Only GCash Delivery Orders go through the payment steps. */
function progressFor(order: OrderDetail): string[] {
  const pays = order.paymentMethod === "gcash" && order.fulfillmentMethod !== "pickup";

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
    <ol aria-label="Order progress" className="flex flex-wrap gap-2">
      {steps.map((step, i) => (
        <li
          key={step}
          data-done={i <= current}
          aria-current={i === current ? "step" : undefined}
          className={cn(
            "rounded-full px-[10px] py-[3px] text-xs font-medium leading-[normal]",
            i < current && "bg-[#e3f4e8] text-[#1e6b3a]",
            i === current && "bg-[#5b2a86] text-white",
            i > current && "bg-[#eeecf2] text-[#5a5368]",
          )}
        >
          {orderLabel(step)}
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
          <PaymentPill label={order.paymentLabel} />
        </div>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Placed {formatDate(order.createdAt)} · {orderLabel(order.fulfillmentMethod)} ·{" "}
          {orderLabel(order.paymentMethod)}
        </p>
      </div>

      <section className={cn(CARD, "shrink-0")}>
        <h2 className={CARD_TITLE}>Progress</h2>
        <Progress order={order} />
      </section>

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[2fr_1fr] lg:overflow-y-auto">
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
          <dl className="ml-auto max-w-xs space-y-1 text-sm text-[#1f1a2e]">
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

        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Link href={`/customer-profiles/${order.customer.id}`} className="text-sm font-medium text-[#5b2a86]">
              {order.customer.name}
            </Link>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>{address ? "Delivery address" : "Pickup"}</h2>
            <p className="text-sm text-[#1f1a2e]">
              {address
                ? `${address.street}, ${address.barangay}, ${address.city}, ${address.province} ${address.postalCode}, ${address.country}`
                : "The Customer collects this Order; there is nothing to deliver."}
            </p>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Payment proof</h2>
            <PaymentProof order={order} />
          </section>
        </div>
      </div>
    </div>
  );
}
