"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { uploadFile } from "@/features/files/client";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { DeliveryPhotoPicker } from "@/features/orders/delivery-photo-picker";

import type { ApprovalView } from "@/features/approvals/view";
import { waitingLabel, WAITING } from "@/features/approvals/view";
import { formatPesos } from "@/features/customer-profiles/format";
import { refundDestination } from "@/features/orders/payment-methods";
import type { ShopRole } from "@/lib/portal/roles";
import { approveReturn, declineReturn, markReturnGoodsReceived, markReturnRefunded, markReturnReplaced } from "./actions";
import { RequestApproval } from "./request-approval";
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

/** Only an approved request adds an argument, so everyday calls stay as they were. */
const withApproval = (approvalId?: string) => (approvalId ? [{ approvalId }] : []);

const RESOLUTIONS: [ReturnResolution, string][] = [["refund", "Refund"], ["replacement", "Replacement"]];

function Approve({ id, number, preferred, approvalId }: { id: number; number: string; preferred: ReturnResolution; approvalId?: string }) {
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
      run={() => approveReturn(id, goodsRequired as boolean, resolution, ...withApproval(approvalId))}
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

function Decline({ id, number, approvalId }: { id: number; number: string; approvalId?: string }) {
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
      run={() => declineReturn(id, reason, ...withApproval(approvalId))}
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

/** What the Figma "Issue refund" dialog shows about the Return being refunded. */
export interface RefundContext { customerName: string; amount: number; paymentMethod: string; items: { name: string; quantity: number }[] }

function Refund({ id, number, approvalId, context }: { id: number; number: string; approvalId?: string; context?: RefundContext }) {
  const [proof, setProof] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const destination = context ? refundDestination(context.paymentMethod) : null;
  const amount = context ? formatPesos(context.amount) : null;

  return (
    <OrderActionDialog
      trigger="Issue refund"
      title="Issue refund"
      description={context
        ? `${number} · ${context.customerName} · paid ${amount}${destination ? ` via ${destination}` : ""}`
        : "Only confirm once the money has been paid back to the Customer outside CREOMS. The Customer can see the proof."}
      confirm={amount ? `Refund ${amount}` : "Mark refunded"}
      busy="Saving…"
      disabled={proof === null}
      run={async () => {
        const uploaded = await uploadFile("Returns", proof as File);
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("proof", uploaded.reference);

        return approvalId || note.trim() ? markReturnRefunded(id, form, { approvalId, reason: note }) : markReturnRefunded(id, form);
      }}
      successMessage={`${number} marked refunded.`}
    >
      {context && (
        <>
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-[#27272a]">Items to refund</p>
            {context.items.map((item) => (
              <p key={item.name} className="flex items-center gap-2.5 text-sm text-[#18181b]">
                <Check aria-hidden className="size-4 rounded bg-[#7c3aed] p-0.5 text-white" />
                <span>{item.name} × {item.quantity}</span>
              </p>
            ))}
          </div>
          {destination && (
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-[#27272a]">Refund to</p>
              <div className="rounded-lg border-[1.5px] border-[#8b5cf6] bg-[#f5f0ff] px-3 py-2.5">
                <p className="text-sm font-medium text-[#18181b]">Send back by {destination}</p>
                <p className="text-xs text-[#71717a]">Send {amount} to the Customer, then upload proof below</p>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-[#27272a]">Refund amount</p>
            <p className="rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-sm text-[#18181b]">{amount}</p>
            <p className="text-xs text-[#71717a]">The amount paid for these items.</p>
          </div>
        </>
      )}
      <DeliveryPhotoPicker photo={proof} onChange={setProof} label="Refund proof" />
      {context && <p className="rounded-lg bg-[#fffbeb] px-3 py-2.5 text-[13px] text-[#92400e]">Recorded on the Return once proof is uploaded. The Order status does not change.</p>}
      {!approvalId && (
        <div className="space-y-1.5">
          <Label htmlFor={`refund-note-${id}`} className="text-[13px] font-medium text-foreground">Note for the CEO, if the amount needs their final approval</Label>
          <Textarea id={`refund-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
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
  role = "manager",
  requests = [],
  refund,
}: {
  id: number;
  number: string;
  status: ReturnStatus;
  goodsRequired: boolean | null;
  preferredResolution: ReturnResolution;
  finalResolution: ReturnResolution | null;
  role?: ShopRole | null;
  /** This Return's approval requests visible to the viewer. */
  requests?: ApprovalView[];
  /** What the Issue refund dialog shows; without it the dialog is the plain confirmation. */
  refund?: RefundContext;
}) {
  const steps = availableSteps(status, goodsRequired, finalResolution);
  if (role === "admin" || role === "ceo" || role === null) return <p className="text-sm text-[#71717a]">View only</p>;
  const waiting = requests.find((r) => WAITING.includes(r.status));
  const ready = (action: string) => requests.find((r) => r.status === "approved" && r.action === action)?.id;
  const gated = steps.filter((s) => s !== "receive");
  if (role === "staff") {
    const finishable = gated.filter((s) => ready(`return.${s}`));
    return (
      <div className="flex flex-col items-end gap-2">
        {waiting && <span className="rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">{waitingLabel(waiting.status)}</span>}
        <div className="flex items-center gap-2">
          {steps.includes("receive") && (
            <OrderActionDialog trigger="Mark goods received" title={`Mark goods received for ${number}?`} description="Confirm the returned goods have reached the store."
              confirm="Mark received" busy="Saving…" run={() => markReturnGoodsReceived(id)} successMessage={`${number} marked goods received.`} />
          )}
          {finishable.includes("refund") && <Refund id={id} number={number} approvalId={ready("return.refund")} context={refund} />}
          {finishable.includes("approve") && <Approve id={id} number={number} preferred={preferredResolution} approvalId={ready("return.approve")} />}
          {finishable.includes("decline") && <Decline id={id} number={number} approvalId={ready("return.decline")} />}
          {finishable.includes("replace") && (
            <OrderActionDialog trigger="Carry out approved replacement" title={`Mark ${number} replaced?`} description="Only confirm once the replacement has been sent to the Customer."
              confirm="Mark replaced" busy="Saving…" run={() => markReturnReplaced(id, ...withApproval(ready("return.replace")))} successMessage={`${number} marked replaced.`} />
          )}
          {!waiting && gated.length > 0 && finishable.length === 0 && <RequestApproval id={id} number={number} steps={gated as ("approve" | "decline" | "refund" | "replace")[]} preferred={preferredResolution} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {steps.includes("decline") && <Decline id={id} number={number} approvalId={ready("return.decline")} />}
      {steps.includes("approve") && <Approve id={id} number={number} preferred={preferredResolution} approvalId={ready("return.approve")} />}
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
      {steps.includes("refund") && <Refund id={id} number={number} approvalId={ready("return.refund")} context={refund} />}
      {steps.includes("replace") && (
        <OrderActionDialog
          trigger="Mark replaced"
          title={`Mark ${number} replaced?`}
          description="Only confirm once the replacement has been sent to the Customer."
          confirm="Mark replaced"
          busy="Saving…"
          run={() => markReturnReplaced(id, ...withApproval(ready("return.replace")))}
          successMessage={`${number} marked replaced.`}
        />
      )}
    </div>
  );
}
