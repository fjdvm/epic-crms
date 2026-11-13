"use client";

import { useState } from "react";
import { uploadFile } from "@/features/files/client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { DeliveryPhotoPicker } from "@/features/orders/delivery-photo-picker";

import { approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded, markReturnReplaced } from "./actions";
import type { ReturnResolution, ReturnStatus } from "./returns";

type Step = "approve" | "decline" | "receive" | "refund" | "replace";

/** The steps a Return in this state offers; mirrors the checks `decide` makes on the server. */
export function availableSteps(
  status: ReturnStatus,
  goodsRequired: boolean | null,
  finalResolution: ReturnResolution | null,
): Step[] {
  if (status === "requested") return ["approve", "decline"];
  const finish: Step[] = finalResolution === "refund" ? ["refund"] : finalResolution === "replacement" ? ["replace"] : [];
  if (status === "approved") return goodsRequired === true ? ["receive"] : goodsRequired === false ? finish : [];
  if (status === "goods received") return finish;

  return [];
}

const RESOLUTIONS: [ReturnResolution, string][] = [["refund", "Refund"], ["replacement", "Replacement"]];

function Approve({ id, number, preferred }: { id: number; number: string; preferred: ReturnResolution }) {
  const [goodsRequired, setGoodsRequired] = useState<boolean | null>(null);
  const [resolution, setResolution] = useState<ReturnResolution>(preferred);

  return (
    <OrderActionDialog
      trigger="Approve"
      title={`Approve ${number}?`}
      description="The Customer is told the Return is approved."
      confirm="Approve Return"
      busy="Approving…"
      disabled={goodsRequired === null}
      run={() => approveReturn(id, goodsRequired as boolean, resolution)}
      successMessage={`${number} approved.`}
    >
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-medium text-foreground">Resolution</legend>
        {RESOLUTIONS.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-[#1f1a2e]">
            <input
              type="radio"
              name={`resolution-${id}`}
              checked={resolution === value}
              onChange={() => setResolution(value)}
            />
            {label}
            {value === preferred && <span className="text-xs text-[#6e6680]">(Customer&apos;s preference)</span>}
          </label>
        ))}
      </fieldset>
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

function Refund({ id, number }: { id: number; number: string }) {
  const [proof, setProof] = useState<File | null>(null);

  return (
    <OrderActionDialog
      trigger="Mark refunded"
      title={`Mark ${number} refunded?`}
      description="Only confirm once the money has been paid back to the Customer outside CREOMS. The Customer can see the proof."
      confirm="Mark refunded"
      busy="Saving…"
      disabled={proof === null}
      run={async () => {
        const uploaded = await uploadFile("Returns", proof as File);
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("proof", uploaded.reference);

        return markReturnRefunded(id, form);
      }}
      successMessage={`${number} marked refunded.`}
    >
      <DeliveryPhotoPicker photo={proof} onChange={setProof} label="Refund proof" />
    </OrderActionDialog>
  );
}

/** The Return's next steps, each behind a confirm dialog; refusals and uncertain answers surface as an error toast. */
export function ReturnActions({
  id,
  number,
  status,
  goodsRequired,
  preferredResolution,
  finalResolution,
}: {
  id: number;
  number: string;
  status: ReturnStatus;
  goodsRequired: boolean | null;
  preferredResolution: ReturnResolution;
  finalResolution: ReturnResolution | null;
}) {
  const steps = availableSteps(status, goodsRequired, finalResolution);

  return (
    <div className="flex items-center gap-2">
      {steps.includes("decline") && <Decline id={id} number={number} />}
      {steps.includes("approve") && <Approve id={id} number={number} preferred={preferredResolution} />}
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
      {steps.includes("refund") && <Refund id={id} number={number} />}
      {steps.includes("replace") && (
        <OrderActionDialog
          trigger="Mark replaced"
          title={`Mark ${number} replaced?`}
          description="Only confirm once the replacement has been sent to the Customer."
          confirm="Mark replaced"
          busy="Saving…"
          run={() => markReturnReplaced(id)}
          successMessage={`${number} marked replaced.`}
        />
      )}
    </div>
  );
}
