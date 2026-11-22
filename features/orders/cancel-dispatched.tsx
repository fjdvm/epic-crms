"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideApproval } from "@/features/approvals/actions";
import { orderLabel } from "@/features/customer-profiles/rules";
import { formatPesos } from "@/features/customer-profiles/format";
import { uploadFile } from "@/features/files/client";
import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { requestDispatchedCancellation, settleDispatchedCancellation } from "./cancellation-actions";
import type { CancellationState } from "./cancellation-state";
import { DeliveryPhotoPicker } from "./delivery-photo-picker";
import { isPrepaid } from "./payment-methods";

const PILL = "rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]";
const STEPS = [
  ["Cancel or reroute the booking with the courier", "Ask the rider to bring the box back to the store"],
  ["Rider returns the box", "Check the seal before restocking"],
  ["Decide what happens to the stock", "The result goes to the stock system"],
];

interface Props { id: number; total: number; paymentMethod: string; role?: ShopRole | null; state: CancellationState | null }

function Steps() {
  return (
    <ol className="space-y-2 rounded-[10px] bg-[#fafafa] p-3.5">
      <li className="text-[13px] font-medium text-[#18181b]">Do these in order</li>
      {STEPS.map(([title, text], i) => (
        <li key={title} className="flex gap-2.5 text-xs text-[#71717a]">
          <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#ece8f3] text-[11px] font-medium text-[#5b2a86]">{i + 1}</span>
          <span><span className="block text-[13px] font-medium text-[#18181b]">{title}</span>{text}</span>
        </li>
      ))}
    </ol>
  );
}

