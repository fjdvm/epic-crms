"use client";

import { CLICKABLE_ROW, RowLink } from "@/components/shared/row-link";
import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import { ticketsHref } from "@/features/tickets/ticket-params";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { formatStars } from "./format-stars";
import type { StaffLoad } from "./ticket-report";

const COLUMNS: (ColumnDef<StaffLoad> & { right?: boolean })[] = [
  { key: "name", label: "Staff member", sortValue: (s) => s.name, searchText: (s) => s.name },
  { key: "open", label: "Open now", sortValue: (s) => s.open, right: true },
  { key: "resolved", label: "Resolved", sortValue: (s) => s.resolved, right: true },
  { key: "rating", label: "Avg rating", sortValue: (s) => s.averageRating, right: true },
];

/** The Ticket report's "By Staff member" table, sorted and searched in the browser. Starts in the server's order. */
export function StaffTable({ staff }: { staff: StaffLoad[] }) {
  const table = useTableState(staff, COLUMNS);

  return (
    <div className="flex flex-col gap-3">
      <TableToolbar state={table} label="Search Staff members" searchLabel="Search Staff members" placeholder="Staff member" />
      {table.rows.length === 0 ? (
        <NoMatches noun="Staff members" onClear={table.clear} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-[#71717a]">
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} aria-sort={stateAriaSort(table, c.key)} className={cn("py-1 font-medium", c.right && "text-right")}>
                    <StateSortHeader state={table} columnKey={c.key} align={c.right ? "right" : "left"} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((s) => (
                <tr key={s.id} className={`${CLICKABLE_ROW} border-t border-[#f1eef6]`}>
                  <td className="py-2 text-[#18181b]">
                    <RowLink href={ticketsHref({ tab: "all", page: 1, claimedBy: s.id })} prefetch>{s.name}</RowLink>
                  </td>
                  <td className="py-2 text-right">{s.open}</td>
                  <td className="py-2 text-right">{s.resolved}</td>
                  <td className="py-2 text-right">{formatStars(s.averageRating)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
