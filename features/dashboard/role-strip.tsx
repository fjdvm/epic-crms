import Link from "next/link";

import { summarize, pesos, type ApprovalView, WAITING, APPROVED } from "@/features/approvals/view";
import type { ShopRole } from "@/lib/portal/roles";

const CARD = "rounded-xl border border-[#e6e1ee] bg-white px-4 py-4";

/** What each Role sees first on its Dashboard (Figma Staff, Manager, CEO and Admin dashboards). */
export function RoleStrip({ role, requests, now }: { role: ShopRole | null; requests: ApprovalView[]; now: number }) {
  if (role === null) return null;
  const stats = summarize(requests, now);

  if (role === "staff") {
    const waiting = requests.filter(r => WAITING.includes(r.status)).length;
    const ready = requests.filter(r => r.status === "approved").length;
    return (
      <section aria-label="My work today" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={CARD}><p className="text-[13px] font-medium text-[#71717a]">My work today</p><p className="text-sm text-[#52525b]">Your own requests and the work waiting for you.</p></div>
        <div className={CARD}><p className="text-[13px] font-medium text-[#71717a]">Waiting for approval</p><p className="text-2xl font-semibold">{waiting}</p></div>
        <div className={CARD}><p className="text-[13px] font-medium text-[#71717a]">Approved, ready to finish</p><p className="text-2xl font-semibold">{ready}</p></div>
      </section>
    );
  }
  if (role === "manager") {
    return (
      <section aria-label="Approvals waiting" className="flex flex-wrap items-center gap-4 rounded-xl border border-[#a78bfa] bg-[#fbf8ff] px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#18181b]">{stats.waiting === 0 ? "No approvals waiting" : `${stats.waiting} approval${stats.waiting === 1 ? "" : "s"} waiting for you`}</p>
          <p className="text-xs text-[#71717a]">{stats.waiting > 0 ? `${pesos(stats.money)} at stake${stats.oldest ? ` · oldest ${stats.oldest.replace(" ago", "")}` : ""}` : "Staff requests appear here."} · {requests.filter(r => APPROVED.includes(r.status)).length} approved so far</p>
        </div>
        <Link href="/approvals" prefetch className="rounded-lg bg-[#5b2a86] px-3.5 py-2 text-sm font-medium text-white">Open approvals</Link>
      </section>
    );
  }
  if (role === "ceo") {
    const finals = requests.filter(r => r.status === "waiting-ceo");
    return (
      <section aria-label="Final approvals" className="flex flex-wrap items-center gap-4 rounded-xl border border-[#e6e1ee] bg-white px-4 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#18181b]">{finals.length === 0 ? "No final approvals waiting" : `${finals.length} refund or write-off over the Approval limit waiting for you`}</p>
          <p className="text-xs text-[#71717a]">Everything else here is read-only. Amounts at or under the limit stop at the Manager.</p>
        </div>
        {finals.length > 0 && <Link href="/approvals" prefetch className="rounded-lg bg-[#5b2a86] px-3.5 py-2 text-sm font-medium text-white">Review</Link>}
      </section>
    );
  }
  return <p className="rounded-xl border border-[#e6e1ee] bg-white px-4 py-3 text-sm text-[#52525b]">Admin view: every module is read-only here. Business decisions stay with Managers and the CEO.</p>;
}
