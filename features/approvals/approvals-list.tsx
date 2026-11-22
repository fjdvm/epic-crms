"use client";

import Link from "next/link";
import { useOptimistic, useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { decideApproval } from "./actions";
import {
  actionLabel, ago, inTab, isMoneyDecision, kindOf, KINDS, KIND_LABELS, pesos, stepFor, summarize, targetOf, waitingLabel, WAITING,
  type ApprovalKind, type ApprovalTab, type ApprovalView, type KindFilter,
} from "./view";

const TABS: [ApprovalTab, string][] = [["waiting", "Waiting"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]];

function Decide({ request, role, onOptimistic }: { request: ApprovalView; role: "manager" | "ceo"; onOptimistic: (status: string) => void }) {
  const [reason, setReason] = useState("");
  const label = `${actionLabel(request.action)} · ${targetOf(request).label}`;
  const owner = request.module ?? "Returns";
  const money = isMoneyDecision(request.action);
  // Money decisions are never optimistic: they wait for the server behind a spinner.
  const approvedStatus = role === "manager" && request.status === "waiting-manager" && request.amountInCentavos > request.limitInCentavos && money ? "waiting-ceo" : "approved";

  return (
    <div className="flex shrink-0 gap-2">
      <OrderActionDialog
        trigger="Decline" tone="destructive" triggerClassName="px-2.5 py-1.5 text-[13px]"
        title={`Decline ${label}?`} description={`${request.requesterName} sees your reason right away.`}
        confirm="Decline request" busy="Declining…" keepLabel="Keep request" disabled={!reason.trim()}
        run={() => decideApproval(owner, request.id, "decline", reason)} successMessage="Request declined."
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
        run={() => decideApproval(owner, request.id, "approve")} successMessage={approvedStatus === "waiting-ceo" ? "Approved. Sent to the CEO for final approval." : "Request approved."}
        onOptimistic={money ? undefined : () => onOptimistic(approvedStatus)}
      />
    </div>
  );
}

/** The Manager's (and CEO's) list of requests; Admin sees it read-only. */
export function ApprovalsList({ requests, role, now, initialKind = "all" }: { requests: ApprovalView[]; role: "manager" | "ceo" | "admin" | "staff" | null; now: number; initialKind?: KindFilter }) {
  const [tab, setTab] = useState<ApprovalTab>("waiting");
  const [kind, setKind] = useState<KindFilter>(initialKind);
  const [shown, setStatus] = useOptimistic(requests, (current, change: { id: string; status: string }) =>
    current.map(r => (r.id === change.id ? { ...r, status: change.status } : r)));
  const stats = summarize(shown, now);
  const inStatus = shown.filter(r => inTab(r.status, tab));
  const visible = kind === "all" ? inStatus : inStatus.filter(r => kindOf(r.action) === kind);
  const countOf = (k: ApprovalKind) => inStatus.filter(r => kindOf(r.action) === k).length;
  // Only the types with something in this status tab get a heading, in a fixed order.
  const groups = KINDS.map(k => [k, visible.filter(r => kindOf(r.action) === k)] as const).filter(([, rows]) => rows.length > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="space-y-1 leading-[normal]">
        <h1 className="text-2xl font-semibold text-[#18181b]">Approvals</h1>
        <p className="text-sm text-[#71717a]">Everything waiting for a person: ID checks, refunds, payments, cancellations, write-offs and returns.</p>
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
      <div role="group" aria-label="Approval type" className="flex flex-wrap gap-1.5">
        {([["all", "All types", inStatus.length], ...KINDS.map(k => [k, KIND_LABELS[k], countOf(k)] as const)] as const).map(([key, label, count]) => (
          <button key={key} type="button" aria-pressed={kind === key} onClick={() => setKind(key as KindFilter)}
            className={`rounded-full border px-3 py-1 text-[13px] ${kind === key ? "border-[#5b2a86] bg-[#efe8f7] font-semibold text-[#5b2a86]" : "border-[#e6e1ee] bg-white font-medium text-[#52525b]"}`}>
            {label} <span className="text-[#71717a]">{count}</span>
          </button>
        ))}
      </div>
      {role === "admin" && <p className="text-sm text-[#71717a]">Admin view only: approving is for Managers and the CEO.</p>}
      {groups.length === 0 && <p className="text-sm text-[#71717a]">No requests here.</p>}
      {groups.map(([group, rows]) => (
        <section key={group} aria-label={KIND_LABELS[group]} className="space-y-2.5">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#71717a]">{KIND_LABELS[group]} · {rows.length}</h2>
          <ul className="space-y-3">
            {rows.map(request => {
              const step = stepFor(role, request.status);
              const target = targetOf(request);
              const idCheck = request.action === "id-check";
              const mayReview = role === "staff" || role === "manager";

              return (
                <li key={request.id} className="space-y-2.5 rounded-xl border border-[#e6e1ee] bg-white px-4 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[#18181b]">{actionLabel(request.action)} · <Link className="text-[#5b2a86]" href={target.href}>{target.label}</Link></p>
                      <p className="text-xs text-[#71717a]">{idCheck ? "Customer" : "From"} {request.requesterName} · {ago(request.requestedAt, now)} · {KIND_LABELS[kindOf(request.action)].replace(/s$/, "")}</p>
                    </div>
                    {!idCheck && <p className="text-base font-semibold text-[#18181b]">{pesos(request.amountInCentavos)}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 text-xs text-[#71717a]">{idCheck ? request.reason : `“${request.reason}”`}</p>
                    {step && request.requesterId && request.action !== "return.decide" && <Decide request={request} role={step} onOptimistic={status => setStatus({ id: request.id, status })} />}
                    {/* The Manager picks a Return's outcome on the Return itself, where the evidence is. */}
                    {step && request.action === "return.decide" && <Link href={target.href} prefetch className="shrink-0 rounded-lg bg-[#5b2a86] px-3.5 py-[7px] text-sm font-medium text-white">Open Return to decide</Link>}
                    {idCheck && <Link href={target.href} prefetch className="shrink-0 rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-[7px] text-sm font-medium text-[#18181b]">{request.status === "waiting-id" && mayReview ? "Review" : "View"}</Link>}
                    {!step && !idCheck && WAITING.includes(request.status) && <span className="text-xs font-medium text-[#b45309]">{waitingLabel(request.status)}</span>}
                    {request.status === "declined" && <span className="text-xs text-[#9a3412]">Declined{request.declineReason ? `: ${request.declineReason}` : ""}</span>}
                    {!WAITING.includes(request.status) && request.status !== "declined" && <span className="text-xs text-[#1e6b3a]">{request.action === "return.decide" ? "Decided" : "Approved"}{request.ceoName ? ` by ${request.ceoName}` : request.managerName ? ` by ${request.managerName}` : ""}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
