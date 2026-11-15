"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";
import { CARD, CARD_TITLE } from "@/features/tickets/ticket-detail";

import { OrderActionDialog } from "./action-dialog";
import { defaultMessage, FAILED_REASONS, historySummary, openAttempt, type FailedAttempt, type NextStep } from "./failed-delivery";
import { changeFailedDelivery } from "./failed-delivery-actions";

export interface FailedDeliveryOrder {
  id: number; status: string; customerName: string; paymentMethod: string; total: number;
  lines: { product: string; quantity: number }[];
}

const STEPS: { value: NextStep; title: string; text: string }[] = [
  { value: "rebook", title: "Re-deliver", text: "Book a courier again once the stock is checked." },
  { value: "request-cancellation", title: "Cancel the order", text: "Records that the Customer's Order should be cancelled; a Manager approves that separately." },
];

/** Reason and next step are local choices, so they react at once. Saving sends the Customer a message, so it waits for the server. */
function RecordForm({ order }: { order: FailedDeliveryOrder }) {
  const first = order.customerName.split(" ")[0] || "there";
  const [reason, setReason] = useState<string>(FAILED_REASONS[0]);
  const [step, setStep] = useState<NextStep>("rebook");
  const [message, setMessage] = useState(() => defaultMessage(first, order.id, "rebook"));
  const [edited, setEdited] = useState(false);
  // One reference per attempt: a retry after a timeout reuses it, so the storefront never records it twice.
  const attemptId = useRef(crypto.randomUUID());

  function chooseStep(next: NextStep) {
    setStep(next);
    if (!edited) setMessage(defaultMessage(first, order.id, next));
  }

  return (
    <section className={CARD} aria-label="Record the failed delivery">
      <h2 className={CARD_TITLE}>What happened</h2>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-[#18181b]">Reason</legend>
        <div className="flex flex-wrap gap-2">
          {FAILED_REASONS.map((value) => (
            <button key={value} type="button" aria-pressed={reason === value} onClick={() => setReason(value)}
              className={`rounded-full border px-3 py-[7px] text-[13px] font-medium ${reason === value ? "border-[#5b2a86] bg-[#5b2a86] text-white" : "border-[#e4e4e7] bg-white text-[#3f3f46]"}`}>
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-[#18181b]">What do we do now?</legend>
        {STEPS.map((s) => (
          <label key={s.value} className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${step === s.value ? "border-[#8b5cf6] bg-[#f5f0ff]" : "border-[#e4e4e7] bg-white"}`}>
            <input type="radio" name="next-step" checked={step === s.value} onChange={() => chooseStep(s.value)} className="mt-1" />
            <span><span className="block text-sm font-medium text-[#18181b]">{s.title}</span><span className="block text-xs text-[#71717a]">{s.text}</span></span>
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="failed-message" className="text-[13px] font-medium text-[#18181b]">Message to {first}</Label>
        <Textarea id="failed-message" value={message} onChange={(e) => { setMessage(e.target.value); setEdited(true); }} />
      </div>
      <OrderActionDialog
        trigger="Save and send message"
        triggerClassName="w-full"
        title={`Save the failed delivery of Order #${order.id}?`}
        description={`${first} is emailed this message. The Order stays dispatched.`}
        confirm="Save and send" busy="Saving…"
        disabled={!message.trim()}
        run={() => changeFailedDelivery(order.id, { action: "record", attemptId: attemptId.current, reason, nextStep: step, customerMessage: message.trim() })}
        successMessage={`Failed delivery saved. ${first} was sent the message.`}
      >
        <p className="text-[#3f3f46]">Reason: <span className="font-medium">{reason}</span></p>
        <p className="whitespace-pre-wrap rounded-[10px] bg-[#fafafa] p-3 text-[13px] text-[#18181b]">{message}</p>
      </OrderActionDialog>
    </section>
  );
}

function Rebook({ order, attempt }: { order: FailedDeliveryOrder; attempt: FailedAttempt }) {
  const [courier, setCourier] = useState<"Lalamove" | "Grab">("Lalamove");
  const [url, setUrl] = useState("");
  const valid = /^https:\/\/\S+$/.test(url.trim());
  return (
    <OrderActionDialog
      trigger="Re-deliver…"
      title={`Book a new courier for Order #${order.id}?`}
      description="The Customer is told the new booking. Do this before any stock is written off."
      confirm="Re-deliver" busy="Booking…"
      disabled={!valid}
      run={() => changeFailedDelivery(order.id, { action: "rebook", attemptId: attempt.id, courier: { name: courier, trackingUrl: url.trim() } })}
      successMessage={`Order #${order.id} is out for delivery again.`}
    >
      <div className="space-y-1.5">
        <Label htmlFor="rebook-courier" className="text-[13px] font-medium text-foreground">Courier</Label>
        <select id="rebook-courier" value={courier} onChange={(e) => setCourier(e.target.value as "Lalamove" | "Grab")} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
          <option>Lalamove</option><option>Grab</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="rebook-link" className="text-[13px] font-medium text-foreground">Booking share link <span className="text-[#dc2626]">*</span></Label>
        <Input id="rebook-link" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
    </OrderActionDialog>
  );
}

function Restock({ order, attempt }: { order: FailedDeliveryOrder; attempt: FailedAttempt }) {
  return (
    <OrderActionDialog
      trigger="Back to stock…"
      title={`Put Order #${order.id}'s goods back in stock?`}
      description="Check the goods are still safe to sell first. The stock system is updated, so this waits for it to answer."
      confirm="Back to stock" busy="Restocking…"
      run={() => changeFailedDelivery(order.id, { action: "restock", attemptId: attempt.id })}
      successMessage="The goods are back in stock."
    />
  );
}

/** Staff cannot write off: they ask a Manager and see "Request approval". Waits for the server either way. */
function WriteOff({ order, attempt, role, writeOff }: { order: FailedDeliveryOrder; attempt: FailedAttempt; role: ShopRole | null; writeOff: { approvalId?: string; waiting: boolean } }) {
  const [reason, setReason] = useState("");
  const staff = role === "staff";
  if (staff && writeOff.waiting && !writeOff.approvalId) {
    return <span className="rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">Waiting for approval</span>;
  }
  const request = staff && !writeOff.approvalId;
  return (
    <OrderActionDialog
      trigger={request ? "Request approval…" : "Write off…"}
      tone="destructive"
      title={request ? `Ask a Manager to write off Order #${order.id}'s goods` : `Write off Order #${order.id}'s goods?`}
      description={`The goods are recorded as a loss and cannot go back to stock afterwards. Above the Approval limit the CEO also approves.`}
      confirm={request ? "Send request" : "Write off"} busy={request ? "Sending…" : "Writing off…"}
      disabled={!writeOff.approvalId && staff && !reason.trim()}
      run={async () => {
        const result = await changeFailedDelivery(order.id, { action: "write-off", attemptId: attempt.id }, { reason, approvalId: writeOff.approvalId });
        return request && !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
      }}
      successMessage={request ? "Sent to a Manager. The Order shows Waiting for approval." : "The goods were written off."}
    >
      {!writeOff.approvalId && (
        <div className="space-y-1.5">
          <Label htmlFor="writeoff-reason" className="text-[13px] font-medium text-foreground">Reason {staff && <span className="text-[#dc2626]">*</span>}</Label>
          <Textarea id="writeoff-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the goods cannot be sold" />
        </div>
      )}
    </OrderActionDialog>
  );
}

function Outcome({ order, attempt, role, writeOff }: { order: FailedDeliveryOrder; attempt: FailedAttempt; role: ShopRole | null; writeOff: { approvalId?: string; waiting: boolean } }) {
  const can = role === "staff" || role === "manager";
  return (
    <section className={CARD} aria-label="Outcome">
      <h2 className={CARD_TITLE}>What happens to the goods?</h2>
      <p className="text-sm text-[#3f3f46]">
        {attempt.reason} · recorded by {attempt.staffName} on {formatDate(new Date(attempt.createdAt))}. Next step:{" "}
        {attempt.nextStep === "rebook" ? "re-deliver" : "cancel the Order"}.
      </p>
      {attempt.disposition ? (
        <p className="rounded-[10px] bg-[#e1f5ee] p-3 text-sm text-[#0f6e56]">
          {attempt.disposition === "restock" ? "The goods went back to stock." : "The goods were written off."}
        </p>
      ) : !can ? (
        <p className="text-xs text-[#71717a]">View only.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {attempt.nextStep === "rebook" && <Rebook order={order} attempt={attempt} />}
          <Restock order={order} attempt={attempt} />
          <WriteOff order={order} attempt={attempt} role={role} writeOff={writeOff} />
        </div>
      )}
      {attempt.nextStep === "request-cancellation" && (
        <p className="text-xs text-[#71717a]">
          Cancellation is requested from <Link href={`/orders/${order.id}`} className="text-[#5b2a86]">the Order</Link>. Nothing is cancelled or refunded here.
        </p>
      )}
    </section>
  );
}

/** Built from the Figma "Fulfilment · Failed delivery" frame, using only what the storefront and IMS tell CREOMS. */
export function FailedDeliveryView({ order, attempts, role, writeOff }: { order: FailedDeliveryOrder; attempts: FailedAttempt[]; role: ShopRole | null; writeOff: { approvalId?: string; waiting: boolean } }) {
  const open = openAttempt(attempts, order.id);
  const history = historySummary(attempts, order.id);
  const can = role === "staff" || role === "manager";
  const dispatched = order.status === "dispatched";
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">Failed delivery · Order #{order.id}</h1>
          <span className="rounded-full bg-[#fde8e8] px-2.5 py-[3px] text-xs font-medium text-[#b42318]">Failed delivery</span>
        </div>
        <p className="text-sm text-[#71717a]">
          {order.customerName} · {order.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")} · {formatPesos(order.total)}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {open ? <Outcome order={order} attempt={open} role={role} writeOff={writeOff} />
            : !dispatched ? <section className={CARD}><p className="text-sm text-[#6e6680]">Only a dispatched Delivery Order can have a failed delivery.</p></section>
            : !can ? <section className={CARD}><p className="text-sm text-[#6e6680]">View only. Staff and Managers record failed deliveries.</p></section>
            : <RecordForm order={order} />}
        </div>
        <section className={CARD} aria-label="Delivery history">
          <h2 className={CARD_TITLE}>{order.customerName.split(" ")[0]}&apos;s delivery history</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm text-[#18181b]">
            <div><dt className="text-xs text-[#71717a]">Failed before</dt><dd className="font-medium">{history.failedBefore === 0 ? "None" : `${history.failedBefore} (${history.reasons.join(", ")})`}</dd></div>
            <div><dt className="text-xs text-[#71717a]">Refused COD</dt><dd className="font-medium">{history.refusedCod}</dd></div>
          </dl>
          {attempts.length > 0 && (
            <ul className="space-y-1.5 text-xs text-[#71717a]">
              {attempts.map((a) => <li key={a.id}>Order #{a.orderId} · {formatDate(new Date(a.createdAt))} · {a.reason}</li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
