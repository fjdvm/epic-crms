"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WAITING, type ApprovalView } from "@/features/approvals/view";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import type { ShopRole } from "@/lib/portal/roles";

import { changeRefundDestination, revealRefundDestination } from "./actions";
import type { MaskedRefundDestination, RefundDestination } from "./refund-destination";

const METHODS = [["gcash", "GCash"], ["maya", "Maya"], ["bank-transfer", "Bank transfer"]] as const;
const label = (method: string) => METHODS.find(([value]) => value === method)?.[1] ?? method;

/**
 * Where the Customer asked their refund to go. The number is masked; the full number opens only where refund processing needs it
 * (the look is audited). The destination locks at approval: nobody types a different one at refund time. A Manager changes it with a
 * reason and the Customer's confirmation, before money is sent; Staff see "Request approval". The change is never optimistic, because it
 * decides where money goes; the reveal answers instantly with a pending state, and hides again on a click.
 */
export function RefundDestinationCard({ returnId, destination, locked, canReveal, canChange, role, request }: {
  returnId: number;
  destination: MaskedRefundDestination | null;
  locked: boolean;
  /** The refund is ready to be sent, so refund processing may need the whole number. */
  canReveal: boolean;
  /** An approved refund that has not been sent yet. */
  canChange: boolean;
  role?: ShopRole | null;
  /** The Staff request to change this destination, if any. */
  request?: ApprovalView;
}) {
  const [full, setFull] = useState<RefundDestination | null>(null);
  const [looking, startLooking] = useTransition();
  const [method, setMethod] = useState<string>("gcash");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const staff = role === "staff";
  const mayAct = (role === "manager" || staff) && canChange;
  const approved = staff && request?.status === "approved";
  const waiting = staff && request && WAITING.includes(request.status);
  const asking = staff && !approved;

  function reveal() {
    if (full) return setFull(null);
    startLooking(async () => {
      const result = await revealRefundDestination(returnId);
      if (result.ok) setFull(result.destination);
      else toast.error(result.reason);
    });
  }

  return (
    <div className="space-y-3">
      {destination ? (
        <dl className="space-y-1 text-sm text-[#1f1a2e]">
          <div className="flex justify-between gap-3"><dt className="text-[#6e6680]">Method</dt><dd>{label(destination.method)}</dd></div>
          {destination.bankName && <div className="flex justify-between gap-3"><dt className="text-[#6e6680]">Bank</dt><dd>{destination.bankName}</dd></div>}
          <div className="flex justify-between gap-3"><dt className="text-[#6e6680]">Account name</dt><dd>{destination.accountName}</dd></div>
          <div className="flex justify-between gap-3">
            <dt className="text-[#6e6680]">Account number</dt>
            <dd data-testid="destination-number" className="font-mono">{full ? full.accountNumber : destination.maskedNumber}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-[#6e6680]">The Customer has not confirmed a refund destination for this Return.</p>
      )}

      {destination && locked && <p className="text-xs text-[#6e6680]">Locked when the Return was approved. Only a Manager can change it, with a reason and the Customer&apos;s confirmation, before money is sent.</p>}

      <div className="flex flex-wrap items-center gap-2">
        {destination && canReveal && (role === "manager" || staff) && (
          <button type="button" onClick={reveal} disabled={looking} className="text-sm font-medium text-[#5b2a86] disabled:opacity-60">
            {looking ? "Opening…" : full ? "Hide full number" : "Show full number to send the refund"}
          </button>
        )}
        {mayAct && waiting && <span className="rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">Waiting for approval</span>}
        {mayAct && !waiting && (
          <OrderActionDialog
            trigger={asking ? "Request approval to change…" : "Change destination…"}
            title={asking ? "Ask a Manager to change the refund destination" : "Change the refund destination?"}
            description="Only before the money is sent, and only once the Customer has confirmed the new details to you."
            confirm={asking ? "Send request" : "Change destination"} busy={asking ? "Sending…" : "Changing…"}
            disabled={!reason.trim() || !confirmed || !accountName.trim() || !accountNumber.trim() || (method === "bank-transfer" && !bankName.trim())}
            run={async () => {
              const result = await changeRefundDestination(returnId, { method, accountName, accountNumber, bankName: method === "bank-transfer" ? bankName : null, reason, customerConfirmed: confirmed },
                approved ? { approvalId: request!.id } : { reason });
              if (result.ok) { setFull(null); setAccountNumber(""); }

              return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
            }}
            successMessage={asking ? "Sent to a Manager. The Return shows Waiting for approval." : "The refund destination was changed."}
          >
            <div className="space-y-1.5">
              <Label htmlFor={`dest-method-${returnId}`} className="text-[13px] font-medium text-foreground">Refund method <span className="text-[#dc2626]">*</span></Label>
              <select id={`dest-method-${returnId}`} value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                {METHODS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </div>
            {method === "bank-transfer" && (
              <div className="space-y-1.5">
                <Label htmlFor={`dest-bank-${returnId}`} className="text-[13px] font-medium text-foreground">Bank name <span className="text-[#dc2626]">*</span></Label>
                <Input id={`dest-bank-${returnId}`} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor={`dest-name-${returnId}`} className="text-[13px] font-medium text-foreground">Account name <span className="text-[#dc2626]">*</span></Label>
              <Input id={`dest-name-${returnId}`} value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`dest-number-${returnId}`} className="text-[13px] font-medium text-foreground">Account number <span className="text-[#dc2626]">*</span></Label>
              <Input id={`dest-number-${returnId}`} inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`dest-reason-${returnId}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
              <Textarea id={`dest-reason-${returnId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the destination is changing" />
            </div>
            <label className="flex items-start gap-2 text-[#1f1a2e]">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
              <span className="text-sm">The Customer confirmed these new details to us.</span>
            </label>
          </OrderActionDialog>
        )}
      </div>
    </div>
  );
}
