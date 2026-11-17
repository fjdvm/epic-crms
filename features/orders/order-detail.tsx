import { PaymentProofChecksView } from "./payment-proof-checks-view";
import Link from "next/link";
import { FULFILMENT_MODULE, ORDERS_MODULE, RETURNS_MODULE } from "@/lib/portal/config";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";
import { orderLabel } from "@/features/customer-profiles/rules";
import type { ReturnRow } from "@/features/returns/returns";
import { ReturnsTable } from "@/features/returns/returns-table";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

import type { OrderDetail } from "./orders";
import type { LineReservation } from "./stock";
import { LiveActions, LiveProgress, LiveStatus, OrderLiveProvider } from "./order-live";
import { isPrepaid, MANAGER_AFTER_REJECTIONS } from "./payment-methods";
import { isViewableScreenshot } from "./payment-screenshot";
import { PaymentPill } from "./status-pill";
import { CancelDispatched, CancellationNote } from "./cancel-dispatched";
import type { CancellationState } from "./cancellation-state";

/** A Delivery Order whose subtotal is strictly over ₱2,500 (250,000 centavos) ships free. */
export const FREE_DELIVERY_THRESHOLD = 250_000;

export function hasFreeDelivery(order: OrderDetail): boolean {
  return order.fulfillmentMethod === "delivery" && order.deliveryFee === 0 && order.subtotal > FREE_DELIVERY_THRESHOLD;
}

const SENIOR_PWD_STATUS: Record<string, string> = {
  pending: "Waiting for review", approved: "Verified", declined: "Declined", revoked: "Revoked", expired: "Expired",
};

/** "Senior Citizen · Verified", or "Not verified" when the Order carries no verification. */
export function seniorPwdLabel(order: OrderDetail): string {
  if (!order.seniorPwd) return "Not verified";
  const kind = order.seniorPwd.idType === "senior" ? "Senior Citizen" : "PWD";
  return `${kind} · ${SENIOR_PWD_STATUS[order.seniorPwd.status]}`;
}

/** "Reserved 4 · 18 left": what this line set aside, and what is still available online. */
function LineStock({ reservation }: { reservation: LineReservation | undefined }) {
  if (!reservation) return <span className="text-[#6e6680]">–</span>;
  return (
    <span className="inline-flex rounded-full bg-[#e1f5ee] px-2.5 py-[3px] text-xs font-medium text-[#0f6e56]">
      Reserved {reservation.reserved}
      {reservation.left !== null && ` · ${reservation.left} left`}
    </span>
  );
}

function DeliveryFee({ order }: { order: OrderDetail }) {
  if (order.fulfillmentMethod === "pickup") return null;

  const text = hasFreeDelivery(order)
    ? "Free · ₱0"
    : order.deliveryFee !== null
      ? formatPesos(order.deliveryFee)
      : order.status === "cancelled"
        ? "Not quoted"
        : "Pending";

  return (
    <div className="flex justify-between">
      <dt className="text-[#6e6680]">Delivery fee</dt>
      <dd className={hasFreeDelivery(order) ? "font-medium text-[#16a34a]" : undefined}>{text}</dd>
    </div>
  );
}

function FreeDeliveryRule({ order }: { order: OrderDetail }) {
  if (!hasFreeDelivery(order)) return null;

  return (
    <div role="note" aria-label="Free delivery rule" className="flex gap-2.5 rounded-[10px] bg-[#e3f4e8] p-3 text-[#1e6b3a]">
      <span aria-hidden className="text-sm leading-none">✓</span>
      <div className="space-y-0.5">
        <p className="text-[13px] font-semibold">Free delivery rule</p>
        <p className="text-xs">
          Subtotal is over {formatPesos(FREE_DELIVERY_THRESHOLD)}, so delivery is free and the order was confirmed at
          placement. The delivery fee is locked at ₱0 — saving any other amount is refused.
        </p>
      </div>
    </div>
  );
}

function QuoteAgainNote({ order }: { order: OrderDetail }) {
  if (!hasFreeDelivery(order)) return null;

  return (
    <p role="note" aria-label="Quote again" className="rounded-[10px] bg-[#fdf1d8] p-3 text-xs text-[#8a5a00]">
      If items are cancelled and the subtotal drops to {formatPesos(FREE_DELIVERY_THRESHOLD)} or less, staff must quote a
      delivery fee again.
    </p>
  );
}

