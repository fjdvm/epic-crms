"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded } from "./actions";
import type { ReturnStatus } from "./returns";

/** The steps a Return in this state offers; mirrors the checks `decide` makes on the server. */
export function availableSteps(status: ReturnStatus, goodsRequired: boolean | null): ("approve" | "decline" | "receive" | "refund")[] {
  if (status === "requested") return ["approve", "decline"];
  if (status === "approved") return goodsRequired === true ? ["receive"] : goodsRequired === false ? ["refund"] : [];
  if (status === "goods received") return ["refund"];

  return [];
}

function Approve({ id, number }: { id: number; number: string }) {
  const [goodsRequired, setGoodsRequired] = useState<boolean | null>(null);

  return (
    <OrderActionDialog
      trigger="Approve"
      title={`Approve ${number}?`}
      description="The Customer is told the Return is approved."
      confirm="Approve Return"
      busy="Approving…"
      disabled={goodsRequired === null}
      run={() => approveReturn(id, goodsRequired as boolean)}
      successMessage={`${number} approved.`}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">
          Must the goods come back? <span className="text-[#dc2626]">*</span>
        </legend>
        {([[true, "Yes, the Customer returns the goods"], [false, "No, refund without the goods"]] as const).map(
          ([value, label]) => (
            <label key={String(value)} className="flex items-center gap-2 text-[#1f1a2e]">
              <input
                type="radio"
                name={`goods-required-${id}`}
                checked={goodsRequired === value}
                onChange={() => setGoodsRequired(value)}
              />
              {label}
            </label>
          ),
        )}
      </fieldset>
    </OrderActionDialog>
  );
}

function Decline({ id, number }: { id: number; number: string }) {
  const [reason, setReason] = useState("");

  return (
    <OrderActionDialog
      trigger="Decline"
      tone="destructive"
      title={`Decline ${number}?`}
      description="The Customer is told why. A declined Return cannot be reopened."
      confirm="Decline Return"
      busy="Declining…"
      keepLabel="Keep Return"
      disabled={!reason.trim()}
      run={() => declineReturn(id, reason)}
      successMessage={`${number} declined.`}
    >
      <div className="space-y-1.5">
        <Label htmlFor={`decline-reason-${id}`} className="text-[13px] font-medium text-foreground">
          Reason <span className="text-[#dc2626]">*</span>
        </Label>
        <Textarea
          id={`decline-reason-${id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this Return is declined"
        />
      </div>
    </OrderActionDialog>
  );
}

/** The Return's next steps, each behind a confirm dialog; refusals and uncertain answers surface as an error toast. */
export function ReturnActions({
  id,
  number,
  status,
  goodsRequired,
}: {
  id: number;
  number: string;
  status: ReturnStatus;
  goodsRequired: boolean | null;
}) {
  const steps = availableSteps(status, goodsRequired);

  return (
    <div className="flex items-center gap-2">
      {steps.includes("decline") && <Decline id={id} number={number} />}
      {steps.includes("approve") && <Approve id={id} number={number} />}
      {steps.includes("receive") && (
        <OrderActionDialog
          trigger="Mark goods received"
          title={`Mark goods received for ${number}?`}
          description="Confirm the returned goods have reached the store."
          confirm="Mark received"
          busy="Saving…"
          run={() => markReturnGoodsReceived(id)}
          successMessage={`${number} marked goods received.`}
        />
      )}
      {steps.includes("refund") && (
        <OrderActionDialog
          trigger="Mark refunded"
          title={`Mark ${number} refunded?`}
          description="Only confirm once the money has been paid back to the Customer outside CREOMS."
          confirm="Mark refunded"
          busy="Saving…"
          run={() => markReturnRefunded(id)}
          successMessage={`${number} marked refunded.`}
        />
      )}
    </div>
  );
}
