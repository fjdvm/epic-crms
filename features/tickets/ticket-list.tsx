import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  TICKET_TABS,
  type TicketList,
  type TicketPriority,
  type TicketRow,
  type TicketTab,
} from "./tickets";

export interface TicketListParams {
  tab: TicketTab;
  page: number;
}

const TAB_LABELS: Record<TicketTab, string> = {
  open: "Open",
  waiting: "Waiting on customer",
  resolved: "Resolved",
};

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Pill colours from the Figma badges: Open and High share one, Low follows Normal and Urgent follows High. */
const PILL = {
  red: "bg-[#fbe6e0] text-[#9a3412]",
  grey: "bg-[#eeecf2] text-[#5a5368]",
  amber: "bg-[#fdf1d8] text-[#8a5a00]",
  green: "bg-[#e3f4e8] text-[#1e6b3a]",
} as const;

const PRIORITY_PILLS: Record<TicketPriority, string> = {
  low: PILL.grey,
  normal: PILL.grey,
  high: PILL.red,
  urgent: PILL.red,
};

/** The Figma frame's columns, minus Channel: a Ticket has no Channel. They share the table width in proportion, so the rows fill the card. */
const COLUMNS: { header: string; className: string }[] = [
  { header: "Ticket", className: "flex-[1_1_100px]" },
  { header: "Subject", className: "min-w-0 flex-[3_1_270px]" },
  { header: "Customer", className: "min-w-0 flex-[2_1_150px]" },
  { header: "Linked order", className: "flex-[1_1_120px]" },
  { header: "Priority", className: "flex-[1_1_100px]" },
  { header: "Status", className: "flex-[1_1_110px]" },
];

function href(params: TicketListParams, change: Partial<TicketListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.tab !== "open") query.set("tab", next.tab);
  if (next.page > 1) query.set("page", String(next.page));

  const text = query.toString();

  return text ? `/tickets?${text}` : "/tickets";
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-[10px] py-[3px] text-xs font-medium leading-[normal] whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

function StatusPill({ row }: { row: TicketRow }) {
  if (row.status === "resolved" || row.status === "completed") {
    return <Pill className={PILL.green}>Resolved</Pill>;
  }
  if (row.overdue) return <Pill className={PILL.red}>Overdue</Pill>;
  if (row.waiting) return <Pill className={PILL.amber}>Waiting</Pill>;

  return <Pill className={PILL.red}>Open</Pill>;
}

const HEAD = "flex items-start overflow-clip";
const CELL = "flex items-start overflow-clip text-sm leading-[normal] text-[#1f1a2e]";

export function TicketListView({ list, params }: { list: TicketList; params: TicketListParams }) {
  return (
    <div className="space-y-5">
      <nav className="flex gap-1" aria-label="Ticket tabs">
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
      </nav>

      <div className="space-y-[14px] rounded-xl border border-[#e6e1ee] bg-white p-5">
        {list.rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#6e6680]">No Tickets here.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[740px]">
              <div className="flex items-center border-b border-[#efebf4] py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={cn(HEAD, col.className)}>
                    {col.header}
                  </div>
                ))}
              </div>
              {list.rows.map((row) => (
                <div key={row.id} className="flex items-center border-b border-[#efebf4] py-[11px]">
                  <div className={cn(CELL, COLUMNS[0].className, "font-medium text-[#5b2a86]")}>
                    TKT-{row.id}
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
                    <Pill className={PRIORITY_PILLS[row.priority]}>{PRIORITY_LABELS[row.priority]}</Pill>
                  </div>
                  <div className={cn(CELL, COLUMNS[5].className)}>
                    <StatusPill row={row} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {list.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
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
