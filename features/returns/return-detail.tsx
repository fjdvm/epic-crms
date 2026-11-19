import { BackButton } from "@/components/shared/back-button";
import Link from "next/link";

import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

import type { ApprovalView } from "@/features/approvals/view";
import type { ShopRole } from "@/lib/portal/roles";
import { ProofReadFindings } from "@/features/orders/proof-read-view";
import type { ProofReadView } from "@/features/orders/proof-read";
import { EmailNotSent } from "@/features/orders/email-not-sent";
import { InspectReturn } from "./inspect-return";
import { OptimisticReturn, ReturnStatusPill, type SavedProof } from "./optimistic-status";
import { correctRefundReading, proceedDespiteRefundFlag } from "./refund-proof-actions";
import { refundMethodLabel, returnLabel } from "./refund-record";
import { RefundDestinationCard } from "./refund-destination-card";
import { mayChangeDestination } from "./refund-destination";
import { RefundWindow } from "./refund-window";
import { ReturnActions } from "./return-actions";
import { ReturnFlagNotes } from "./return-flag-notes";
import type { ReturnFlag } from "./return-flags";
import type { ReturnDetail } from "./returns";

/** A short-lived address per image, null when that image exists but could not be reached. */
export type ImageUrls = (string | null)[];

const time = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const dateTime = (date: Date) => `${formatDate(date)}, ${time.format(date)}`;

function Photo({ url, alt }: { url: string | null; alt: string }) {
  if (!url) return <p className="text-sm text-[#6e6680]">This image could not be loaded. Reload to try again.</p>;

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className="max-h-64 rounded-md border border-[#e6e1ee]" />;
}

