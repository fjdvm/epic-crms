"use client";

import { useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { claimPaymentReview, loadReviewManagers, reassignPaymentReview } from "./payment-review-actions";
import type { PaymentReview } from "./payment-review";

function ReassignDialog({ id, review }: { id: number; review: PaymentReview }) {
  const [managers, setManagers] = useState<{ id: string; name: string }[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");

  // Opened on demand by the dialog, never on a timer.
  useEffect(() => {
    let live = true;
    loadReviewManagers().then(r => {
      if (!live) return;
      if (r.ok) setManagers(r.managers.filter(m => m.id !== review.owner?.id)); else setFailure(r.reason);
    }, () => live && setFailure("Managers could not be loaded. Try again."));
    return () => { live = false; };
  }, [review.owner?.id]);

  return (
    <OrderActionDialog
      trigger="Reassign"
      triggerClassName="bg-white text-[#5b2a86] border border-[#d9cce8] hover:bg-[#f6f2fa]"
      title={`Hand over the payment review on Order #${id}?`}
      description="The new owner is audited with your reason."
      confirm="Reassign"
      busy="Reassigning…"
      disabled={!to || !reason.trim()}
      run={() => reassignPaymentReview(id, to, reason)}
      successMessage="Payment review reassigned."
    >
      {failure && <p role="alert" className="text-[13px] text-[#b91c1c]">{failure}</p>}
      <div className="space-y-1.5">
        <Label htmlFor={`review-owner-${id}`} className="text-[13px] font-medium text-foreground">New owner</Label>
        <select id={`review-owner-${id}`} value={to} onChange={e => setTo(e.target.value)} disabled={!managers}
          className="w-full rounded-md border border-[#e4e4e7] bg-white px-3 py-2 text-sm">
          <option value="">{managers ? "Choose a Manager" : "Loading Managers…"}</option>
          {managers?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`review-reason-${id}`} className="text-[13px] font-medium text-foreground">Reason</Label>
        <Textarea id={`review-reason-${id}`} value={reason} onChange={e => setReason(e.target.value)} />
      </div>
    </OrderActionDialog>
  );
}

/**
 * The Manager payment review on an Order with 3 rejected proofs. Opening the Order never claims it: only
 * "Claim review" does. Claiming and reassigning wait for the server (a Manager decision, never optimistic).
 * Only a Manager sees the buttons; Staff, Admin and the CEO see the state. Nothing here cancels the Order.
 */
export function PaymentReviewPanel({ id, review, role }: { id: number; review: PaymentReview; role: ShopRole | null }) {
  const manager = role === "manager";
  return (
    <section data-testid="payment-review" className="space-y-2 rounded-lg border border-[#e8d8a8] bg-[#fdf1d8] p-3 text-[13px] text-[#8a5a00]">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        Manager payment review
        {review.overdue && <span className="rounded-full bg-[#fee2e2] px-2 py-0.5 text-xs font-medium text-[#b91c1c]">Overdue</span>}
      </p>
      <p>
        Started {formatDate(review.startedAt)} after the third rejected proof.
        {review.deadline && <> Target {formatDate(review.deadline)}.</>}
        {" "}Nothing is cancelled automatically and the stock stays reserved until a Manager acts.
      </p>
      <p>{review.owner ? <>Owner: <b>{review.owner.name}</b> since {formatDate(review.owner.claimedAt)}.</> : "Nobody has claimed this review yet."}</p>
      {manager && (
        <div className="flex flex-wrap gap-2 pt-1">
          {!review.owner && (
            <OrderActionDialog
              trigger="Claim review"
              title={`Claim the payment review on Order #${id}?`}
              description="You become its owner. Opening an Order never claims it."
              confirm="Claim review"
              busy="Claiming…"
              run={() => claimPaymentReview(id)}
              successMessage="You now own this payment review."
            />
          )}
          <ReassignDialog id={id} review={review} />
        </div>
      )}
      {!manager && <p className="text-xs">A Manager verifies the real transfer, then marks the Order paid or cancels it.</p>}
    </section>
  );
}
