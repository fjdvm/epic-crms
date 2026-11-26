"use client";

import Link from "next/link";

import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import { Pill } from "@/features/tickets/pill";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { handoffReason, waitingFor } from "./handoff-reasons";
import { SourceTag } from "./source-tag";

export interface HandoffRow {
  ticket_id: number;
  reason: string;
  sent_at: Date;
  subject: string;
  customer_name: string;
  order_id: number | null;
  claimed_by_name: string | null;
}

/** Fixed widths around a growing Subject, so the columns span the card edge to edge. */
const COLS: Record<string, string> = {
  ticket: "w-[100px] shrink-0",
  customer: "w-[150px] shrink-0",
  subject: "min-w-0 flex-1",
  why: "w-[230px] shrink-0",
  order: "w-[100px] shrink-0",
  waiting: "w-[90px] shrink-0",
  assignee: "w-[120px] shrink-0 text-right justify-end flex",
};

const whyText = (r: HandoffRow) => handoffReason(r.reason).label;
const assigneeText = (r: HandoffRow) => r.claimed_by_name ?? "Unassigned";

const COLUMNS: ColumnDef<HandoffRow>[] = [
  { key: "ticket", label: "Ticket", sortValue: (r) => r.ticket_id, searchText: (r) => `TKT-${r.ticket_id}` },
  { key: "customer", label: "Customer", sortValue: (r) => r.customer_name, searchText: (r) => r.customer_name },
  { key: "subject", label: "Subject", sortValue: (r) => r.subject, searchText: (r) => r.subject },
  { key: "why", label: "Why handed off", sortValue: whyText, filter: { label: "Why", value: whyText } },
  { key: "order", label: "Order", sortValue: (r) => r.order_id, searchText: (r) => (r.order_id ? `BR-${r.order_id}` : null) },
  // Waiting longest first is the oldest send time first.
  { key: "waiting", label: "Waiting", sortValue: (r) => -new Date(r.sent_at).getTime() },
  { key: "assignee", label: "Assignee", sortValue: (r) => r.claimed_by_name, filter: { label: "Assignee", value: assigneeText } },
];

/** The Tickets the order assistant handed to the team, sorted and filtered in the browser. */
export function HandoffTable({ rows, now }: { rows: HandoffRow[]; now: Date }) {
  const table = useTableState(rows, COLUMNS);

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {rows.length > 0 && (
        <TableToolbar state={table} label="Search and filter handed-off Tickets" searchLabel="Search handed-off Tickets" placeholder="Ticket, customer, subject or order" />
      )}
      <div className="min-h-0 overflow-auto rounded-xl border border-[#e6e1ee] bg-white">
        <div className="min-w-[1000px]">
          <div role="row" className="flex items-center justify-between gap-2 bg-[#fafafa] px-4 py-2.5 text-xs font-medium text-[#71717a]">
            {COLUMNS.map((c) => (
              <div key={c.key} role="columnheader" aria-sort={stateAriaSort(table, c.key)} className={COLS[c.key]}>
                <StateSortHeader state={table} columnKey={c.key} align={c.key === "assignee" ? "right" : "left"} />
              </div>
            ))}
          </div>
          {table.rows.map((r) => {
            const why = handoffReason(r.reason);
            const hours = (+now - +new Date(r.sent_at)) / 3600000;
            return (
              <Link
                href={`/tickets/${r.ticket_id}`}
                prefetch
                key={r.ticket_id}
                className="flex items-center justify-between gap-2 border-t border-[#f0edf4] px-4 py-3 text-[13px] text-[#18181b]"
              >
                <div className={cn(COLS.ticket, "font-semibold text-[#5b2a86]")}>TKT-{r.ticket_id}</div>
                <div className={cn(COLS.customer, "truncate font-semibold")}>{r.customer_name}</div>
                <div className={cn(COLS.subject, "flex flex-col items-start gap-0.5")}>
                  <span className="truncate font-medium">{r.subject}</span>
                  <SourceTag />
                </div>
                <div className={cn(COLS.why, "flex flex-col items-start gap-0.5")}>
                  <Pill className={why.tone}>{why.label}</Pill>
                  {why.note && <span className="text-xs text-[#71717a]">{why.note}</span>}
                </div>
                <div className={cn(COLS.order, "font-semibold text-[#5b2a86]")}>{r.order_id ? `BR-${r.order_id}` : "—"}</div>
                <div className={cn(COLS.waiting, hours >= 0.5 && "text-[#b45309]")}>{waitingFor(new Date(r.sent_at), now)}</div>
                <div className={COLS.assignee}>
                  {r.claimed_by_name ?? <Pill className="bg-[#fdf1d8] text-[#8a5a00]">Unassigned</Pill>}
                </div>
              </Link>
            );
          })}
          {!rows.length && <p className="p-5 text-sm text-[#6e6680]">No handed-off Tickets yet.</p>}
          {rows.length > 0 && !table.rows.length && <NoMatches noun="handed-off Tickets" onClear={table.clear} />}
        </div>
      </div>
    </div>
  );
}
