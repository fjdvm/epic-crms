"use client";

import Link from "next/link";

import { ABOVE_ROW_LINK, CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import { formatDate, formatPesos } from "@/features/customer-profiles/format";
import { PILL, Pill } from "@/features/tickets/pill";

import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { returnDisplayLabel } from "./outcome";
import type { ReturnRow, ReturnStatus } from "./returns";

export const STATUS_PILLS: Record<ReturnStatus, string> = {
  requested: PILL.amber,
  approved: PILL.purple,
  "goods received": PILL.blue,
  refunded: PILL.grey,
  replaced: PILL.grey,
  declined: PILL.red,
  cancelled: PILL.grey,
};

const HEAD = "py-1.5 pr-3 text-left text-xs font-medium text-[#6e6680]";
const CELL = "py-[11px] pr-3 text-sm leading-[normal] text-[#1f1a2e]";
/** Money and the last column sit on the right, so the table spans its card edge to edge. */
const RIGHT = "pr-0 text-right";

const statusText = (r: ReturnRow) => returnDisplayLabel(r.status, r.goodsRequired, r.replacement);

function columns(showOrder: boolean): (ColumnDef<ReturnRow> & { right?: boolean })[] {
  return [
    { key: "return", label: "Return", sortValue: (r) => r.number, searchText: (r) => r.number },
    ...(showOrder
      ? [{ key: "order", label: "Order", sortValue: (r: ReturnRow) => r.orderId, searchText: (r: ReturnRow) => `#${r.orderId}` }]
      : []),
    { key: "status", label: "Status", sortValue: statusText, filter: { label: "Status", value: statusText } },
    { key: "amount", label: "Amount", sortValue: (r) => r.amount, right: true },
    { key: "requested", label: "Requested", sortValue: (r) => new Date(r.requestedAt), right: true },
  ];
}

const WITH_ORDER = columns(true);
const WITHOUT_ORDER = columns(false);

/**
 * A read-only table of Returns: number, status, amount and request date, plus the Order each belongs
 * to when `showOrder` is set. Null means the Returns could not be read, which is not the same as none.
 * It is shown only to someone holding the Returns Module, so each row opens its Return.
 */
export function ReturnsTable({
  returns,
  showOrder = false,
  canOpenOrder = false,
  empty,
}: {
  returns: ReturnRow[] | null;
  showOrder?: boolean;
  /** Staff who may open an Order's detail page get a link to it; others see its number. */
  canOpenOrder?: boolean;
  empty: string;
}) {
  const defs = showOrder ? WITH_ORDER : WITHOUT_ORDER;
  const table = useTableState(returns ?? [], defs);

  if (returns === null) {
    return <p className="text-sm text-[#6e6680]">Returns could not be loaded. Reload to try again.</p>;
  }
  if (returns.length === 0) return <p className="text-sm text-[#6e6680]">{empty}</p>;

  return (
    <div className="space-y-3">
      <TableToolbar state={table} label="Search and filter Returns" searchLabel="Search Returns" placeholder="Return no. or order" />
      {table.rows.length === 0 ? (
        <NoMatches noun="Returns" onClear={table.clear} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max whitespace-nowrap">
            <thead>
              <tr className="border-b border-[#efebf4]">
                {defs.map((c) => (
                  <th key={c.key} aria-sort={stateAriaSort(table, c.key)} className={cn(HEAD, c.right && RIGHT, c.key === "amount" && "pr-6")}>
                    <StateSortHeader state={table} columnKey={c.key} align={c.right ? "right" : "left"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} className={`${CLICKABLE_ROW} border-b border-[#efebf4] last:border-0`}>
                  <td className={`${CELL} font-medium text-[#5b2a86]`}>
                    <RowLink href={`/returns/${r.id}`}>{r.number}</RowLink>
                  </td>
                  {showOrder && (
                    <td className={CELL}>
                      {canOpenOrder ? (
                        <Link href={`/orders/${r.orderId}`} className={`${ABOVE_ROW_LINK} text-[#5b2a86]`}>
                          #{r.orderId}
                        </Link>
                      ) : (
                        `#${r.orderId}`
                      )}
                    </td>
                  )}
                  <td className={CELL}>
                    <Pill className={STATUS_PILLS[r.status]}>{statusText(r)}</Pill>
                  </td>
                  <td className={cn(CELL, RIGHT, "pr-6")}>{formatPesos(r.amount)}</td>
                  <td className={cn(CELL, RIGHT)}>{formatDate(r.requestedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
