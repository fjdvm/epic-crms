"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { cancelPaymentOrder, markPaid, rejectPaymentProof } from "./actions";
import type { OrderDetail } from "./orders";
import { isPrepaid, MANAGER_AFTER_REJECTIONS } from "./payment-methods";

/** Marks an Order paid once its proof is checked. A rejected proof is handled by Reject or Ask for a new proof. */
export function MarkPaidDialog({ id, onMarkPaid }: { id: number; onMarkPaid?: () => void }) {
  return (
    <OrderActionDialog
      trigger="Mark paid"
      title={`Mark Order #${id} as paid?`}
      description="The Customer is told their payment was received."
      confirm="Mark paid"
      busy="Marking paid…"
      run={() => markPaid(id)}
      onOptimistic={onMarkPaid}
      successMessage={`Order #${id} marked paid.`}
    />
  );
}

/** The Payments Module's cancel, checked on its own Module rather than the Orders one. */
export function CancelPaymentDialog({ id }: { id: number }) {
  return (
    <OrderActionDialog
      trigger="Cancel order"
      title={`Cancel Order #${id}?`}
      description="This cannot be undone."
      confirm="Cancel order"
      busy="Cancelling…"
      keepLabel="Keep order"
      tone="destructive"
      run={() => cancelPaymentOrder(id)}
      successMessage={`Order #${id} cancelled.`}
    />
  );
}

const REASONS = ["The receipt is blurry or cut off", "The amount does not match the Order", "The reference number does not match", "The payment is not in the shop's account"];

function ReasonField({ id, value, onChange, label }: { id: string; value: string; onChange: (text: string) => void; label: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-foreground">{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Figma "Dialog · Reject receipt". Emails the Customer, so it waits for the server and is never optimistic. */
export function RejectProofDialog({ id }: { id: number }) {
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger="Reject receipt"
      title={`Reject the receipt for Order #${id}?`}
      description="The Customer is emailed your reason and a link to upload again. The Order stays awaiting payment."
      confirm="Reject receipt"
      busy="Rejecting…"
      tone="destructive"
      disabled={!reason.trim()}
      run={() => rejectPaymentProof(id, reason)}
      successMessage={`Receipt for Order #${id} rejected. The Customer can upload again.`}
    >
      <ReasonField id={`reject-reason-${id}`} label="Reason (the Customer sees this)" value={reason} onChange={setReason} />
    </OrderActionDialog>
  );
}

/** Figma "Dialog · Ask for a new payment proof": a ready reason to pick, plus a note. */
export function AskNewProofDialog({ id }: { id: number }) {
  const [choice, setChoice] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const reason = note.trim() ? `${choice}. ${note.trim()}` : choice;
  return (
    <OrderActionDialog
      trigger="Ask for a new proof"
      triggerClassName="bg-background text-foreground border border-input hover:bg-accent"
      title={`Ask for a new payment proof on Order #${id}?`}
      description="The Customer is emailed a link to send a new reference number and screenshot."
      confirm="Ask for a new proof"
      busy="Sending…"
      run={() => rejectPaymentProof(id, reason)}
      successMessage={`Asked the Customer for a new proof on Order #${id}.`}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">What is wrong with it?</legend>
        {REASONS.map((value) => (
          <label key={value} className="flex items-start gap-2 text-[#1f1a2e]">
            <input type="radio" name={`ask-reason-${id}`} checked={choice === value} onChange={() => setChoice(value)} className="mt-1" />
            <span>{value}</span>
          </label>
        ))}
      </fieldset>
      <ReasonField id={`ask-note-${id}`} label="Note for the Customer (optional)" value={note} onChange={setNote} />
    </OrderActionDialog>
  );
}

/**
 * Figma "Dialog · Approve anyway", after 3 rejected proofs. A Manager approves with a reason. Staff see
 * "Request approval" instead, then "Approve anyway" once a Manager has approved their request.
 */
export function ApproveAnywayDialog({ id, role, approvalId, waiting = false, reusedOn = [] }: { id: number; role: ShopRole | null; approvalId?: string; waiting?: boolean; reusedOn?: number[] }) {
  const [reason, setReason] = useState("");
  // A reused reference must say which Order the transfer pays: this one or an Order that already used it.
  const [pays, setPays] = useState(id);
  const staff = role === "staff";
  if (staff && waiting && !approvalId) {
    return <span className="rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">Waiting for approval</span>;
  }
  const request = staff && !approvalId;
  return (
    <OrderActionDialog
      trigger={request ? "Request approval…" : "Approve anyway"}
      title={request ? `Ask a Manager to approve Order #${id} anyway` : `Approve Order #${id} anyway?`}
      description={reusedOn.length
        ? `This payment reference was already used on ${reusedOn.map(n => `Order #${n}`).join(", ")}, so only a Manager can approve this payment. The reason is kept on the Order.`
        : `${MANAGER_AFTER_REJECTIONS} receipts were rejected, so only a Manager can approve this payment. The reason is kept on the Order.`}
      confirm={request ? "Send request" : "Approve anyway"}
      busy={request ? "Sending…" : "Approving…"}
      disabled={!approvalId && !reason.trim()}
      run={async () => {
        const result = await markPaid(id, { reason, approvalId, ...(reusedOn.length ? { allocateToOrderId: pays } : {}) });
        // A waiting request is the expected answer for Staff, not a refusal.
        return request && !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
      }}
      successMessage={request ? "Sent to a Manager. The Order shows Waiting for approval." : `Order #${id} approved and marked paid.`}
    >
      {reusedOn.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground">Which Order does this transfer pay? One transfer pays one Order.</legend>
          {[id, ...reusedOn].map(n => (
            <label key={n} className="flex items-start gap-2 text-[#1f1a2e]">
              <input type="radio" name={`pays-${id}`} checked={pays === n} onChange={() => setPays(n)} className="mt-1" />
              <span>Order #{n}{n === id ? " (this Order)" : ""}</span>
            </label>
          ))}
        </fieldset>
      )}
      {!approvalId && <ReasonField id={`approve-reason-${id}`} label="Reason" value={reason} onChange={setReason} />}
    </OrderActionDialog>
  );
}