/** The details Staff saved with the proof, shown until the Return is marked Refunded. */
function SavedProofDetails({ proof }: { proof: SavedProof | null }) {
  if (!proof) return null;

  return (
    <dl className="space-y-1 text-sm text-[#1f1a2e]">
      <div className="flex justify-between gap-3"><dt>Amount sent</dt><dd>{formatPesos(proof.amountInCentavos)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Sent by</dt><dd>{refundMethodLabel(proof.method)}</dd></div>
      <div className="flex justify-between gap-3"><dt>Date</dt><dd>{proof.refundedOn}</dd></div>
      <div className="flex justify-between gap-3"><dt>Reference</dt><dd className="break-all text-right">{proof.reference}</dd></div>
      <p className="text-xs text-[#6e6680]">Saved, not marked Refunded yet. Check the findings below, then mark the Return refunded.</p>
    </dl>
  );
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
  videoUrl,
  refundProofUrl,
  refundRead,
  savedProof = null,
  role,
  requests,
  windowRequest,
  destinationRequest,
  flags,
  flagExplanations,
}: {
  detail: ReturnDetail;
  imageUrls: ImageUrls;
  /** Null when the Delivery photo exists but could not be reached; undefined when the Order has none. */
  deliveryPhotoUrl?: string | null;
  /** Null when the evidence video exists but could not be reached. */
  videoUrl?: string | null;
  /** Null when the refund proof exists but could not be reached. */
  refundProofUrl?: string | null;
  /** The Proof reader's stored result for the refund proof (#614); display only. */
  refundRead?: ProofReadView | null;
  /** The refund proof and details Staff saved before marking the Return Refunded, with what still needs settling (#615). */
  savedProof?: SavedProof | null;
  role?: ShopRole | null;
  requests?: ApprovalView[];
  /** The Staff request to extend this Order's Refund window, if any. */
  windowRequest?: ApprovalView;
  /** The Staff request to change this Return's Refund destination, if any. */
  destinationRequest?: ApprovalView;
  /** Why this Return is flagged, for Staff to double-check. Nothing here blocks the Return. */
  flags?: ReturnFlag[];
  /** Kept explanations by rule, for Managers, Admin and CEO; absent for Staff. */
  flagExplanations?: Partial<Record<ReturnFlag["rule"], string>>;
}) {
  const goods = goodsLine(detail);

  return (
    <OptimisticReturn status={detail.status}>
    <div className="flex flex-col gap-5 px-8 py-7 lg:h-[calc(100vh-4rem)] lg:overflow-hidden">
      <div className="shrink-0 space-y-2">
        <div className="self-start"><BackButton fallbackHref="/returns" label="Returns" /></div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">{detail.number}</h1>
              <ReturnStatusPill status={detail.status} goodsRequired={detail.goodsRequired} />
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
            preferredResolution={detail.preferredResolution}
            finalResolution={detail.finalResolution}
            role={role}
            requests={requests}
            refund={{ customerName: detail.customer.name, amount: detail.amount, paymentMethod: detail.paymentMethod, destinationMethod: detail.refundDestination?.method ?? null, saved: savedProof, deliveryFee: detail.deliveryFeeRefundable ? detail.orderDeliveryFee : 0, items: detail.items.map((item) => ({ name: `${item.product} · ${item.size}`, quantity: item.quantity })) }}
          />
        </div>
      </div>

      {detail.emailFailures && detail.emailFailures.length > 0 && (
        <div className="shrink-0"><EmailNotSent orderId={detail.orderId} failures={detail.emailFailures} role={role} /></div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:overflow-y-auto">
        <div className="space-y-5">
          {flags && flags.length > 0 && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Flags</h2>
              <ReturnFlagNotes flags={flags} explain={{ returnId: detail.id, canExplain: role === "manager", kept: flagExplanations ?? {} }} />
              <p className="text-xs text-[#6e6680]">Flags are a prompt to double-check. They never block or decline a Return.</p>
            </section>
          )}

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Reason</h2>
            <p className="text-sm font-medium text-[#1f1a2e]">{orderLabel(detail.reason)}</p>
            <p className="whitespace-pre-wrap text-sm text-[#1f1a2e]">{detail.note || "No note."}</p>
            <p className="text-sm text-[#6e6680]">Customer preferred: {orderLabel(detail.preferredResolution)}</p>
            {detail.finalResolution && (
              <p className="text-sm text-[#6e6680]">Staff decided: {orderLabel(detail.finalResolution)}</p>
            )}
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
            <h2 className={CARD_TITLE}>Video</h2>
            {!detail.videoFileId ? (
              <p className="text-sm text-[#6e6680]">No video.</p>
            ) : videoUrl ? (
              <video src={videoUrl} controls className="max-h-64 rounded-md border border-[#e6e1ee]" />
            ) : (
              <p className="text-sm text-[#6e6680]">The video could not be loaded. Reload to try again.</p>
            )}
          </section>

          {detail.items.length > 0 && ["goods received", "refunded", "replaced"].includes(detail.status) && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Inspect what came back</h2>
              <InspectReturn id={detail.id} number={detail.number} status={detail.status} items={detail.items} role={role} requests={requests} />
            </section>
          )}

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
              <div className="flex justify-between">
                <dt>Items</dt>
                <dd>{formatPesos(detail.amount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Delivery fee</dt>
                <dd>{formatPesos(detail.deliveryFeeRefunded)}</dd>
              </div>
              {detail.deliveryFeeRefundable && detail.deliveryFeeRefunded === 0 && (
                <p className="text-xs text-[#6e6680]">Not included. A Manager may add the {formatPesos(detail.orderDeliveryFee)} Delivery fee when the refund is issued.</p>
              )}
              <div className="flex justify-between font-medium">
                <dt>Refund amount</dt>
                <dd>{formatPesos(detail.amount + detail.deliveryFeeRefunded)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div className="space-y-5">
          {detail.refundRecord && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Refund sent</h2>
              <dl className="space-y-1 text-sm text-[#1f1a2e]">
                <div className="flex justify-between gap-3"><dt>Amount</dt><dd>{formatPesos(detail.refundRecord.amountInCentavos)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Sent by</dt><dd>{refundMethodLabel(detail.refundRecord.method)}</dd></div>
                <div className="flex justify-between gap-3"><dt>Date</dt><dd>{formatDate(new Date(`${detail.refundRecord.refundedOn}T00:00:00+08:00`))}</dd></div>
                <div className="flex justify-between gap-3"><dt>Reference</dt><dd className="break-all text-right">{detail.refundRecord.reference}</dd></div>
              </dl>
            </section>
          )}
          <section className={CARD}>
            <h2 className={CARD_TITLE}>History</h2>
            <ol className="space-y-3 text-sm text-[#1f1a2e]">
              {detail.history.map((step, i) => (
                <li key={i} className="space-y-0.5">
                  <p className="font-medium">{returnLabel(step.status)}</p>
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
                  {detail.customer.deleted ? (
                    <span data-testid="deleted-customer-tag" className="font-medium text-[#6e6680]">{detail.customer.name}</span>
                  ) : (
                    <Link href={`/customer-profiles/${detail.customer.id}`} className="font-medium text-[#5b2a86]">
                      {detail.customer.name}
                    </Link>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {(detail.preferredResolution === "refund" || detail.finalResolution === "refund") && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Refund destination</h2>
              <RefundDestinationCard returnId={detail.id} destination={detail.refundDestination} locked={detail.refundDestinationLocked}
                canReveal={detail.finalResolution === "refund" && (detail.status === "goods received" || (detail.status === "approved" && detail.goodsRequired === false))}
                canChange={mayChangeDestination(detail.status, detail.finalResolution)} role={role} request={destinationRequest} />
            </section>
          )}

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Refund window</h2>
            <RefundWindow orderId={detail.orderId} endsAt={detail.refundWindowEndsAt?.toISOString() ?? null}
              extended={detail.refundWindowExtendedAt !== null} delivered={detail.orderStatus === "delivered"} role={role} request={windowRequest} />
          </section>

          {detail.replacementOrderId && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Replacement Order</h2>
              <p className="text-sm text-[#1f1a2e]">
                <Link href={`/orders/${detail.replacementOrderId}`} className="font-medium text-[#5b2a86]">Order #{detail.replacementOrderId}</Link>
                {" "}· ₱0, packed and dispatched like any Order. The shop pays the courier.
              </p>
            </section>
          )}

          {(detail.refundProofFileId || savedProof) && (
            <section className={CARD}>
              <h2 className={CARD_TITLE}>Refund proof</h2>
              <Photo url={refundProofUrl ?? null} alt={`Refund proof for ${detail.number}`} />
              {!detail.refundRecord && <SavedProofDetails proof={savedProof} />}
              <ProofReadFindings read={refundRead} role={role ?? null} subject="refund"
                changes={savedProof && detail.status !== "refunded" ? { correct: correctRefundReading.bind(null, detail.id), proceed: proceedDespiteRefundFlag.bind(null, detail.id) } : undefined} />
            </section>
          )}

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Delivery photo</h2>
            {deliveryPhotoUrl === undefined ? (
              <p className="text-sm text-[#6e6680]">
                {detail.deliveryPhotoRemovedAt ? "The Delivery photo was removed." : "No photo"}
              </p>
            ) : (
              <Photo url={deliveryPhotoUrl} alt={`Delivery photo for Order #${detail.orderId}`} />
            )}
          </section>
        </div>
      </div>
    </div>
    </OptimisticReturn>
  );
}
