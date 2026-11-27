import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { STAGE_LABELS } from "@/features/customer-profiles/rules";

import type { Breakdown } from "./breakdowns";
import { NO_ORDERS_STAGE_LABEL, STAGES_NOTE } from "./count-notes";
import type { CustomersByStage } from "./customers";
import type { Widget } from "./figures";
import { PeriodComparison } from "./stat-tile";

const CARD =
  "flex min-w-0 flex-col gap-3 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]";
const count = (value: number) => value.toLocaleString("en-PH");
const SUMMARY_STAGE_LABELS = { ...STAGE_LABELS, new: NO_ORDERS_STAGE_LABEL };

export function CustomersByStageCard({ widget }: { widget: Breakdown<CustomersByStage> }) {
  return (
    <section className={CARD}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#18181b]">Customers by Stage</h2>
        <p className="text-xs text-[#71717a]">{STAGES_NOTE}</p>
      </div>
      {widget.ok ? (
        <>
          <ul className="space-y-3">
            {Object.entries(SUMMARY_STAGE_LABELS).map(([stage, label]) => (
              <li key={stage} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-[#71717a]">{label}</span>
                <span className="font-semibold tabular-nums text-[#18181b]">
                  {count(widget.counts[stage as keyof typeof STAGE_LABELS])}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/customer-profiles?stage=at-risk" className="rounded-lg bg-[#f5f0fa] px-3 py-2 text-sm font-medium text-[#5b2a86] hover:underline">
            {count(widget.counts["at-risk"])} At risk Customers · View Customer Profiles →
          </Link>
        </>
      ) : <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>}
    </section>
  );
}

export function NewCustomersCard({ widget, leads, periodLabel }: {
  widget: Widget;
  leads: Breakdown<{ count: number }>;
  periodLabel: string;
}) {
  return (
    <section className={CARD}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#18181b]">New Customers</h2>
        <p className="text-xs text-[#71717a]">{periodLabel}</p>
      </div>
      {widget.ok ? (
        <>
          <p className="text-[26px] font-bold tabular-nums text-[#18181b]">{count(widget.current)}</p>
          <PeriodComparison current={widget.current} previous={widget.previous} absent="No Customers last period" />
        </>
      ) : <p className="text-sm text-[#71717a]">Couldn&apos;t load</p>}
      <p className="mt-auto border-t border-[#e6e1ee] pt-3 text-xs text-[#71717a]">
        Unverified Leads (as of today): {leads.ok ? count(leads.count) : "Couldn't load"}
      </p>
    </section>
  );
}

export function CustomersByStageSkeleton() {
  return (
    <section role="status" aria-label="Loading Customers by Stage" className={CARD}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#18181b]">Customers by Stage</h2>
        <p className="text-xs text-[#71717a]">{STAGES_NOTE}</p>
      </div>
      {Object.keys(STAGE_LABELS).map((stage) => <Skeleton key={stage} className="h-5 w-full" />)}
      <Skeleton className="h-10 w-full" />
    </section>
  );
}

export function NewCustomersSkeleton({ periodLabel }: { periodLabel: string }) {
  return (
    <section role="status" aria-label="Loading New Customers" className={CARD}>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#18181b]">New Customers</h2>
        <p className="text-xs text-[#71717a]">{periodLabel}</p>
      </div>
      <Skeleton className="h-8 w-28" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-auto h-7 w-full" />
    </section>
  );
}
