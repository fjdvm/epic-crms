// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  StateSortHeader,
  stateAriaSort,
  TableToolbar,
  useTableState,
} from "@/components/shared/table-controls/use-table-state";
import type { ColumnDef } from "@/lib/table/sort-filter";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/x",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(cleanup);

interface Row { id: number; name: string; total: number; status: string }

const ROWS: Row[] = [
  { id: 1, name: "Maria", total: 300, status: "Paid" },
  { id: 2, name: "Ana", total: 100, status: "Unpaid" },
  { id: 3, name: "Bea", total: 200, status: "Paid" },
];

const COLUMNS: ColumnDef<Row>[] = [
  { key: "name", label: "Customer", sortValue: (r) => r.name, searchText: (r) => r.name },
  { key: "total", label: "Total", sortValue: (r) => r.total },
  { key: "status", label: "Payment", filter: { label: "Payment", value: (r) => r.status } },
];

function Table() {
  const table = useTableState(ROWS, COLUMNS);
  return (
    <>
      <TableToolbar state={table} label="Search and filter" searchLabel="Search" placeholder="Search" />
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th key={c.key} aria-sort={stateAriaSort(table, c.key)}>
                <StateSortHeader state={table} columnKey={c.key} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.id} data-row>
              <td>{r.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const names = () => Array.from(document.querySelectorAll("[data-row]")).map((r) => r.textContent);

describe("a table held in memory", () => {
  it("keeps the order it was given until a heading is clicked, then sorts descending and flips", () => {
    render(<Table />);
    expect(names()).toEqual(["Maria", "Ana", "Bea"]);
    const total = screen.getByRole("button", { name: "Sort by Total" });
    expect(total.closest("th")?.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(total);
    expect(names()).toEqual(["Maria", "Bea", "Ana"]);
    const sorted = screen.getByRole("button", { name: "Total, sorted descending" });
    expect(sorted.closest("th")?.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(sorted);
    expect(names()).toEqual(["Ana", "Bea", "Maria"]);
    expect(screen.getByRole("button", { name: "Total, sorted ascending" })).toBeTruthy();
  });

  it("shows a column that cannot sort as plain text", () => {
    render(<Table />);
    expect(screen.queryByRole("button", { name: /Payment/ })).toBeNull();
  });

  it("searches as it is typed, and Clear filters brings every row back", () => {
    render(<Table />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "an" } });
    expect(names()).toEqual(["Ana"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Maria", "Ana", "Bea"]);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });

  it("offers a dropdown filter for a column with fixed values", () => {
    render(<Table />);
    expect(screen.getByRole("combobox", { name: "Payment" })).toBeTruthy();
  });
});
