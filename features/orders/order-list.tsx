import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { orderLabel } from "@/features/customer-profiles/rules";
import { cn } from "@/lib/utils";

import { ORDER_STATUSES, ORDER_TABS, type OrderList, type OrderTab } from "./orders";
import { OrderTable } from "./order-table";

export { CELL, COLUMNS, HEAD, ROW } from "./order-layout";

export interface OrderListParams {
  tab: OrderTab;
  page: number;
}

export const TAB_LABELS: Record<OrderTab, string> = {
  all: "All",
  ...Object.fromEntries(ORDER_TABS.slice(1).map((t) => [t, orderLabel(t)])),
  "cancel-requests": "Cancel requests",
} as Record<OrderTab, string>;

function href(params: OrderListParams, change: Partial<OrderListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.tab !== "all") query.set("tab", next.tab);
  if (next.page > 1) query.set("page", String(next.page));

  const text = query.toString();

  return text ? `/orders?${text}` : "/orders";
}


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

/** Which Cash on Delivery rules fired, by Order number. Only Staff and Managers are given it; rules only, never a score. */
export type ListCodFlags = Readonly<Record<number, readonly { rule: string; label: string }[]>>;

export function OrderListView({ list, params, codFlags = {} }: { list: OrderList; params: OrderListParams; codFlags?: ListCodFlags }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <TabNav params={params} count={(tab) => list.counts[tab]} />

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        {list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">No Orders here.</div>
        ) : (
          <OrderTable rows={list.rows} codFlags={codFlags} statusOrder={ORDER_STATUSES} />
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
