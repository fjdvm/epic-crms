import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { describeClock, type Clock } from "./service-level";
import { ClaimButton } from "./ticket-controls";
import { PILL, Pill, PRIORITY_LABELS, PRIORITY_PILLS } from "./pill";
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
};

/** The Figma frame's columns, minus Channel: a Ticket has no Channel. They share the table width in proportion, so the rows fill the card. */
export const COLUMNS: { header: string; className: string }[] = [
  { header: "Ticket", className: "flex-[1_1_100px]" },
  { header: "Subject", className: "min-w-0 flex-[3_1_270px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { header: "Linked order", className: "flex-[1_1_120px]" },
  { header: "Category", className: "min-w-0 flex-[1_1_130px]" },
  { header: "Priority", className: "flex-[1_1_100px]" },
  { header: "Claimed by", className: "min-w-0 flex-[1_1_130px]" },
  { header: "Status", className: "flex-[1_1_110px]" },
  { header: "Service level", className: "flex-[1_1_130px]" },
  { header: "", className: "flex-[0_0_90px] justify-end" },
];

function href(
  params: TicketListParams,
  change: Partial<TicketListParams>,
): string {
  return ticketsHref({ ...params, ...change });
}

function ServiceCell({ clock }: { clock: Clock }) {
  const tone =
    clock.state === "missed"
      ? "text-[#b91c1c]"
      : clock.state === "breaching"
        ? "text-[#b45309]"
        : clock.state === "met"
          ? "text-[#15803d]"
          : "text-[#6e6680]";

  return <span className={cn("font-medium", tone)}>{describeClock(clock)}</span>;
}

function StatusPill({ row }: { row: TicketRow }) {
  if (row.status === "resolved")
    return <Pill className={PILL.green}>Resolved</Pill>;
  if (row.status === "completed")
    return <Pill className={PILL.green}>Completed</Pill>;
  if (row.overdue) return <Pill className={PILL.red}>Overdue</Pill>;
  if (row.waiting) return <Pill className={PILL.amber}>Waiting</Pill>;

  return <Pill className={PILL.red}>Open</Pill>;
}

export const HEAD = "flex items-start overflow-clip";
export const CELL =
  "flex items-start overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

export function TicketListView({
  list,
  params,
}: {
  list: TicketList;
  params: TicketListParams;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <nav className="flex shrink-0 gap-1" aria-label="Ticket tabs">
        {TICKET_TABS.map((tab) => {
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
        {list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">
            {hasTicketFilters(params)
              ? "No Tickets match this search and these filters."
              : "No Tickets here."}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1130px]">
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
                  className="flex items-center border-b border-[#efebf4] py-[11px]"
                >
                  <div
                    className={cn(
                      CELL,
                      COLUMNS[0].className,
                      "font-medium text-[#5b2a86]",
                    )}
                  >
                    <Link href={`/tickets/${row.id}`}>TKT-{row.id}</Link>
                  </div>
                  <div className={cn(CELL, COLUMNS[1].className)}>
                    <span className="truncate pr-3">{row.subject}</span>
                  </div>
                  <div className={cn(CELL, COLUMNS[2].className)}>
                    <span className="truncate pr-3">{row.customerName}</span>
                  </div>
                  <div className={cn(CELL, COLUMNS[3].className)}>
                    {row.orderId === null ? "None yet" : `#${row.orderId}`}
                  </div>
                  <div className={cn(CELL, COLUMNS[4].className)}>
                    <span className="truncate pr-3">{row.category}</span>
                  </div>
                  <div className={cn(CELL, COLUMNS[5].className)}>
                    <Pill className={PRIORITY_PILLS[row.priority]}>
                      {PRIORITY_LABELS[row.priority]}
                    </Pill>
                  </div>
                  <div className={cn(CELL, COLUMNS[6].className)}>
                    {row.claimedById === null ? (
                      <Pill className={PILL.amber}>Unclaimed</Pill>
                    ) : (
                      <span className="truncate pr-3">
                        {row.claimedByName ?? row.claimedById}
                      </span>
                    )}
                  </div>
                  <div className={cn(CELL, COLUMNS[7].className)}>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusPill row={row} />
                      {row.escalated && row.status !== "completed" && <Pill className={PILL.red}>Escalated</Pill>}
                    </span>
                  </div>
                  <div className={cn(CELL, COLUMNS[8].className)}>
                    <ServiceCell clock={row.serviceLevel.current} />
                  </div>
                  <div className={cn(CELL, COLUMNS[9].className)}>
                    {row.status !== "completed" && row.claimedById === null && (
                      <ClaimButton ticketId={row.id} />
                    )}
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
        {TICKET_TABS.map((tab) => (
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
            <div className="flex items-center border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
              {COLUMNS.map((col, c) => (
                <div key={c} className={cn(HEAD, col.className)}>
                  {col.header}
                </div>
              ))}
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div
                key={i}
                className="flex items-center border-b border-[#efebf4] py-[11px]"
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