function Screenshot({ source, alt }: { source: string | null; alt: string }) {
  if (!source) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return isViewableScreenshot(source) ? <img src={source} alt={alt} className="max-h-64 rounded-md border border-[#e6e1ee]" /> : <p className="text-xs text-[#6e6680]">Screenshot: {source}</p>;
}

/** Every proof the Customer sent, oldest first, with who rejected each and why. */
function PaymentProof({ order }: { order: OrderDetail }) {
  const method = orderLabel(order.paymentMethod);
  if (!isPrepaid(order.paymentMethod)) return <p className="text-sm text-[#6e6680]">Cash on delivery: no proof needed.</p>;
  const history = order.paymentProofs;
  if (history.length === 0) return <p className="text-sm text-[#6e6680]">No Payment proof submitted yet.</p>;

  return (
    <ol className="space-y-3 text-sm text-[#1f1a2e]">
      {history.map((proof, index) => (
        <li key={proof.id} className="space-y-2 rounded-lg border border-[#efebf4] p-3">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Proof {index + 1}</span>
            <span>{method} reference: {proof.reference ?? "—"} · submitted {formatDate(proof.submittedAt)}</span>
            {proof.rejection && <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-xs font-medium text-[#b91c1c]">Rejected</span>}
          </p>
          {proof.confirmed && proof.expected && proof.checks && <PaymentProofChecksView confirmed={proof.confirmed} expected={proof.expected} checks={proof.checks} />}
          <Screenshot source={proof.screenshot} alt={`Payment proof ${index + 1} for order ${order.id}`} />
          {proof.rejection && (
            <p className="text-xs text-[#6e6680]">
              Rejected by {proof.rejection.by.name || "Staff"} on {formatDate(proof.rejection.at)}: {proof.rejection.reason}
            </p>
          )}
        </li>
      ))}
      {order.proofRejections >= MANAGER_AFTER_REJECTIONS && order.status === "awaiting payment" && (
        <li className="rounded-lg bg-[#fdf1d8] p-3 text-xs text-[#8a5a00]">{order.proofRejections} receipts rejected: only a Manager can approve this Order now.</li>
      )}
    </ol>
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
      ) : order.deliveryPhotoRemovedAt ? (
        <p className="text-sm text-[#6e6680]">The Delivery photo was removed.</p>
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
  returns = [],
  reservations = new Map(),
  role,
  approvalId,
  waitingApproval,
  cancellation = null,
  codFlags = [],
}: {
  /** The viewer's role; omitted means Staff, so the buttons that need a Manager read "Request approval". */
  role?: ShopRole | null;
  /** An approved "approve anyway" request Staff can now carry out. */
  approvalId?: string;
  /** Staff asked and a Manager has not decided yet. */
  waitingApproval?: boolean;
  /** The cancel-after-dispatch request on this Order, if any. */
  cancellation?: CancellationState | null;
  /** Which Cash on Delivery rules fired, for Staff to double-check; empty for everyone else. Never shown to the Customer. */
  codFlags?: readonly { rule: string; label: string; reason: string }[];
  order: OrderDetail;
  /** What this Order set aside per line, by Order line id. Empty for Orders placed before Reservations. */
  reservations?: ReadonlyMap<number, LineReservation>;
  modules?: readonly string[];
  /** A short-lived address for the Delivery photo; null when it exists but could not be reached. */
  deliveryPhotoUrl?: string | null;
  /** This Order's Returns, shown read-only to Staff with the Returns Module; null when CREOMS could not read them. */
  returns?: ReturnRow[] | null;
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
              {hasFreeDelivery(order) && (
                <span className="rounded-full bg-[#e3f4e8] px-2.5 py-0.5 text-xs font-medium text-[#1e6b3a]">Free delivery</span>
              )}
            </div>
            <p className="text-sm leading-[normal] text-[#6e6680]">
              Placed {formatDate(order.createdAt)} ·{" "}
              {orderLabel(order.fulfillmentMethod)} ·{" "}
              {orderLabel(order.paymentMethod)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {order.status === "dispatched" && order.fulfillmentMethod === "delivery" && modules.includes(FULFILMENT_MODULE) && (
              <Link href={`/orders/${order.id}/failed-delivery`} className="rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-[9px] text-sm font-medium text-[#18181b]">
                Failed delivery
              </Link>
            )}
            {order.status === "dispatched" && modules.includes(FULFILMENT_MODULE) && (
              <CancelDispatched id={order.id} total={order.total} paymentMethod={order.paymentMethod} role={role} state={cancellation} />
            )}
            <LiveActions order={order} modules={modules} role={role} approvalId={approvalId} waiting={waitingApproval} codFlags={codFlags} />
          </div>
        </div>
        <CancellationNote state={cancellation} />
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
                    <th className="py-1 pl-4 font-medium">Stock</th>
                    <th className="py-1 text-right font-medium">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((l, i) => (
                    <tr key={i} className="border-t border-[#efebf4]">
                      <td className="py-2">{l.product}</td>
                      <td className="py-2">{l.size}</td>
                      <td className="py-2 text-right">{l.quantity}</td>
                      <td className="py-2 pl-4">
                        <LineStock reservation={l.id === undefined ? undefined : reservations.get(l.id)} />
                      </td>
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
            <FreeDeliveryRule order={order} />
          </section>

          {modules.includes(RETURNS_MODULE) && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Returns</h2>
              <ReturnsTable returns={returns} empty="No Returns on this Order." />
            </section>
          )}

          <section className={CARD}>
            <h2 className={CARD_TITLE}>
              {address ? "Delivery address" : "Pickup"}
            </h2>
            {address?.region ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm text-[#1f1a2e]" aria-label="Structured delivery address">
                {(
                  [
                    ["Country", address.country],
                    ["Region", address.region],
                    ["Province", address.province],
                    ["City", address.city],
                    ["Barangay", address.barangay],
                    ["Street", address.street],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-[#6b6580]">{label}</dt>
                    <dd>{value || "—"}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-[#1f1a2e]">
                {address
                  ? `${address.street}, ${address.barangay}, ${address.city}, ${address.province} ${address.postalCode}, ${address.country}`
                  : "The Customer collects this Order; there is nothing to deliver."}
              </p>
            )}
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
            {codFlags.length > 0 && (
              <div data-testid="cod-flags" className="space-y-1 rounded-lg bg-[#fdf1d8] p-3 text-xs text-[#8a5a00]">
                <p className="font-medium">Double-check before confirming</p>
                <ul className="list-disc pl-4">{codFlags.map(f => <li key={f.rule}>{f.label}</li>)}</ul>
              </div>
            )}
          </section>

          {(order.status === "delivered" || order.status === "received") && (
            <DeliveryPhoto order={order} url={deliveryPhotoUrl} />
          )}

          {order.packedBy && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Packing</h2>
              <p className="text-sm text-[#1f1a2e]">
                Packed by {order.packedBy.name} · {formatDate(order.packedBy.at)}
              </p>
            </section>
          )}

          <QuoteAgainNote order={order} />

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Customer</h2>
            {order.customer.deleted ? (
              <p data-testid="deleted-customer-tag" className="text-sm font-medium text-[#6e6680]">{order.customer.name}</p>
            ) : (
              <Link
                href={`/customer-profiles/${order.customer.id}`}
                className="text-sm font-medium text-[#5b2a86]"
              >
                {order.customer.name}
              </Link>
            )}
            <p className="mt-2 text-xs text-[#6e6680]">Senior/PWD</p>
            <p data-testid="senior-pwd-status" className="text-sm text-[#1f1a2e]">{seniorPwdLabel(order)}</p>
            {order.seniorPwd?.status === "pending" && (
              <Link href="/orders/senior-pwd" className="text-xs font-medium text-[#5b2a86]">Review this ID</Link>
            )}
            {order.fulfillmentMethod === "pickup" && order.seniorPwd?.status === "approved" && (
              <p className="mt-1 text-xs text-[#6e6680]">Ask to see the original ID when the Customer collects.</p>
            )}
          </section>
        </div>
      </div>
    </div>
    </OrderLiveProvider>
  );
}
