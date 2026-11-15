"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { WAITING, type ApprovalView } from "@/features/approvals/view";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import type { ShopRole } from "@/lib/portal/roles";

import { extendRefundWindow } from "./actions";

/**
 * The 24-hour Refund window, with the one 24-hour extension. A Manager extends it with a reason; Staff see "Request approval"
 * and then carry out the approved request. Never optimistic: a Manager decides and the storefront keeps the clock.
 */
export function RefundWindow({ orderId, endsAt, extended, delivered, role, request }: {
  orderId: number; endsAt: string | null; extended: boolean; delivered: boolean; role?: ShopRole | null; request?: ApprovalView;
}) {
  const [reason, setReason] = useState("");
  const staff = role === "staff";
  const approved = staff && request?.status === "approved";
  const waiting = staff && request && WAITING.includes(request.status);
  const mayAct = (role === "manager" || staff) && delivered && !extended;
  const asking = staff && !approved;

  return (
    <div className="space-y-2">
      <p className="text-sm text-[#1f1a2e]">
        {endsAt ? `The Customer can request a Return until ${new Date(endsAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })}.` : "No delivery yet, so no window."}
      </p>
      {extended && <p className="text-xs text-[#6e6680]">Extended once by 24 hours. It cannot be extended again.</p>}
      {mayAct && waiting && <span className="rounded-full bg-[#fdf1d8] px-3 py-1 text-xs font-medium text-[#8a5a00]">Waiting for approval</span>}
      {mayAct && !waiting && (
        <OrderActionDialog
          trigger={asking ? "Request approval…" : "Extend by 24 hours…"}
          title={asking ? "Ask a Manager to extend the Refund window" : `Extend Order #${orderId}'s Refund window?`}
          description="This adds 24 hours, once. The Customer is not emailed."
          confirm={asking ? "Send request" : "Extend"} busy={asking ? "Sending…" : "Extending…"}
          disabled={!reason.trim()}
          run={async () => {
            const result = await extendRefundWindow(orderId, reason, approved ? { approvalId: request!.id } : {});
            return !result.ok && result.reason === "Waiting for approval" ? { ok: true as const } : result;
          }}
          successMessage={asking ? "Sent to a Manager. The Return shows Waiting for approval." : "The Refund window now runs 24 hours longer."}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`window-reason-${orderId}`} className="text-[13px] font-medium text-foreground">Reason <span className="text-[#dc2626]">*</span></Label>
            <Textarea id={`window-reason-${orderId}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the Customer needs more time" />
          </div>
        </OrderActionDialog>
      )}
    </div>
  );
}
