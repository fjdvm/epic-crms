import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { ORDER_TABS, type OrderList, type OrderTab } from "./orders";
import { PaymentPill, StatusPill } from "./status-pill";

export interface OrderListParams {
  tab: OrderTab;
  page: number;
}

export const TAB_LABELS: Record<OrderTab, string> = {
  all: "All",
  ...Object.fromEntries(ORDER_TABS.slice(1).map((t) => [t, orderLabel(t)])),
} as Record<OrderTab, string>;

/** The Figma frame's columns; they share the table width in proportion, so the rows fill the card. */
export const COLUMNS: { header: string; className: string }[] = [
  { header: "Order", className: "flex-[1_1_90px]" },
  { header: "Date", className: "flex-[1_1_110px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { header: "Items", className: "min-w-0 flex-[3_1_220px]" },
  { header: "Total", className: "flex-[1_1_110px]" },
  { header: "Payment", className: "flex-[1_1_100px]" },
  { header: "Status", className: "flex-[1_1_130px]" },
];

function href(params: OrderListParams, change: Partial<OrderListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.tab !== "all") query.set("tab", next.tab);
  if (next.page > 1) query.set("page", String(next.page));

  const text = query.toString();

  return text ? `/orders?${text}` : "/orders";
}

export const HEAD = "flex items-start overflow-clip";
export const CELL = "flex items-start overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

/**
 * The tab bar. Shared with the loading skeleton so the active tab is highlighted, and every tab
 * clickable, before the data arrives. Links prefetch the whole tab, so a tab is usually already there when clicked.
 */
export function TabNav({ params, count }: { params: OrderListParams; count: (tab: OrderTab) => React.ReactNode }) {
  return (
    <nav className="flex shrink-0 gap-1 overflow-x-auto" aria-label="Order tabs">
      {ORDER_TABS.map((tab) => {
        const active = tab === params.tab;

        return (
          <Link
            key={tab}
            href={href(params, { tab, page: 1 })}
            prefetch
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] whitespace-nowrap",
              active ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#6e6680]",
            )}
          >
            {TAB_LABELS[tab]} {count(tab)}
          </Link>
        );
      })}
    </nav>
  );
}

export function OrderListView({ list, params }: { list: OrderList; params: OrderListParams }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <TabNav params={params} count={(tab) => list.counts[tab]} />

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        {list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">No Orders here.</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[860px]">
              <div className="sticky top-0 z-10 flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={cn(HEAD, col.className)}>
                    {col.header}
                  </div>
                ))}
              </div>
              {list.rows.map((row) => (
                <div
                  key={row.id}
                  data-order-row
                  className="flex items-center border-b border-[#efebf4] py-[11px]"
                >
                  <div className={cn(CELL, COLUMNS[0].className, "font-medium text-[#5b2a86]")}>
                    <Link href={`/orders/${row.id}`}>#{row.id}</Link>
                  </div>
                  <div className={cn(CELL, COLUMNS[1].className)}>{formatDate(row.createdAt)}</div>
                  <div className={cn(CELL, COLUMNS[2].className)}>
                    <span className="truncate pr-3">{row.customerName}</span>
                  </div>
                  <div className={cn(CELL, COLUMNS[3].className)}>
                    <span className="truncate pr-3">
                      {row.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ")}
                    </span>
                  </div>
                  <div className={cn(CELL, COLUMNS[4].className)}>{formatPesos(row.total)}</div>
                  <div className={cn(CELL, COLUMNS[5].className)}>
                    <PaymentPill label={row.paymentLabel} />
                  </div>
                  <div className={cn(CELL, COLUMNS[6].className)}>
                    <StatusPill status={row.status} />
                  </div>
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