/** Staff and Managers both start it; a Staff request goes to a Manager. A request emails and alerts people, so it waits for the server. */
function Request({ id, role }: { id: number; role?: ShopRole | null }) {
  const [reason, setReason] = useState("");
  const staff = role === "staff";
  return (
    <OrderActionDialog
      trigger={staff ? "Request approval…" : "Cancel order…"}
      tone="destructive"
      title={`Cancel Order #${id}? It's already dispatched`}
      description="Cancelling after dispatch needs a Manager. Staff can send this as a request."
      confirm={staff ? "Send request" : "Cancel order"} busy="Sending…"
      keepLabel="Keep order"
      disabled={!reason.trim()}
      run={async () => {
        const result = await requestDispatchedCancellation(id, reason);
        // A new request always answers "Waiting for approval"; that is the success here.
        return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
      }}
      successMessage="Sent to a Manager. The Order shows Waiting for approval."
    >
      <Steps />
      <div className="space-y-1.5">
        <Label htmlFor={`cancel-reason-${id}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
        <Textarea id={`cancel-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the Order should be cancelled" />
      </div>
      <p className="text-xs text-[#71717a]">The Customer is emailed once a Manager decides.</p>
    </OrderActionDialog>
  );
}

/** The Manager's decision. Money and stock hang on it, so it is never optimistic. */
function Decide({ id, state, paymentMethod, total }: { id: number; state: CancellationState; paymentMethod: string; total: number }) {
  const [decision, setDecision] = useState<"approve" | "decline">("approve");
  const [reason, setReason] = useState("");
  const prepaid = isPrepaid(paymentMethod);
  return (
    <OrderActionDialog
      trigger="Review cancellation…"
      title={`Cancel Order #${id}? It's already dispatched`}
      description={`${state.requestedBy}: ${state.reason}`}
      confirm={decision === "approve" ? "Approve" : "Decline"} busy={decision === "approve" ? "Approving…" : "Declining…"}
      keepLabel="Keep order"
      tone={decision === "decline" ? "destructive" : "primary"}
      disabled={decision === "decline" && !reason.trim()}
      run={() => decideApproval("Fulfilment", state.requestId, decision, reason)}
      successMessage={decision === "approve" ? "Approved. Settle the refund and stock next." : "Declined. The Order stays dispatched."}
    >
      <Steps />
      <p className="rounded-[10px] bg-[#f5f0ff] p-3 text-[13px] text-[#3f3f46]">
        {prepaid ? `Refund ${formatPesos(total)} to the Customer's ${orderLabel(paymentMethod)}, with proof, after you approve.` : "Cash on Delivery: nothing was paid, so there is nothing to refund."}
      </p>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">Your decision</legend>
        {(["approve", "decline"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`decision-${id}`} checked={decision === value} onChange={() => setDecision(value)} />
            {value === "approve" ? "Approve the cancellation" : "Decline; the Order stays dispatched"}
          </label>
        ))}
      </fieldset>
      {decision === "decline" && (
        <div className="space-y-1.5">
          <Label htmlFor={`decline-reason-${id}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
          <Textarea id={`decline-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
    </OrderActionDialog>
  );
}

/** After approval the Manager picks the stock outcome and, for prepaid Orders, uploads the refund proof. */
function Settle({ id, state, paymentMethod, total }: { id: number; state: CancellationState; paymentMethod: string; total: number }) {
  const [outcome, setOutcome] = useState<"restock" | "write-off">("restock");
  const [proof, setProof] = useState<File | null>(null);
  const prepaid = isPrepaid(paymentMethod);
  return (
    <OrderActionDialog
      trigger="Refund and settle stock…"
      tone="destructive"
      title={`Settle Order #${id}'s cancellation`}
      description="The Order is cancelled, the stock system is updated and the Customer is emailed. This waits for the server."
      confirm="Cancel order" busy="Cancelling…"
      keepLabel="Keep order"
      disabled={prepaid && proof === null}
      run={async () => {
        const form = new FormData();
        if (prepaid) {
          const uploaded = await uploadFile("Fulfilment", proof as File);
          if (!uploaded.ok) return uploaded;
          form.set("proof", uploaded.reference);
        }
        return settleDispatchedCancellation(id, state.requestId, outcome, prepaid ? form : undefined);
      }}
      successMessage={`Order #${id} is cancelled.`}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">What happens to the stock?</legend>
        {([["restock", "Back to stock", "The box came back and is safe to sell."], ["write-off", "Write off", "The goods cannot be sold."]] as const).map(([value, title, text]) => (
          <label key={value} className={`flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 ${outcome === value ? "border-[#8b5cf6] bg-[#f5f0ff]" : "border-[#e4e4e7]"}`}>
            <input type="radio" name={`outcome-${id}`} checked={outcome === value} onChange={() => setOutcome(value)} className="mt-1" />
            <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-[#71717a]">{text}</span></span>
          </label>
        ))}
      </fieldset>
      {prepaid ? (
        <div className="space-y-2">
          <p className="text-[13px] text-[#3f3f46]">Refund {formatPesos(total)} through {orderLabel(paymentMethod)}, the way it was paid.</p>
          <DeliveryPhotoPicker photo={proof} onChange={setProof} label="Refund proof" />
        </div>
      ) : (
        <p className="text-[13px] text-[#3f3f46]">Cash on Delivery: no refund and no proof needed.</p>
      )}
    </OrderActionDialog>
  );
}

/** The cancel-after-dispatch action and its status on a dispatched Order. */
export function CancelDispatched({ id, total, paymentMethod, role, state }: Props) {
  const manager = role === "manager";
  const can = manager || role === "staff";
  if (state?.status === "waiting-manager" || state?.status === "waiting-ceo") {
    if (state.status === "waiting-manager" && manager) return <Decide id={id} state={state} paymentMethod={paymentMethod} total={total} />;
    return <span className={PILL}>{state.status === "waiting-ceo" ? "Waiting for final approval" : "Waiting for approval"}</span>;
  }
  if (state?.status === "approved") {
    return manager ? <Settle id={id} state={state} paymentMethod={paymentMethod} total={total} /> : <span className={PILL}>Approved, a Manager settles it</span>;
  }
  if (state?.status === "declined") return null;
  return can ? <Request id={id} role={role} /> : null;
}

/** Explains a declined request under the header, so nobody asks twice without knowing why. */
export function CancellationNote({ state }: { state: CancellationState | null }) {
  if (state?.status !== "declined") return null;
  return (
    <p role="note" aria-label="Cancellation declined" className="shrink-0 rounded-[10px] bg-[#fdf1d8] p-3 text-xs text-[#8a5a00]">
      Cancellation declined{state.declineReason ? `: ${state.declineReason}` : "."} The Order stays dispatched.
    </p>
  );
}
