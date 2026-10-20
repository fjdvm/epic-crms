import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
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

const PRIORITY_VARIANTS: Record<TicketPriority, BadgeProps["variant"]> = {
  low: "secondary",
  normal: "info",
  high: "warning",
  urgent: "destructive",
};

const COLUMNS: { header: string; className: string }[] = [
  { header: "Ticket", className: "shrink-0 w-[100px]" },
  { header: "Subject", className: "flex-1 min-w-[260px]" },
  { header: "Customer", className: "shrink-0 w-[180px]" },
  { header: "Linked order", className: "shrink-0 w-[120px]" },
  { header: "Priority", className: "shrink-0 w-[110px]" },
  { header: "Status", className: "shrink-0 w-[130px]" },
];

function href(params: TicketListParams, change: Partial<TicketListParams>): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();

  if (next.tab !== "open") query.set("tab", next.tab);
  if (next.page > 1) query.set("page", String(next.page));

  const text = query.toString();

  return text ? `/tickets?${text}` : "/tickets";
}

function StatusBadge({ row }: { row: TicketRow }) {
  if (row.status === "resolved") return <Badge variant="success">Resolved</Badge>;
  if (row.status === "completed") return <Badge variant="purple">Completed</Badge>;
  if (row.overdue) return <Badge variant="destructive">Overdue</Badge>;
  if (row.waiting) return <Badge variant="secondary">Waiting on customer</Badge>;

  return <Badge variant="info">Open</Badge>;
}

const CELL = "py-[11px] pr-3 text-sm text-foreground";

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
                "rounded-lg px-3.5 py-2 text-sm font-medium",
                active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {TAB_LABELS[tab]} {list.counts[tab]}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
        {list.rows.length === 0 ? (
          <div className="p-xl text-center text-muted-foreground">No Tickets here.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="flex items-center border-b border-border-subtle py-1.5 text-xs font-medium text-muted-foreground">
                {COLUMNS.map((col) => (
                  <div key={col.header} className={col.className}>
                    {col.header}
                  </div>
                ))}
              </div>
              {list.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center border-b border-border-subtle last:border-0 hover:bg-secondary"
                >
                  <div className={cn(COLUMNS[0].className, CELL, "font-medium")}>TKT-{row.id}</div>
                  <div className={cn(COLUMNS[1].className, CELL, "truncate")}>{row.subject}</div>
                  <div className={cn(COLUMNS[2].className, CELL, "truncate")}>{row.customerName}</div>
                  <div className={cn(COLUMNS[3].className, CELL, row.orderId === null && "text-muted-foreground")}>
                    {row.orderId === null ? "None yet" : `#${row.orderId}`}
                  </div>
                  <div className={cn(COLUMNS[4].className, CELL)}>
                    <Badge variant={PRIORITY_VARIANTS[row.priority]}>{PRIORITY_LABELS[row.priority]}</Badge>
                  </div>
                  <div className={cn(COLUMNS[5].className, CELL)}>
                    <StatusBadge row={row} />
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
