"use client";

import { Clock, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SENIOR_PWD_PAGE } from "@/lib/portal/pages";

import { ID_KIND, ReadOnlyBadge, StatusPill, formatRemaining, formatUploaded } from "./shared";
import type { Verification, VerificationList } from "./verifications";

type Tab = "waiting" | "decisions";

function Cell({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

function OrderOnHold({ id, canOpen }: { id: number | null; canOpen: boolean }) {
  if (id === null) return <span className="text-[#a1a1aa]">—</span>;
  return canOpen
    ? <Link href={`/orders/${id}`} className="font-semibold text-[#5b2a86]">BR-{id}</Link>
    : <span className="font-semibold text-[#1f1a2e]">BR-{id}</span>;
}

/** The Senior/PWD checks list under Customers: what is waiting for review, and the latest decisions. */
export function SeniorPwdChecksList({
  list, now, readOnly, canOpenOrder = false,
}: { list: VerificationList; now: string; readOnly: boolean; canOpenOrder?: boolean }) {
  const [tab, setTab] = useState<Tab>("waiting");
  const at = new Date(now);
  const rows = tab === "waiting" ? list.pending : list.decided;

  const customer = (v: Verification) => (
    <Cell>
      <p className="font-medium text-[#1f1a2e]">{v.customerName}</p>
      <p className="text-xs text-[#6e6680]">{v.customerEmailHint}</p>
    </Cell>
  );

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Senior/PWD checks</h1>
          {readOnly && <ReadOnlyBadge />}
        </div>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Customers upload an ID on the storefront. Their order can&apos;t be confirmed until the ID is reviewed.
        </p>
      </div>

      <div role="tablist" aria-label="Senior/PWD checks" className="flex shrink-0 gap-1.5">
        {([["waiting", "Waiting for review"], ["decisions", "Latest decisions"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium ${tab === key ? "bg-[#f1edf6] text-[#5b2a86]" : "text-[#6e6680] hover:bg-[#f7f5fa]"}`}
          >
            {label}
            {key === "waiting" && (
              <span className="rounded-full bg-[#5b2a86] px-1.5 text-[11px] leading-4 text-white">{list.pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-[#e6e1ee] bg-white">
        {rows.length === 0 ? (
          <p className="p-5 text-sm text-[#6e6680]">{tab === "waiting" ? "Nothing is waiting for review." : "No decisions yet."}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#efebf4] text-xs font-medium text-[#6e6680]">
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">ID type</th>
                <th className="px-4 py-2.5 font-medium">Uploaded</th>
                {tab === "waiting" ? (
                  <>
                    <th className="px-4 py-2.5 font-medium">Order on hold</th>
                    <th className="px-4 py-2.5 font-medium">Photo deleted in</th>
                  </>
                ) : (
                  <>
                    <th className="px-4 py-2.5 font-medium">Decision</th>
                    <th className="px-4 py-2.5 font-medium">Decided by</th>
                  </>
                )}
                <th className="px-4 py-2.5"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="border-b border-[#efebf4] last:border-0">
                  {customer(v)}
                  <Cell className="text-[#3f3a52]">{ID_KIND[v.idType]}</Cell>
                  <Cell className="text-[#3f3a52]">{formatUploaded(v.submittedAt)}</Cell>
                  {tab === "waiting" ? (
                    <>
                      <Cell><OrderOnHold id={v.orderId} canOpen={canOpenOrder} /></Cell>
                      <Cell>
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs text-[#52525b]">
                          <Clock aria-hidden className="size-3" /> {formatRemaining(v.photoExpiresAt, at)}
                        </span>
                      </Cell>
                    </>
                  ) : (
                    <>
                      <Cell>
                        <StatusPill status={v.status} />
                        {v.status === "declined" && v.declineReason && <p className="pt-0.5 text-xs text-[#6e6680]">{v.declineReason}</p>}
                        {v.status === "approved" && v.expiresOn && <p className="pt-0.5 text-xs text-[#6e6680]">until {v.expiresOn}</p>}
                      </Cell>
                      <Cell className="text-[#3f3a52]">{v.decidedByName ?? "—"}</Cell>
                    </>
                  )}
                  <Cell className="text-right">
                    <Link
                      href={`${SENIOR_PWD_PAGE}/${v.id}`}
                      prefetch
                      className="inline-block rounded-lg border border-[#e4e4e7] bg-white px-3.5 py-[7px] text-sm font-medium text-[#18181b] hover:bg-[#f7f5fa]"
                    >
                      {tab === "waiting" && !readOnly ? "Review" : "View"}
                    </Link>
                  </Cell>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div role="note" aria-label="Privacy" className="flex shrink-0 gap-2 rounded-xl border border-[#c7d9f5] bg-[#eaf2fd] px-4 py-3 text-[13px] text-[#1e4f9c]">
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <p><span className="font-semibold">Privacy</span><br />The ID photo is deleted right after review, or after 7 days. The ID number is never stored.</p>
      </div>
    </div>
  );
}