/** Whether Staff can check this Order's Payment proof now: a prepaid Order awaiting payment with proof submitted. */
function canCheckPayment(order: OrderDetail): boolean {
  return order.status === "awaiting payment" && isPrepaid(order.paymentMethod) && order.paymentProof !== null;
}

/**
 * The Payments Module's actions on an Order's detail. `withCancel` is false for Staff who also hold the
 * Orders Module, whose own actions already offer cancel. Admin and the CEO only view.
 */
export function PaymentsActions({ order, withCancel, role = "staff", approvalId, waiting }: {
  order: OrderDetail; withCancel: boolean; role?: ShopRole | null; approvalId?: string; waiting?: boolean;
}) {
  if (role === "admin" || role === "ceo" || role === null) return null;
  const rejected = order.paymentProof?.rejectedAt != null;
  const capped = order.proofRejections >= MANAGER_AFTER_REJECTIONS;
  const reusedOn = order.paymentProofs.at(-1)?.checks?.reference.otherOrderIds ?? [];
  const needsManager = capped || reusedOn.length > 0;
  return (
    <>
      {withCancel && order.status === "awaiting payment" && <CancelPaymentDialog id={order.id} />}
      {canCheckPayment(order) && !rejected && !capped && (
        <>
          <RejectProofDialog id={order.id} />
          <AskNewProofDialog id={order.id} />
        </>
      )}
      {canCheckPayment(order) && !rejected && !needsManager && <MarkPaidDialog id={order.id} />}
      {canCheckPayment(order) && (capped || (!rejected && reusedOn.length > 0)) && (
        <ApproveAnywayDialog id={order.id} role={role} approvalId={approvalId} waiting={waiting} reusedOn={reusedOn} />
      )}
    </>
  );
}
