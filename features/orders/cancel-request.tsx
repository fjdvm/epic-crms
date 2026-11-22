"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { approveCancelRequest, declineCancelRequest } from "./actions";
import type { CancelRequestState } from "./cancel-request-state";

const PILL = "rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]";

/** Staff or a Manager decides. Approving cancels the Order, frees its stock and emails the Customer, so it waits for the server. */
function Decide({ id, state }: { id: number; state: CancelRequestState }) {
  const [decision, setDecision] = useState<"approve" | "decline">("approve");
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger="Review cancel request…"
      tone={decision === "decline" ? "destructive" : "primary"}
      title={`${state.requestedBy} asked to cancel Order #${id}`}
      description={`Reason given: ${state.reason}`}
      confirm={decision === "approve" ? "Approve and cancel" : "Decline request"} busy={decision === "approve" ? "Cancelling…" : "Declining…"}
      keepLabel="Decide later"
      disabled={decision === "decline" && !reason.trim()}
      run={() => decision === "approve" ? approveCancelRequest(id, state.requestId) : declineCancelRequest(id, state.requestId, reason)}
      successMessage={decision === "approve" ? `Order #${id} is cancelled and the Customer is emailed.` : "Declined. The Customer is emailed and the Order carries on."}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">Your decision</legend>
        {(["approve", "decline"] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input type="radio" name={`cancel-request-${id}`} checked={decision === value} onChange={() => setDecision(value)} />
            {value === "approve" ? "Approve: cancel the Order and release its stock" : "Decline: the Order carries on"}
          </label>
        ))}
      </fieldset>
      {decision === "decline" && (
        <div className="space-y-1.5">
          <Label htmlFor={`cancel-request-reason-${id}`} className="text-[13px] font-medium text-foreground">Reason the Customer will see <span className="text-[#dc2626]">*</span></Label>
          <Textarea id={`cancel-request-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
      )}
    </OrderActionDialog>
  );
}

/** The button for a waiting request: a decision for Staff and Managers with Orders, a read-only badge for everyone else. */
export function CancelRequestAction({ id, state, role, canDecide }: { id: number; state: CancelRequestState | null; role?: ShopRole | null; canDecide: boolean }) {
  if (state?.status !== "waiting") return null;
  if (canDecide && (role === "staff" || role === "manager")) return <Decide id={id} state={state} />;
  return <span className={PILL}>Customer asked to cancel</span>;
}

/** Tells everyone why the Order's actions are paused, and what happened to the last request. */
export function CancelRequestNote({ state }: { state: CancelRequestState | null }) {
  if (state?.status === "waiting") {
    return (
      <p role="note" aria-label="Cancellation requested" className="shrink-0 rounded-[10px] bg-[#fdf1d8] p-3 text-xs text-[#8a5a00]">
        {state.requestedBy} asked to cancel this Order: {state.reason}. Other actions are paused until someone approves or declines the request.
      </p>
    );
  }
  if (state?.status === "declined") {
    return (
      <p role="note" aria-label="Cancellation declined" className="shrink-0 rounded-[10px] bg-[#f4f4f5] p-3 text-xs text-[#52525b]">
        Cancel request declined{state.decidedBy ? ` by ${state.decidedBy}` : ""}{state.declineReason ? `: ${state.declineReason}` : "."}
      </p>
    );
  }
  return null;
}
