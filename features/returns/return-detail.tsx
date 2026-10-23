import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { Pill } from "@/features/tickets/pill";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

import { ReturnActions } from "./return-actions";
import type { ReturnDetail } from "./returns";
import { STATUS_PILLS } from "./returns-table";

/** A short-lived address per image, null when that image exists but could not be reached. */
export type ImageUrls = (string | null)[];

const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const dateTime = (date: Date) => `${formatDate(date)}, ${time.format(date)}`;

function Photo({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return <p className="text-sm text-[#6e6680]">This image could not be loaded. Reload to try again.</p>;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="max-h-64 rounded-md border border-[#e6e1ee]" />;
}

function goodsLine(detail: ReturnDetail): string | null {
  if (detail.goodsRequired === null) return null;

  return detail.goodsRequired ? "The goods must come back." : "The goods do not need to come back.";
}

/** One Return with everything Staff need to decide it, and the steps its status allows. */
export function ReturnDetailView({
  detail,
  imageUrls,
  deliveryPhotoUrl,
}: {
  detail: ReturnDetail;
  imageUrls: ImageUrls;
  /** Null when the Delivery photo exists but could not be reached; undefined when the Order has none. */
  deliveryPhotoUrl?: string | null;
}) {
  const goods = goodsLine(detail);

  return (
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 space-y-2">
        <Link href="/returns" className="text-sm font-medium text-[#5b2a86]">
          ← Returns
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">{detail.number}</h1>
              <Pill className={STATUS_PILLS[detail.status]}>{orderLabel(detail.status)}</Pill>
            </div>
            <p className="text-sm leading-[normal] text-[#6e6680]">
              Requested {formatDate(detail.requestedAt)} · Order{" "}
              <Link href={`/orders/${detail.orderId}`} className="text-[#5b2a86]">
                #{detail.orderId}
              </Link>
            </p>
          </div>
          <ReturnActions
            id={detail.id}
            number={detail.number}
            status={detail.status}
            goodsRequired={detail.goodsRequired}
          />
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-y-auto">
        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Reason</h2>
            <p className="text-sm font-medium text-[#1f1a2e]">{orderLabel(detail.reason)}</p>
            <p className="whitespace-pre-wrap text-sm text-[#1f1a2e]">{detail.note || "No note."}</p>
            {goods && <p className="text-sm text-[#6e6680]">{goods}</p>}
            {detail.declineReason && (
              <p className="text-sm text-[#9a3412]">Declined: {detail.declineReason}</p>
            )}
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Defect images</h2>
            {detail.images.length === 0 ? (
              <p className="text-sm text-[#6e6680]">No images.</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {detail.images.map((image, i) => (
                  <Photo key={image.fileId} url={imageUrls[i] ?? null} alt={`Defect image ${i + 1} for ${detail.number}`} />
                ))}
              </div>
            )}
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
                  {detail.items.map((item) => (
                    <tr key={item.orderLineId} className="border-t border-[#efebf4]">
                      <td className="py-2">{item.product}</td>
                      <td className="py-2">{item.size}</td>
                      <td className="py-2 text-right">{item.quantity}</td>
                      <td className="py-2 text-right">{formatPesos(item.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto w-full max-w-[20rem] space-y-1 text-sm text-[#1f1a2e]">
              <div className="flex justify-between font-medium">
                <dt>Refund amount</dt>
                <dd>{formatPesos(detail.amount)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="space-y-5">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>History</h2>
            <ol className="space-y-3 text-sm text-[#1f1a2e]">
              {detail.history.map((step, i) => (
                <li key={i} className="space-y-0.5">
                  <p className="font-medium">{orderLabel(step.status)}</p>
                  <p className="text-xs text-[#6e6680]">
                    {step.actor.name}
                    {step.actor.type === "customer" ? " (Customer)" : ""} · {dateTime(step.at)}
                  </p>
                  {step.note && <p className="text-xs text-[#6e6680]">{step.note}</p>}
                </li>
              ))}
            </ol>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Order</h2>
            <dl className="space-y-1 text-sm text-[#1f1a2e]">
              <div className="flex justify-between">
                <dt className="text-[#6e6680]">Payment method</dt>
                <dd>{orderLabel(detail.paymentMethod)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[#6e6680]">Customer</dt>
                <dd>
                  <Link href={`/customer-profiles/${detail.customer.id}`} className="font-medium text-[#5b2a86]">
                    {detail.customer.name}
                  </Link>
                </dd>
              </div>
            </dl>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Delivery photo</h2>
            {deliveryPhotoUrl === undefined ? (
              <p className="text-sm text-[#6e6680]">No photo</p>
            ) : (
              <Photo url={deliveryPhotoUrl} alt={`Delivery photo for Order #${detail.orderId}`} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
