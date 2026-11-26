"use client";

import { useMemo, useState } from "react";

import {
  filterOptions,
  filterRows,
  nextSort,
  sortRows,
  type ColumnDef,
  type SortState,
} from "@/lib/table/sort-filter";
import { cn } from "@/lib/utils";

import { ariaSort, SortHeader } from "./sort-header";
import { ClearFilters, OptionFilter, SearchBox, ToolbarRow } from "./table-toolbar";

export interface TableState<Row> {
  /** The rows after search, filters and sort. */
  rows: Row[];
  /** How many rows there are before search and filters. */
  total: number;
  sort: SortState | null;
  sortBy: (key: string) => void;
  /** What the search box shows; it applies as it is typed. */
  query: string;
  setQuery: (value: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string | undefined) => void;
  filtered: boolean;
  clear: () => void;
  columns: readonly ColumnDef<Row>[];
  source: readonly Row[];
}

/**
 * Sort, search and filter for a table whose rows are all in memory. Nothing goes to the server, so every
 * change, each keystroke included, shows in the same frame.
 */
export function useTableState<Row>(
  source: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  options: { initialSort?: SortState | null; initialQuery?: string } = {},
): TableState<Row> {
  const [sort, setSort] = useState<SortState | null>(options.initialSort ?? null);
  const [query, setQuery] = useState(options.initialQuery ?? "");
  const [filters, setFilters] = useState<Record<string, string>>({});

  const rows = useMemo(
    () => sortRows(filterRows(source, columns, { q: query, filters }), columns, sort),
    [source, columns, query, filters, sort],
  );

  return {
    rows,
    total: source.length,
    sort,
    sortBy: (key) => setSort((current) => nextSort(current, key)),
    query,
    setQuery,
    filters,
    setFilter: (key, value) =>
      setFilters((current) => {
        const next = { ...current };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return next;
      }),
    filtered: Boolean(query.trim()) || Object.keys(filters).length > 0,
    clear: () => {
      setQuery("");
      setFilters({});
    },
    columns,
    source,
  };
}

/** Search, one dropdown per filterable column, and Clear filters, for a table run by `useTableState`. */
export function TableToolbar<Row>({
  state,
  label,
  searchLabel,
  placeholder,
  children,
}: {
  state: TableState<Row>;
  label: string;
  searchLabel: string;
  placeholder: string;
  /** Extra controls placed after the filters. */
  children?: React.ReactNode;
}) {
  const searchable = state.columns.some((c) => c.searchText);

  return (
    <ToolbarRow label={label}>
      {searchable && (
        <SearchBox label={searchLabel} placeholder={placeholder} value={state.query} onChange={state.setQuery} />
      )}
      {state.columns
        .filter((c) => c.filter)
        .map((c) => (
          <OptionFilter
            key={c.key}
            label={c.filter!.label}
            options={filterOptions(c, state.source)}
            value={state.filters[c.key]}
            onChange={(v) => state.setFilter(c.key, v)}
          />
        ))}
      {children}
      {state.filtered && <ClearFilters onClear={state.clear} />}
    </ToolbarRow>
  );
}

/** A heading for a column of a `useTableState` table: sortable when the column has a `sortValue`. */
export function StateSortHeader<Row>({
  state,
  columnKey,
  align,
  className,
}: {
  state: TableState<Row>;
  columnKey: string;
  align?: "left" | "right";
  className?: string;
}) {
  const column = state.columns.find((c) => c.key === columnKey);
  if (!column) return null;
  if (!column.sortValue) return <span className={className}>{column.label}</span>;

  const active = state.sort?.key === columnKey;

  return (
    <SortHeader
      label={column.label}
      active={active}
      direction={active ? state.sort!.dir : undefined}
      onSort={() => state.sortBy(columnKey)}
      align={align}
      className={className}
    />
  );
}

/** `aria-sort` for a `useTableState` column heading cell. */
export function stateAriaSort<Row>(state: TableState<Row>, columnKey: string) {
  const column = state.columns.find((c) => c.key === columnKey);
  if (!column?.sortValue) return undefined;
  const active = state.sort?.key === columnKey;
  return ariaSort(active, active ? state.sort!.dir : undefined);
}

/** The line under a filtered table with no matches. */
export function NoMatches({
  noun,
  onClear,
  className,
}: {
  noun: string;
  onClear: () => void;
  className?: string;
}) {
  return (
    <div className={cn("p-xl text-center text-sm text-muted-foreground", className)}>
      No {noun} match.{" "}
      <button type="button" onClick={onClear} className="cursor-pointer font-medium text-[#5b2a86]">
        Clear filters
      </button>
    </div>
  );
}
