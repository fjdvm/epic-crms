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
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { refundMethodLabel } from "@/features/returns/refund-record";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import type { RefundRow } from "./refunds";

const HEAD = "py-1.5 pr-3 text-left text-xs font-medium text-[#6e6680]";
const CELL = "py-[11px] pr-3 text-sm leading-[normal] text-[#1f1a2e]";
/** Money and the last column sit on the right, so the table spans the card edge to edge. */
const RIGHT = "pr-0 text-right";

const methodText = (r: RefundRow) => (r.method ? refundMethodLabel(r.method) : null);

const COLUMNS: (ColumnDef<RefundRow> & { right?: boolean })[] = [
  { key: "return", label: "Return", sortValue: (r) => r.number, searchText: (r) => r.number },
  { key: "order", label: "Order", sortValue: (r) => r.orderId, searchText: (r) => `#${r.orderId}` },
  { key: "customer", label: "Customer", sortValue: (r) => r.customer, searchText: (r) => r.customer },
  { key: "refunded", label: "Refunded", sortValue: (r) => r.amountInCentavos, right: true },
  { key: "sentBy", label: "Sent by", sortValue: methodText, filter: { label: "Sent by", value: methodText } },
  { key: "reference", label: "Reference", sortValue: (r) => r.reference, searchText: (r) => r.reference },
  {
    key: "settledBy",
    label: "Settled by",
    sortValue: (r) => r.settledBy,
    filter: { label: "Settled by", value: (r) => r.settledBy },
  },
  { key: "date", label: "Date", sortValue: (r) => new Date(r.refundedAt), right: true },
];

/**
 * The Payments page's record of refunds: what went back to whom, how, and who settled it. Read-only; a refund is settled
 * on its Return by a Manager. Null means the refunds could not be read. A row opens its Return, or its Order for
 * someone without the Returns page. Sorted and filtered in the browser.
 */
export function RefundsTable({ refunds, canOpenReturns }: { refunds: RefundRow[] | null; canOpenReturns: boolean }) {
  const table = useTableState(refunds ?? [], COLUMNS);

  if (refunds === null) return <p className="p-3 text-center text-sm text-[#6e6680]">Refunds could not be loaded. Reload to try again.</p>;
  if (refunds.length === 0) return <p className="p-3 text-center text-sm text-[#6e6680]">No refunds in the last 30 days.</p>;

  return (
    <div className="space-y-3">
      <TableToolbar state={table} label="Search and filter refunds" searchLabel="Search refunds" placeholder="Return no., order, customer or reference" />
      {table.rows.length === 0 ? (
        <NoMatches noun="refunds" onClear={table.clear} />
      ) : (
        <table className="w-full min-w-[860px] whitespace-nowrap" aria-label="Refunds">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-[#efebf4]">
              {COLUMNS.map((c) => (
                <th key={c.key} aria-sort={stateAriaSort(table, c.key)} className={cn(HEAD, c.right && RIGHT, c.key === "refunded" && "pr-6")}>
                  <StateSortHeader state={table} columnKey={c.key} align={c.right ? "right" : "left"} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.returnId} className={`${CLICKABLE_ROW} border-b border-[#efebf4] last:border-0`}>
                <td className={`${CELL} font-medium`}>
                  {canOpenReturns ? <RowLink href={`/returns/${r.returnId}`} prefetch className="text-[#5b2a86]">{r.number}</RowLink> : r.number}
                </td>
                <td className={CELL}>
                  {canOpenReturns
                    ? <Link href={`/orders/${r.orderId}`} prefetch className={`${ABOVE_ROW_LINK} text-[#5b2a86]`}>#{r.orderId}</Link>
                    : <RowLink href={`/orders/${r.orderId}`} prefetch className="text-[#5b2a86]">#{r.orderId}</RowLink>}
                </td>
                <td className={CELL}>{r.customer}</td>
                <td className={cn(CELL, "font-medium", RIGHT, "pr-6")}>{formatPesos(r.amountInCentavos)}</td>
                <td className={CELL}>{methodText(r) ?? "–"}</td>
                <td className={CELL}>{r.reference ?? "–"}</td>
                <td className={CELL}>{r.settledBy ?? "–"}</td>
                <td className={cn(CELL, RIGHT)}>{formatDate(r.refundedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
