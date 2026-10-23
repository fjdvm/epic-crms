import Link from "next/link";
import { ORDERS_MODULE, RETURNS_MODULE } from "@/lib/portal/config";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

import type { OrderDetail } from "./orders";
import { LiveActions, LiveProgress, LiveStatus, OrderLiveProvider } from "./order-live";
import { PaymentPill } from "./status-pill";

function DeliveryFee({ order }: { order: OrderDetail }) {
  if (order.fulfillmentMethod === "pickup") return null;

  const text =
    order.deliveryFee !== null
      ? formatPesos(order.deliveryFee)
      : order.status === "cancelled"
        ? "Not quoted"
        : "Pending";

  return (
    <div className="flex justify-between">
      <dt className="text-[#6e6680]">Delivery fee</dt>
      <dd>{text}</dd>
    </div>
  );
}

function PaymentProof({ order }: { order: OrderDetail }) {
  const proof = order.paymentProof;

  if (order.paymentMethod !== "gcash")
    return (
      <p className="text-sm text-[#6e6680]">
        Cash on delivery: no proof needed.
      </p>
    );
  if (!proof)
    return (
      <p className="text-sm text-[#6e6680]">No Payment proof submitted yet.</p>
    );

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
          <p className="text-xs text-[#6e6680]">
            Screenshot: {proof.screenshot}
          </p>
        ))}
    </div>
  );
}

/** Delivered Orders show the photo; legacy ones never had one. */
function DeliveryPhoto({ order, url }: { order: OrderDetail; url: string | null | undefined }) {
  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>Delivery photo</h2>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Delivery photo for Order #${order.id}`} className="max-h-64 rounded-md border border-[#e6e1ee]" />
      ) : order.deliveryPhotoFileId ? (
        <p className="text-sm text-[#6e6680]">The Delivery photo could not be loaded. Reload to try again.</p>
      ) : (
        <p className="text-sm text-[#6e6680]">No photo</p>
      )}
    </section>
  );
}

/** An Order with everything Staff need to read it, and the actions the viewer's Modules allow. */
export function OrderDetailView({
  order,
  modules = [],
  deliveryPhotoUrl,
}: {
  order: OrderDetail;
  modules?: readonly string[];
  /** A short-lived address for the Delivery photo; null when it exists but could not be reached. */
  deliveryPhotoUrl?: string | null;
}) {
  const address = order.address;
  const backToReturns = modules.includes(RETURNS_MODULE) && !modules.includes(ORDERS_MODULE);

  return (
    <OrderLiveProvider status={order.status}>
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 space-y-2">
        <Link href={backToReturns ? "/returns" : "/orders"} className="text-sm font-medium text-[#5b2a86]">
          {backToReturns ? "← Returns" : "← Orders"}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">
                Order #{order.id}
              </h1>
              <LiveStatus />
            </div>
            <p className="text-sm leading-[normal] text-[#6e6680]">
              Placed {formatDate(order.createdAt)} ·{" "}
              {orderLabel(order.fulfillmentMethod)} ·{" "}
              {orderLabel(order.paymentMethod)}
            </p>
          </div>
          <LiveActions order={order} modules={modules} />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-y-auto">
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Order status</h2>
            <div className="overflow-x-auto">
              <LiveProgress order={order} />
            </div>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Items</h2>
            <div className="overflow-x-auto">
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
                      <td className="py-2 text-right">
                        {formatPesos(l.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
            <h2 className={CARD_TITLE}>
              {address ? "Delivery address" : "Pickup"}
            </h2>
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

          {(order.status === "delivered" || order.status === "received") && (
            <DeliveryPhoto order={order} url={deliveryPhotoUrl} />
          )}

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            <Link
              href={`/customer-profiles/${order.customer.id}`}
              className="text-sm font-medium text-[#5b2a86]"
            >
              {order.customer.name}
            </Link>
          </section>
        </div>
      </div>
    </div>
    </OrderLiveProvider>
  );
}
