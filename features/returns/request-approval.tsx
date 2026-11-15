"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { approveReturn, declineReturn, markReturnRefunded, markReturnReplaced } from "./actions";
import type { ReturnResolution } from "./returns";

type Step = "approve" | "decline" | "refund" | "replace";
const LABELS: Record<Step, [string, string]> = {
  approve: ["Approve the return", "The Customer is told it is approved."],
  decline: ["Reject the return", "Customer is told why"],
  refund: ["Refund", "Paid back by the Customer's payment method, with proof."],
  replace: ["Send a replacement", "A ₱0 Replacement Order, packed and dispatched like any Order."],
};

/** Figma "Dialog · Request manager approval": what Staff suggest and why. Never optimistic: a Manager decides. */
export function RequestApproval({ id, number, steps, preferred }: { id: number; number: string; steps: Step[]; preferred: ReturnResolution }) {
  const [step, setStep] = useState<Step>(steps[0]);
  const [goodsRequired, setGoodsRequired] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const needsGoods = step === "approve";

  function run() {
    const options = { reason: note };
    if (step === "approve") return approveReturn(id, goodsRequired as boolean, preferred, options);
    if (step === "decline") return declineReturn(id, note, options);
    if (step === "refund") return markReturnRefunded(id, undefined, options);
    return markReturnReplaced(id, options);
  }

  return (
    <OrderActionDialog
      trigger="Request approval…"
      title="Ask a Manager to approve"
      description={`${number}. Replacements, refunds and rejections need a Manager. You can suggest one.`}
      confirm="Send request" busy="Sending…"
      disabled={!note.trim() || (needsGoods && goodsRequired === null)}
      run={async () => {
        const result = await run();
        // A waiting request is the expected answer here, not a refusal.
        return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
      }}
      successMessage="Sent to a Manager. The Return stays open and shows Waiting for approval."
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">What do you suggest?</legend>
        {steps.map((value) => (
          <label key={value} className="flex items-start gap-2 text-[#1f1a2e]">
            <input type="radio" name={`suggest-${id}`} checked={step === value} onChange={() => setStep(value)} className="mt-1" />
            <span><span className="block font-medium">{LABELS[value][0]}</span><span className="block text-xs text-[#6e6680]">{LABELS[value][1]}</span></span>
          </label>
        ))}
      </fieldset>
      {needsGoods && (
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-foreground">Must the goods come back?</legend>
          {([[true, "Yes"], [false, "No"]] as const).map(([value, label]) => (
            <label key={label} className="flex items-center gap-2"><input type="radio" name={`req-goods-${id}`} checked={goodsRequired === value} onChange={() => setGoodsRequired(value)} />{label}</label>
          ))}
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`request-note-${id}`} className="text-[13px] font-medium text-foreground">Note for the Manager <span className="text-[#dc2626]">*</span></Label>
        <Textarea id={`request-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you suggest this" />
      </div>
    </OrderActionDialog>
  );
}
