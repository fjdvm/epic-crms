/**
 * Sorting and filtering for tables whose rows are all in memory. Pure, so the same rules apply to every table
 * and are tested once (`tests/table-sort-filter.test.ts`). Tables paged on the server sort and filter in SQL.
 */

export type SortDirection = "asc" | "desc";

export type SortValue = string | number | Date | null | undefined;

export interface FilterOption {
  value: string;
  label: string;
}

export interface ColumnDef<Row> {
  key: string;
  label: string;
  /** Present when the column can be sorted. */
  sortValue?: (row: Row) => SortValue;
  /** Present when the search box looks in this column. */
  searchText?: (row: Row) => string | null | undefined;
  /** Present when the column has a dropdown filter of fixed values. */
  filter?: {
    label: string;
    /** Leave out to list every value the rows have, A–Z. */
    options?: FilterOption[];
    value: (row: Row) => string | null | undefined;
  };
}

export interface SortState {
  key: string;
  dir: SortDirection;
}

export interface FilterState {
  q: string;
  /** Column key → chosen value. A missing key means Any. */
  filters: Record<string, string>;
}

function comparable(value: SortValue): string | number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  return value.toLocaleLowerCase();
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** A stable sort by one column. Empty values always go last, whichever the direction. */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  sort: SortState | null,
): Row[] {
  const column = sort && columns.find((c) => c.key === sort.key);
  if (!sort || !column?.sortValue) return [...rows];

  const read = column.sortValue;
  const sign = sort.dir === "asc" ? 1 : -1;

  return rows
    .map((row, index) => ({ row, index, value: comparable(read(row)) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value === b.value) return a.index - b.index;
        return a.value === null ? 1 : -1;
      }
      const order =
        typeof a.value === "number" && typeof b.value === "number"
          ? a.value - b.value
          : collator.compare(String(a.value), String(b.value));
      return order !== 0 ? sign * order : a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Rows matching the search (any searchable column, ignoring case) and every chosen filter. */
export function filterRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  state: FilterState,
): Row[] {
  const needle = state.q.trim().toLocaleLowerCase();
  const searchable = columns.filter((c) => c.searchText);
  const active = columns.filter(
    (c) => c.filter && state.filters[c.key] !== undefined && state.filters[c.key] !== "",
  );

  return rows.filter((row) => {
    if (
      needle &&
      !searchable.some((c) => (c.searchText!(row) ?? "").toLocaleLowerCase().includes(needle))
    ) {
      return false;
    }
    return active.every((c) => (c.filter!.value(row) ?? "") === state.filters[c.key]);
  });
}

/** A column's dropdown choices: its fixed options, or else every distinct value in the rows, A–Z. */
export function filterOptions<Row>(column: ColumnDef<Row>, rows: readonly Row[]): FilterOption[] {
  if (!column.filter) return [];
  if (column.filter.options) return column.filter.options;

  const seen = new Set<string>();
  for (const row of rows) {
    const value = column.filter.value(row);
    if (value) seen.add(value);
  }
  return [...seen].sort(collator.compare).map((value) => ({ value, label: value }));
}

/** The sort after clicking a column: a new column starts descending, the same column flips. */
export function nextSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
  return { key, dir: "desc" };
}
