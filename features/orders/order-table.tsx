"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useMemo } from "react";

import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { CELL, COLUMNS, HEAD, ROW } from "./order-layout";
import type { ListCodFlags } from "./order-list";
import type { OrderRow } from "./orders";
import { PaymentPill, StatusPill } from "./status-pill";

function itemsText(row: OrderRow): string {
  return row.lines.map((l) => `${l.product} ×${l.quantity}`).join(", ");
}

function columns(statusOrder: readonly string[]): ColumnDef<OrderRow>[] {
  return [
    { key: "order", label: "Order", sortValue: (r) => r.id, searchText: (r) => `#${r.id}` },
    { key: "date", label: "Date", sortValue: (r) => new Date(r.createdAt) },
    { key: "customer", label: "Customer", sortValue: (r) => r.customerName, searchText: (r) => r.customerName },
    {
      key: "items",
      label: "Items",
      sortValue: (r) => r.lines.reduce((sum, l) => sum + l.quantity, 0),
      searchText: itemsText,
    },
    { key: "total", label: "Total", sortValue: (r) => r.total },
    {
      key: "payment",
      label: "Payment",
      sortValue: (r) => r.paymentLabel,
      filter: {
        label: "Payment",
        options: ["Paid", "Unpaid", "Cancelled"].map((v) => ({ value: v, label: v })),
        value: (r) => r.paymentLabel,
      },
    },
    {
      key: "status",
      label: "Status",
      sortValue: (r) => {
        const at = statusOrder.indexOf(r.status);
        return at === -1 ? statusOrder.length : at;
      },
      filter: {
        label: "Status",
        options: statusOrder.map((s) => ({ value: s, label: orderLabel(s) })),
        value: (r) => r.status,
      },
    },
  ];
}

/**
 * The Orders on this page, sorted and filtered in the browser: a click on a heading or a filter shows at once,
 * with no trip to the server. Starts in the order the server sent (newest first).
 */
export function OrderTable({
  rows,
  codFlags,
  statusOrder,
}: {
  rows: OrderRow[];
  codFlags: ListCodFlags;
  statusOrder: readonly string[];
}) {
  const defs = useMemo(() => columns(statusOrder), [statusOrder]);
  const table = useTableState(rows, defs);

  return (
    <>
      <TableToolbar
        state={table}
        label="Search and filter Orders"
        searchLabel="Search Orders"
        placeholder="Order no., customer or product"
      />
      {table.rows.length === 0 ? (
        <NoMatches noun="Orders" onClear={table.clear} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[860px]">
            <div
              role="row"
              className={cn(
                ROW,
                "sticky top-0 z-10 border-b border-[#efebf4] bg-white py-1.5 text-xs font-medium leading-[normal] text-[#6e6680]",
              )}
            >
              {COLUMNS.map((col) => (
                <div
                  key={col.key}
                  role="columnheader"
                  aria-sort={stateAriaSort(table, col.key)}
                  className={cn(HEAD, col.className)}
                >
                  <StateSortHeader state={table} columnKey={col.key} align={col.align} />
                </div>
              ))}
            </div>
            {table.rows.map((row) => (
              <div
                key={row.id}
                data-order-row
                className={cn(ROW, "relative border-b border-[#efebf4] py-[11px] hover:bg-[#faf8fc]")}
              >
                <div className={cn(CELL, COLUMNS[0].className, "font-medium text-[#5b2a86]")}>
                  <Link href={`/orders/${row.id}`} className="after:absolute after:inset-0">
                    #{row.id}
                  </Link>
                </div>
                <div className={cn(CELL, COLUMNS[1].className)}>{formatDate(row.createdAt)}</div>
                <div className={cn(CELL, COLUMNS[2].className)}>
                  <span className="truncate pr-3">{row.customerName}</span>
                </div>
                <div className={cn(CELL, COLUMNS[3].className)}>
                  <span className="truncate pr-3">{itemsText(row)}</span>
                </div>
                <div className={cn(CELL, COLUMNS[4].className)}>{formatPesos(row.total)}</div>
                <div className={cn(CELL, COLUMNS[5].className)}>
                  <div className="flex min-w-0 flex-col items-start gap-1">
                    <PaymentPill label={row.paymentLabel} />
                    {(codFlags[row.id] ?? []).length > 0 && (
                      <ul
                        data-testid={`cod-flags-${row.id}`}
                        aria-label={`Cash on Delivery flags for Order #${row.id}`}
                        className="space-y-0.5 text-[11px] leading-tight text-[#8a5a00]"
                      >
                        {codFlags[row.id].map((f) => (
                          <li key={f.rule} className="flex items-start gap-1">
                            <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
                            {f.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className={cn(CELL, COLUMNS[6].className)}>
                  <StatusPill status={row.status} />
                  {row.cancelRequested && (
                    <span className="ml-1.5 rounded-full bg-[#fdf1d8] px-2 py-0.5 text-[11px] font-medium text-[#8a5a00]">
                      Cancel requested
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
