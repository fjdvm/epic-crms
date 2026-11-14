"use client";

import Link from "next/link";
import { useOptimistic, useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { decideApproval } from "./actions";
import {
  ACTION_LABELS, ago, inTab, isMoneyDecision, pesos, stepFor, summarize, waitingLabel, WAITING,
  type ApprovalTab, type ApprovalView,
} from "./view";

const TABS: [ApprovalTab, string][] = [["waiting", "Waiting"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];

function Decide({ request, role, onOptimistic }: { request: ApprovalView; role: "manager" | "ceo"; onOptimistic: (status: string) => void }) {
  const [reason, setReason] = useState("");
  const label = `${ACTION_LABELS[request.action]} · RMA-${request.targetId}`;
  const money = isMoneyDecision(request.action);
  // Money decisions are never optimistic: they wait for the server behind a spinner.
  const approvedStatus = role === "manager" && request.status === "waiting-manager" && request.amountInCentavos > request.limitInCentavos && money ? "waiting-ceo" : "approved";

  return (
    <div className="flex shrink-0 gap-2">
      <OrderActionDialog
        trigger="Decline" tone="destructive" triggerClassName="px-2.5 py-1.5 text-[13px]"
        title={`Decline ${label}?`} description={`${request.requesterName} sees your reason right away.`}
        confirm="Decline request" busy="Declining…" keepLabel="Keep request" disabled={!reason.trim()}
        run={() => decideApproval("Returns", request.id, "decline", reason)} successMessage="Request declined."
        onOptimistic={() => onOptimistic("declined")}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`decline-${request.id}`} className="text-[13px] font-medium">Reason <span className="text-[#dc2626]">*</span></Label>
          <Textarea id={`decline-${request.id}`} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this is declined" />
        </div>
      </OrderActionDialog>
      <OrderActionDialog
        trigger="Approve" triggerClassName="px-2.5 py-1.5 text-[13px]"
        title={`Approve ${label}?`}
        description={money ? `${pesos(request.amountInCentavos)} is paid or written off once this is approved. Your name and the time are recorded.` : "Your name and the time are recorded."}
        confirm="Approve request" busy="Approving…"
        run={() => decideApproval("Returns", request.id, "approve")} successMessage={approvedStatus === "waiting-ceo" ? "Approved. Sent to the CEO for final approval." : "Request approved."}
        onOptimistic={money ? undefined : () => onOptimistic(approvedStatus)}
      />
    </div>
  );
}

/** The Manager's (and CEO's) list of requests; Admin sees it read-only. */
export function ApprovalsList({ requests, role, now }: { requests: ApprovalView[]; role: "manager" | "ceo" | "admin" | "staff" | null; now: number }) {
  const [tab, setTab] = useState<ApprovalTab>("waiting");
  const [shown, setStatus] = useOptimistic(requests, (current, change: { id: string; status: string }) =>
    current.map(r => (r.id === change.id ? { ...r, status: change.status } : r)));
  const stats = summarize(shown, now);
  const visible = shown.filter(r => inTab(r.status, tab));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="space-y-1 leading-[normal]">
        <h1 className="text-2xl font-semibold text-[#18181b]">Approvals</h1>
        <p className="text-sm text-[#71717a]">Requests from staff for actions that cost money, remove stock, override an AI warning or need a Manager.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[["Waiting", String(stats.waiting), stats.oldest ? `Oldest ${stats.oldest.replace(" ago", "")}` : "Nothing waiting"],
          ["Money at stake", pesos(stats.money), "Refunds and write-offs"],
          ["Approved today", String(stats.approvedToday), ""], ["Declined today", String(stats.declinedToday), "With a reason sent back"]].map(([title, value, note]) => (
          <div key={title} className="rounded-xl border border-[#e6e1ee] bg-white px-4 py-4">
            <p className="text-[13px] font-medium text-[#71717a]">{title}</p>
            <p className="text-2xl font-semibold text-[#18181b]">{value}</p>
            <p className="text-xs text-[#71717a]">{note}</p>
          </div>
        ))}
      </div>
      <div role="tablist" className="flex gap-1">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`rounded-lg px-2.5 py-1.5 text-[13px] ${tab === key ? "bg-[#efe8f7] font-semibold text-[#5b2a86]" : "font-medium text-[#52525b]"}`}>
            {label}{key === "waiting" && stats.waiting > 0 && <span className="ml-1.5 rounded-full bg-[#5b2a86] px-1.5 text-[11px] text-white">{stats.waiting}</span>}
          </button>
        ))}
      </div>
      {role === "admin" && <p className="text-sm text-[#71717a]">Admin view only: approving is for Managers and the CEO.</p>}
      <ul className="space-y-3">
        {visible.length === 0 && <li className="text-sm text-[#71717a]">No requests here.</li>}
        {visible.map(request => {
          const step = stepFor(role, request.status);
          return (
            <li key={request.id} className="space-y-2.5 rounded-xl border border-[#e6e1ee] bg-white px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#18181b]">{ACTION_LABELS[request.action]} · <Link className="text-[#5b2a86]" href={`/returns/${request.targetId}`}>RMA-{request.targetId}</Link></p>
                  <p className="text-xs text-[#71717a]">From {request.requesterName} · {ago(request.requestedAt, now)} · Return</p>
                </div>
                <p className="text-base font-semibold text-[#18181b]">{pesos(request.amountInCentavos)}</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-[#71717a]">“{request.reason}”</p>
                {step && request.requesterId && <Decide request={request} role={step} onOptimistic={status => setStatus({ id: request.id, status })} />}
                {!step && WAITING.includes(request.status) && <span className="text-xs font-medium text-[#b45309]">{waitingLabel(request.status)}</span>}
                {request.status === "declined" && <span className="text-xs text-[#9a3412]">Declined{request.declineReason ? `: ${request.declineReason}` : ""}</span>}
                {!WAITING.includes(request.status) && request.status !== "declined" && <span className="text-xs text-[#1e6b3a]">Approved{request.ceoName ? ` by ${request.ceoName}` : request.managerName ? ` by ${request.managerName}` : ""}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
