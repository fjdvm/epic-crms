import { describe, expect, it } from "vitest";

import { filterOptions, filterRows, nextSort, sortRows, type ColumnDef } from "@/lib/table/sort-filter";

interface Row {
  id: number;
  name: string;
  total: number | null;
  at: Date | null;
  status: string;
}

const rows: Row[] = [
  { id: 1, name: "maria", total: 300, at: new Date("2026-11-02"), status: "Paid" },
  { id: 2, name: "Ana", total: null, at: new Date("2026-11-03"), status: "Unpaid" },
  { id: 3, name: "Bea", total: 100, at: null, status: "Paid" },
  { id: 4, name: "ana", total: 100, at: new Date("2026-11-01"), status: "Cancelled" },
];

const columns: ColumnDef<Row>[] = [
  { key: "id", label: "Order", sortValue: (r) => r.id, searchText: (r) => `#${r.id}` },
  { key: "name", label: "Customer", sortValue: (r) => r.name, searchText: (r) => r.name },
  { key: "total", label: "Total", sortValue: (r) => r.total },
  { key: "at", label: "Date", sortValue: (r) => r.at },
  { key: "status", label: "Payment", filter: { label: "Payment", value: (r) => r.status } },
];

const ids = (list: Row[]) => list.map((r) => r.id);

describe("sortRows", () => {
  it("sorts numbers both ways and keeps ties in their original order", () => {
    expect(ids(sortRows(rows, columns, { key: "total", dir: "asc" }))).toEqual([3, 4, 1, 2]);
    expect(ids(sortRows(rows, columns, { key: "total", dir: "desc" }))).toEqual([1, 3, 4, 2]);
  });

  it("puts empty values last whichever the direction", () => {
    expect(ids(sortRows(rows, columns, { key: "at", dir: "asc" }))).toEqual([4, 1, 2, 3]);
    expect(ids(sortRows(rows, columns, { key: "at", dir: "desc" }))).toEqual([2, 1, 4, 3]);
  });

  it("sorts text ignoring case", () => {
    expect(ids(sortRows(rows, columns, { key: "name", dir: "asc" }))).toEqual([2, 4, 3, 1]);
  });

  it("leaves the order alone with no sort, or a column that cannot sort", () => {
    expect(ids(sortRows(rows, columns, null))).toEqual([1, 2, 3, 4]);
    expect(ids(sortRows(rows, columns, { key: "status", dir: "asc" }))).toEqual([1, 2, 3, 4]);
  });
});

describe("filterRows", () => {
  it("searches every searchable column, ignoring case and spaces around it", () => {
    expect(ids(filterRows(rows, columns, { q: "  ANA ", filters: {} }))).toEqual([2, 4]);
    expect(ids(filterRows(rows, columns, { q: "#3", filters: {} }))).toEqual([3]);
  });

  it("keeps every row for a blank search and no filters", () => {
    expect(ids(filterRows(rows, columns, { q: "  ", filters: {} }))).toEqual([1, 2, 3, 4]);
  });

  it("combines the search with each chosen filter", () => {
    expect(ids(filterRows(rows, columns, { q: "", filters: { status: "Paid" } }))).toEqual([1, 3]);
    expect(ids(filterRows(rows, columns, { q: "bea", filters: { status: "Paid" } }))).toEqual([3]);
    expect(ids(filterRows(rows, columns, { q: "ana", filters: { status: "Paid" } }))).toEqual([]);
  });
});

describe("filterOptions", () => {
  it("lists each distinct value A–Z when the column gives no options", () => {
    expect(filterOptions(columns[4], rows).map((o) => o.value)).toEqual(["Cancelled", "Paid", "Unpaid"]);
  });
});

describe("nextSort", () => {
  it("starts a new column descending and flips the same column", () => {
    expect(nextSort(null, "total")).toEqual({ key: "total", dir: "desc" });
    expect(nextSort({ key: "total", dir: "desc" }, "total")).toEqual({ key: "total", dir: "asc" });
    expect(nextSort({ key: "total", dir: "asc" }, "total")).toEqual({ key: "total", dir: "desc" });
    expect(nextSort({ key: "total", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
  });
});
