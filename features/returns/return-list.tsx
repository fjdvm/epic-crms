import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { Pill } from "@/features/tickets/pill";
import { cn } from "@/lib/utils";

import { RETURN_TABS, type ReturnList, type ReturnStats, type ReturnTab } from "./returns";
import { STATUS_PILLS } from "./returns-table";

export interface ReturnListParams {
  tab: ReturnTab;
  page: number;
}

export const TAB_LABELS: Record<ReturnTab, string> = Object.fromEntries(
  RETURN_TABS.map((t) => [t, orderLabel(t)]),
) as Record<ReturnTab, string>;

/** The Figma frame's columns, less Resolution; they share the table width in proportion. */
export const COLUMNS: { header: string; className: string }[] = [
  { header: "Return", className: "flex-[1_1_100px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { header: "Order", className: "flex-[1_1_90px]" },
  { header: "Items", className: "min-w-0 flex-[3_1_220px]" },
  { header: "Status", className: "flex-[1_1_130px]" },
  { header: "Requested", className: "flex-[1_1_110px]" },
];

export const HEAD = "flex items-start overflow-clip";
export const CELL = "flex items-start overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

export const RATE_CAPTION = "Of Orders delivered this month";
export const STAT_LABELS = ["Open returns", "Return rate", "Refunded this month"] as const;

export function StatCard({ label, caption, children }: { label: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
      <p className="text-[13px] font-medium text-[#6e6680]">{label}</p>
      <div className="text-2xl font-semibold text-[#1f1a2e]">{children}</div>
      {caption && <p className="text-xs text-[#6e6680]">{caption}</p>}
    </div>
  );
}

function Stats({ stats }: { stats: ReturnStats | null }) {
  const value = (text: string | null) =>
    text ?? <span className="text-base font-medium text-[#6e6680]">Unavailable</span>;
  const rate = stats && `${Number(stats.returnRate.toFixed(1))}%`;

  return (
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
      <StatCard label="Open returns">{value(stats && String(stats.openReturns))}</StatCard>
      <StatCard label="Return rate" caption={RATE_CAPTION}>
        {value(rate)}
      </StatCard>
      <StatCard label="Refunded this month">{value(stats && formatPesos(stats.refundedThisMonth))}</StatCard>
    </div>
  );
}

function href(params: ReturnListParams, change: Partial<ReturnListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.tab !== "requested") query.set("tab", next.tab);
  if (next.page > 1) query.set("page", String(next.page));

  const text = query.toString();

  return text ? `/returns?${text}` : "/returns";
}

export function ReturnListView({
  list,
  stats,
  params,
}: {
  list: ReturnList;
  stats: ReturnStats | null;
  params: ReturnListParams;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <Stats stats={stats} />

      <nav className="flex shrink-0 gap-1 overflow-x-auto" aria-label="Return tabs">
        {RETURN_TABS.map((tab) => {
          const active = tab === params.tab;

          return (
            <Link
              key={tab}
              href={href(params, { tab, page: 1 })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] whitespace-nowrap",
                active ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#6e6680]",
              )}
            >
              {TAB_LABELS[tab]} {list.counts[tab]}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        {list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">No {TAB_LABELS[params.tab]} Returns.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[760px]">
              <div
                data-return-head
                className="sticky top-0 z-10 flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]"
              >
                {COLUMNS.map((col) => (
                  <div key={col.header} className={cn(HEAD, col.className)}>
                    {col.header}
                  </div>
                ))}
              </div>
              {list.rows.map((row) => (
                <div key={row.id} data-return-row className="flex items-center border-b border-[#efebf4] py-[11px]">
                  <div className={cn(CELL, COLUMNS[0].className, "font-medium text-[#5b2a86]")}>{row.number}</div>
                  <div className={cn(CELL, COLUMNS[1].className)}>
                    <span className="truncate pr-3">{row.customer.name}</span>
                  </div>
                  <div className={cn(CELL, COLUMNS[2].className)}>
                    <Link href={`/orders/${row.orderId}`} className="text-[#5b2a86]">
                      #{row.orderId}
                    </Link>
                  </div>
                  <div className={cn(CELL, COLUMNS[3].className)}>
                    <span className="truncate pr-3">
                      {row.items.map((i) => `${i.product} ×${i.quantity}`).join(", ")}
                    </span>
                  </div>
                  <div className={cn(CELL, COLUMNS[4].className)}>
                    <Pill className={STATUS_PILLS[row.status]}>{orderLabel(row.status)}</Pill>
                  </div>
                  <div className={cn(CELL, COLUMNS[5].className)}>{formatDate(row.requestedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {list.totalPages > 1 && (
          <div className="flex shrink-0 items-center justify-between text-sm text-muted-foreground">
            <span>
              Page {list.page} of {list.totalPages}
            </span>
            <div className="flex gap-2">
              {list.page > 1 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(params, { page: list.page - 1 })}>
                    <ChevronLeft className="size-4" /> Previous
                  </Link>
                </Button>
              )}
              {list.page < list.totalPages && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href(params, { page: list.page + 1 })}>
                    Next <ChevronRight className="size-4" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
