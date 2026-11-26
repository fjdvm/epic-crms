"use client";

import Link from "next/link";

import { ABOVE_ROW_LINK, CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import { formatDate } from "@/features/customer-profiles/format";
import { orderLabel } from "@/features/customer-profiles/rules";
import { Pill } from "@/features/tickets/pill";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { returnAnchor } from "./anchor";
import { returnDisplayLabel } from "./outcome";
import { ReturnFlagNotes } from "./return-flag-notes";
import type { ReturnFlag } from "./return-flags";
import { CELL, COLUMNS, HEAD, ROW } from "./return-layout";
import type { ReturnRow } from "./returns";
import { STATUS_PILLS } from "./returns-table";

const itemsText = (r: ReturnRow) => r.items.map((i) => `${i.product} ×${i.quantity}`).join(", ");
const resolutionText = (r: ReturnRow) => orderLabel(r.finalResolution ?? r.preferredResolution);
const statusText = (r: ReturnRow) => returnDisplayLabel(r.status, r.goodsRequired, r.replacement);

const COLUMN_DEFS: ColumnDef<ReturnRow>[] = [
  { key: "return", label: "Return", sortValue: (r) => r.number, searchText: (r) => r.number },
  { key: "customer", label: "Customer", sortValue: (r) => r.customer.name, searchText: (r) => r.customer.name },
  { key: "order", label: "Order", sortValue: (r) => r.orderId, searchText: (r) => `#${r.orderId}` },
  {
    key: "items",
    label: "Items",
    sortValue: (r) => r.items.reduce((sum, i) => sum + i.quantity, 0),
    searchText: itemsText,
  },
  {
    key: "resolution",
    label: "Resolution",
    sortValue: resolutionText,
    filter: { label: "Resolution", value: resolutionText },
  },
  { key: "status", label: "Status", sortValue: statusText, filter: { label: "Status", value: statusText } },
  { key: "requested", label: "Requested", sortValue: (r) => new Date(r.requestedAt) },
];

/** The Returns on this page, sorted and filtered in the browser. Starts in the order the server sent. */
export function ReturnTable({ rows, flags }: { rows: ReturnRow[]; flags?: Map<number, ReturnFlag[]> }) {
  const table = useTableState(rows, COLUMN_DEFS);

  return (
    <>
      <TableToolbar
        state={table}
        label="Search and filter Returns"
        searchLabel="Search Returns"
        placeholder="Return no., customer, order or product"
      />
      {table.rows.length === 0 ? (
        <NoMatches noun="Returns" onClear={table.clear} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[760px]">
            <div
              data-return-head
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
                id={returnAnchor(row.id)}
                data-return-row
                className={cn(CLICKABLE_ROW, ROW, "scroll-mt-10 border-b border-[#efebf4] py-[11px]")}
              >
                <div className={cn(CELL, COLUMNS[0].className, "flex-col font-medium text-[#5b2a86]")}>
                  <RowLink href={`/returns/${row.id}`} className="hover:underline">
                    {row.number}
                  </RowLink>
                  <div className={ABOVE_ROW_LINK}>
                    <ReturnFlagNotes flags={flags?.get(row.id)} compact />
                  </div>
                </div>
                <div className={cn(CELL, COLUMNS[1].className)}>
                  <span className="truncate pr-3">{row.customer.name}</span>
                </div>
                <div className={cn(CELL, COLUMNS[2].className)}>
                  <Link href={`/orders/${row.orderId}`} className={cn(ABOVE_ROW_LINK, "text-[#5b2a86]")}>
                    #{row.orderId}
                  </Link>
                </div>
                <div className={cn(CELL, COLUMNS[3].className)}>
                  <span className="truncate pr-3">{itemsText(row)}</span>
                </div>
                <div className={cn(CELL, COLUMNS[4].className)}>{resolutionText(row)}</div>
                <div className={cn(CELL, COLUMNS[5].className)}>
                  <Pill className={STATUS_PILLS[row.status]}>{statusText(row)}</Pill>
                </div>
                <div className={cn(CELL, COLUMNS[6].className)}>{formatDate(row.requestedAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
