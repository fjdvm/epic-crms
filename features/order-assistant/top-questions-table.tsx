"use client";

import {
  NoMatches,
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import type { ColumnDef } from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

export interface QuestionKindRow {
  kind: string;
  asked: number;
  /** Whole percent answered without a person. */
  rate: number;
}

const kindText = (r: QuestionKindRow) => r.kind.replaceAll("_", " ");

const COLUMNS: ColumnDef<QuestionKindRow>[] = [
  { key: "kind", label: "Top questions this week", sortValue: kindText, searchText: kindText },
  { key: "asked", label: "Asked", sortValue: (r) => r.asked },
  { key: "rate", label: "Answered", sortValue: (r) => r.rate },
];

const WIDTH: Record<string, string> = { kind: "flex-1", asked: "w-20 text-right", rate: "w-[170px] text-right" };

/** The order assistant's question kinds this week, most asked first; sorted and searched in the browser. */
export function TopQuestionsTable({ rows }: { rows: QuestionKindRow[] }) {
  const table = useTableState(rows, COLUMNS);

  return (
    <section className="overflow-hidden rounded-xl border border-[#e6e1ee] bg-white">
      {rows.length > 0 && (
        <div className="px-4 pt-3 pb-2">
          <TableToolbar state={table} label="Search questions" searchLabel="Search questions" placeholder="Question kind" />
        </div>
      )}
      <div role="row" className="flex justify-between gap-2 bg-[#fafafa] px-4 py-2.5 text-xs font-medium text-[#71717a]">
        {COLUMNS.map((c) => (
          <span key={c.key} role="columnheader" aria-sort={stateAriaSort(table, c.key)} className={WIDTH[c.key]}>
            <StateSortHeader state={table} columnKey={c.key} align={c.key === "kind" ? "left" : "right"} />
          </span>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="border-t px-4 py-3 text-[13px]">No stored questions this week.</p>
      ) : table.rows.length === 0 ? (
        <NoMatches noun="questions" onClear={table.clear} />
      ) : (
        table.rows.map((r) => (
          <div className="flex justify-between gap-2 border-t border-[#f0edf4] px-4 py-3 text-[13px]" key={r.kind}>
            <span className="flex-1 font-medium capitalize">{kindText(r)}</span>
            <span className={WIDTH.asked}>{r.asked}</span>
            <span className={cn(WIDTH.rate, r.rate >= 80 ? "text-[#1e6b3a]" : "text-[#b45309]")}>{r.rate}%</span>
          </div>
        ))
      )}
    </section>
  );
}
