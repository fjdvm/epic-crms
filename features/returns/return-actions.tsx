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
import { useShownStatus, type SavedProof } from "./optimistic-status";
import { REFUND_FIELDS, REFUND_METHODS, refundMethodLabel, TRANSFER_VERIFIED, todayInManila } from "./refund-record";
import { saveRefundProof } from "./refund-proof-actions";
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
export interface RefundContext {
  customerName: string; amount: number; paymentMethod: string; items: { name: string; quantity: number }[];
  /** The Order's Delivery fee when a Manager may include it in this refund (wrong or defective item, not refunded yet); 0 otherwise. */
  deliveryFee?: number;
  /** The method the Customer confirmed for this refund; the sent-by choice starts there. */
  destinationMethod?: string | null;
  /** The refund proof and details Staff already saved, with what the Proof reader found (#615); null until they save one. */
  saved?: SavedProof | null;
}

const FIELD = "h-9 w-full rounded-lg border border-[#e4e4e7] bg-white px-3 text-sm text-[#18181b]";
const pesoText = (centavos: number) => (centavos / 100).toFixed(2);

/** Step one of a refund: save the proof and the details of the money sent, so the Proof reader's findings can be checked before the Return is marked Refunded (#615). */
function SaveProof({ id, number, context, canIncludeFee = false }: { id: number; number: string; context?: RefundContext; canIncludeFee?: boolean }) {
  const saved = context?.saved ?? null;
  const [proof, setProof] = useState<File | null>(null);
  const [sentAmount, setSentAmount] = useState<string | null>(null);
  const [sentVia, setSentVia] = useState(context?.destinationMethod ?? "");
  const [sentOn, setSentOn] = useState(() => todayInManila());
  const [sentReference, setSentReference] = useState("");
  const [withFee, setWithFee] = useState(false);
  const [feeReason, setFeeReason] = useState("");
  const destination = context ? refundDestination(context.paymentMethod) : null;
  const feeOffered = canIncludeFee && (context?.deliveryFee ?? 0) > 0;
  const fee = feeOffered && withFee ? context!.deliveryFee! : 0;
  const amount = context ? formatPesos(context.amount + fee) : null;
  const typedAmount = sentAmount ?? (context ? pesoText(context.amount + fee) : "");
  const detailsMissing = !typedAmount.trim() || !sentVia || !sentOn || sentReference.trim().length < 4;

  return (
    <OrderActionDialog
      trigger={saved ? "Replace refund proof" : "Save refund proof"}
      triggerClassName={saved ? "border border-[#d9cce8] bg-white text-[#5b2a86] hover:bg-[#f6f2fa]" : undefined}
      title="Save refund proof"
      description={context
        ? `${number} · ${context.customerName} · paid ${amount}${destination ? ` via ${destination}` : ""}`
        : "Only save this once the money has been paid back to the Customer outside CREOMS."}
      confirm="Save proof"
      busy="Saving…"
      disabled={proof === null || detailsMissing || (feeOffered && withFee && !feeReason.trim())}
      // Recording a refund is a money step: no optimistic update; the spinner shows at once and a refusal is told in plain words.
      run={async () => {
        const uploaded = await uploadFile("Returns", proof as File);
        if (!uploaded.ok) return uploaded;
        const form = new FormData();
        form.set("proof", uploaded.reference);
        form.set(REFUND_FIELDS.amount, typedAmount); form.set(REFUND_FIELDS.method, sentVia);
        form.set(REFUND_FIELDS.date, sentOn); form.set(REFUND_FIELDS.reference, sentReference.trim());
        if (feeOffered && withFee) { form.set("includeDeliveryFee", "true"); form.set("deliveryFeeReason", feeReason.trim()); }

        return saveRefundProof(id, form);
      }}
      successMessage="Refund proof saved. Check the Proof reader's findings, then mark the Return refunded."
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
            <dl className="space-y-1 rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-sm text-[#18181b]">
              <div className="flex justify-between"><dt>Items</dt><dd>{formatPesos(context.amount)}</dd></div>
              <div className="flex justify-between"><dt>Delivery fee</dt><dd>{formatPesos(fee)}</dd></div>
              <div className="flex justify-between border-t border-[#e4e4e7] pt-1 font-medium"><dt>Total</dt><dd>{amount}</dd></div>
            </dl>
            <p className="text-xs text-[#71717a]">
              {fee > 0 ? "Items are the amount paid after discounts, plus the Delivery fee a Manager chose to include." : "The amount paid for these items, after discounts. The Delivery fee is not included."}
            </p>
          </div>
          {feeOffered && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[13px] font-medium text-[#27272a]">
                <input type="checkbox" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} />
                Also refund the Delivery fee ({formatPesos(context!.deliveryFee!)})
              </label>
              {withFee && (
                <>
                  <Label htmlFor={`fee-reason-${id}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
                  <Textarea id={`fee-reason-${id}`} value={feeReason} onChange={(e) => setFeeReason(e.target.value)} placeholder="Why the shop is refunding the Delivery fee" />
                </>
              )}
            </div>
          )}
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`refund-amount-${id}`} className="text-[13px] font-medium text-foreground">Amount sent (₱) <span className="text-[#dc2626]">*</span></Label>
          <input id={`refund-amount-${id}`} inputMode="decimal" className={FIELD} value={typedAmount} onChange={(e) => setSentAmount(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`refund-method-${id}`} className="text-[13px] font-medium text-foreground">Sent by <span className="text-[#dc2626]">*</span></Label>
          <select id={`refund-method-${id}`} className={FIELD} value={sentVia} onChange={(e) => setSentVia(e.target.value)}>
            <option value="">Choose…</option>
            {REFUND_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`refund-date-${id}`} className="text-[13px] font-medium text-foreground">Date sent <span className="text-[#dc2626]">*</span></Label>
          <input id={`refund-date-${id}`} type="date" max={todayInManila()} className={FIELD} value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`refund-reference-${id}`} className="text-[13px] font-medium text-foreground">Reference <span className="text-[#dc2626]">*</span></Label>
          <input id={`refund-reference-${id}`} className={FIELD} maxLength={100} value={sentReference} onChange={(e) => setSentReference(e.target.value)} placeholder="Transfer reference" />
        </div>
      </div>
      <DeliveryPhotoPicker photo={proof} onChange={setProof} label="Refund proof" />
      <p className="rounded-lg bg-[#fffbeb] px-3 py-2.5 text-[13px] text-[#92400e]">Saved on the Return for you to check. The Return is not marked Refunded and the Customer is not told until you do that next.</p>
    </OrderActionDialog>
  );
}

/** Step two: the saved details and the Proof reader's findings, a reminder to verify the real transfer, then Mark refunded. */
function MarkRefunded({ id, number, approvalId, context, showRefunded }: { id: number; number: string; approvalId?: string; context?: RefundContext; showRefunded?: () => void }) {
  const saved = context?.saved ?? null;
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState("");
  if (!saved) return null;
  const amount = formatPesos(saved.amountInCentavos);
  const blocked = saved.reading ? "The Proof reader is still checking the refund proof. Wait for its findings." : saved.unresolved.length > 0 ? `Correct or proceed past the flagged details on the Refund proof card first: ${saved.unresolved.join(", ")}.` : null;

  return (
    <OrderActionDialog
      trigger="Mark refunded"
      title="Mark refunded"
      description={`${number}${context ? ` · ${context.customerName}` : ""} · ${amount} sent by ${refundMethodLabel(saved.method)}`}
      confirm={`Mark ${amount} refunded`}
      busy="Saving…"
      disabled={!verified || blocked !== null}
      onOptimistic={showRefunded}
      run={() => {
        const form = new FormData();
        form.set(TRANSFER_VERIFIED, "true");
        return approvalId || note.trim() ? markReturnRefunded(id, form, { approvalId, reason: note }) : markReturnRefunded(id, form);
      }}
      successMessage={`${number} marked refunded.`}
    >
      <dl className="space-y-1 rounded-lg border border-[#e4e4e7] px-3 py-2.5 text-sm text-[#18181b]">
        <div className="flex justify-between gap-3"><dt>Amount</dt><dd>{amount}</dd></div>
        <div className="flex justify-between gap-3"><dt>Sent by</dt><dd>{refundMethodLabel(saved.method)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Date</dt><dd>{saved.refundedOn}</dd></div>
        <div className="flex justify-between gap-3"><dt>Reference</dt><dd className="break-all text-right">{saved.reference}</dd></div>
      </dl>
      {blocked && <p role="alert" className="rounded-lg bg-[#fdf1d8] px-3 py-2.5 text-[13px] text-[#8a5a00]">{blocked}</p>}
      <p className="rounded-lg bg-[#fffbeb] px-3 py-2.5 text-[13px] text-[#92400e]">The Proof reader only extracts details. Matching details are not proof of payment. Verify the real transfer with the payment provider before marking the Return refunded.</p>
      <label className="flex items-start gap-2 text-[13px] font-medium text-[#27272a]">
        <input type="checkbox" className="mt-0.5" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
        I verified the real transfer with the payment provider
      </label>
      {!approvalId && (
        <div className="space-y-1.5">
          <Label htmlFor={`refund-note-${id}`} className="text-[13px] font-medium text-foreground">Note for the CEO, if the amount needs their final approval</Label>
          <Textarea id={`refund-note-${id}`} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}
    </OrderActionDialog>
  );
}

/** Both refund steps: Save the proof first; Mark refunded appears once a proof is saved. */
function RefundSteps({ id, number, approvalId, context, canIncludeFee, showRefunded }: { id: number; number: string; approvalId?: string; context?: RefundContext; canIncludeFee?: boolean; showRefunded?: () => void }) {
  const proof = context?.saved ?? null;

  return (
    <>
      <SaveProof id={id} number={number} context={context} canIncludeFee={canIncludeFee} />
      {proof && <MarkRefunded id={id} number={number} approvalId={approvalId} context={context} showRefunded={showRefunded} />}
    </>
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
  const { show } = useShownStatus(status);
  // Only a refund whose approval is already decided shows at once. A Manager's or the CEO's own decision waits for the server.
  const showRefunded = () => show("refunded");
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
          {finishable.includes("refund") && <RefundSteps id={id} number={number} approvalId={ready("return.refund")} context={refund} showRefunded={ready("return.refund") ? showRefunded : undefined} />}
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
      {steps.includes("refund") && <RefundSteps id={id} number={number} approvalId={ready("return.refund")} context={refund} canIncludeFee showRefunded={ready("return.refund") ? showRefunded : undefined} />}
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
