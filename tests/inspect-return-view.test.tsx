// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { InspectReturn } from "@/features/returns/inspect-return";

const { refresh, toast } = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/returns/actions", () => ({ inspectReturn: vi.fn(), writeOffReturn: vi.fn() }));
import { inspectReturn, writeOffReturn } from "@/features/returns/actions";

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const items = [
  { orderLineId: 1, product: "Halaya tub", size: "S", quantity: 1, price: 30000 },
  { orderLineId: 2, product: "Ube jar", size: "S", quantity: 1, price: 20000 },
];

it("saves nothing until every item is marked, then waits for the server and shows its refusal", async () => {
  vi.mocked(inspectReturn).mockResolvedValue({ ok: false, reason: "Stock could not be added back." });
  render(<InspectReturn id={7} number="RMA-7" status="goods received" items={items} role="staff" />);
  fireEvent.click(screen.getByRole("button", { name: "Save inspection" }));
  const confirm = screen.getAllByRole("button", { name: "Save inspection" }).at(-1)!;
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByLabelText("Sellable")[0]);
  fireEvent.click(screen.getAllByLabelText("Damaged")[1]);
  expect((confirm as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(confirm);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stock could not be added back."));
  expect(inspectReturn).toHaveBeenCalledWith(7, expect.stringMatching(/^[0-9a-f-]{36}$/), [{ orderLineId: 1, condition: "sellable" }, { orderLineId: 2, condition: "damaged" }]);
  expect(screen.queryByText("Sellable · back in stock")).toBeNull();
});

it("shows the outcome of an inspected Return and offers a Staff write-off request, not the button", () => {
  const inspected = items.map((item, i) => ({ ...item, condition: i ? "damaged" as const : "sellable" as const, inspectionId: "i" }));
  render(<InspectReturn id={7} number="RMA-7" status="goods received" items={inspected} role="staff" />);
  expect(screen.getByText("Sellable · back in stock")).toBeTruthy();
  expect(screen.getByText("Damaged · write-off needed")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Request approval to write off" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Write off damaged items" })).toBeNull();
  expect(writeOffReturn).not.toHaveBeenCalled();
});

it("is view only for Admin and CEO", () => {
  render(<InspectReturn id={7} number="RMA-7" status="goods received" items={items} role="ceo" />);
  expect(screen.queryByRole("button")).toBeNull();
});
