import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { AssignableStaff } from "./staffs";
import { CELL, COLUMNS, HEAD, ROW } from "./ticket-layout";
import { TicketTable, type RowsViewer } from "./ticket-rows";
import {
  hasTicketFilters,
  ticketsHref,
  type TicketParams,
} from "./ticket-params";
import {
  TICKET_TABS,
  type TicketList,
  type TicketRow,
  type TicketTab,
} from "./tickets";

export type TicketListParams = TicketParams;

export const TAB_LABELS: Record<TicketTab, string> = {
  open: "Open",
  waiting: "Waiting on customer",
  on_hold: "On hold",
  resolved: "Resolved",
  completed: "Completed",
  all: "All",
  mine: "Mine",
  staffs: "Staffs",
};

function href(
  params: TicketListParams,
  change: Partial<TicketListParams>,
): string {
  return ticketsHref({ ...params, ...change });
}

export { COLUMNS, HEAD, CELL };

const NO_VIEWER: RowsViewer = { id: "", name: "", role: null };

export function TicketListView({
  list,
  params,
  viewer = NO_VIEWER,
  staffs = [],
  openId = null,
  now = Date.now(),
}: {
  list: TicketList;
  params: TicketListParams;
  viewer?: RowsViewer;
  /** Everyone a Ticket can be assigned to, for the Staffs tab and the drawer. */
  staffs?: AssignableStaff[];
  openId?: number | null;
  now?: number;
}) {
  // Staff only ever see their own work, so the Staffs tab is for everyone else.
  const tabs = TICKET_TABS.filter((t) => t !== "staffs" || viewer.role !== "staff");
  const staffsOverview = params.tab === "staffs" && !params.claimedBy;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <nav className="flex shrink-0 gap-1" aria-label="Ticket tabs">
        {tabs.map((tab) => {
          const active = tab === params.tab;

          return (
            <Link
              key={tab}
              href={href(params, { tab, page: 1 })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal]",
                active ? "bg-[#efe6f8] text-[#5b2a86]" : "text-[#6e6680]",
              )}
            >
              {TAB_LABELS[tab]} {list.counts[tab]}
            </Link>
          );
        })}
        <Link href="/tickets/assistant" prefetch className="rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] text-[#6e6680]">From order assistant</Link>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        {staffsOverview ? (
          <ul className="min-h-0 flex-1 overflow-auto" aria-label="Staffs">
            {staffs.length === 0 && <li className="p-8 text-center text-sm text-[#6e6680]">No one is available to assign.</li>}
            {staffs.map((s) => (
              <li key={s.id} className="border-b border-[#efebf4]">
                <Link href={href(params, { tab: "staffs", claimedBy: s.id, page: 1 })} className="flex items-center justify-between py-3 text-sm text-[#1f1a2e]">
                  <span className="font-medium">{s.name} <span className="text-xs font-normal text-[#6e6680]">{s.role === "manager" ? "Manager" : "Staff / Employee"}</span></span>
                  <span className="text-[#6e6680]">{s.open} open</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">
            {hasTicketFilters(params)
              ? "No Tickets match this search and these filters."
              : "No Tickets here."}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1130px]">
              <TicketTable rows={list.rows} viewer={viewer} staffs={staffs} now={now} openId={openId} />
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

/** The tabs and table with only the data (counts, rows) as skeleton; shown at once while a tab, search or filter loads. */
export function TicketListSkeleton({
  announce = true,
}: {
  announce?: boolean;
}) {
  return (
    <div
      {...(announce ? { role: "status", "aria-label": "Loading Tickets" } : {})}
      className="flex min-h-0 flex-1 flex-col gap-5"
    >
      <nav
        className="flex shrink-0 gap-1 overflow-hidden"
        aria-label="Ticket tabs"
      >
        {TICKET_TABS.filter((t) => t !== "staffs").map((tab) => (
          <span
            key={tab}
            className="flex items-center gap-1.5 rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] whitespace-nowrap text-[#6e6680]"
          >
            {TAB_LABELS[tab]} <Skeleton className="h-4 w-5" />
          </span>
        ))}
        <Link href="/tickets/assistant" prefetch className="rounded-lg px-[14px] py-2 text-sm font-medium leading-[normal] text-[#6e6680]">From order assistant</Link>
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="min-w-[1130px]">
            <div className="flex w-full items-center justify-between border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
              {COLUMNS.map((col, c) => (
                <div key={c} className={cn(HEAD, col.className)}>
                  {col.header}
                </div>
              ))}
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className={cn(ROW, "border-b border-[#efebf4] py-[11px]")}
              >
                {COLUMNS.map((col, c) => (
                  <div key={c} className={cn(CELL, col.className)}>
                    {col.header && <Skeleton className="h-4 w-3/4" />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
