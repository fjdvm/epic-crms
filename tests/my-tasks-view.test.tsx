// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MyTasksSkeleton, MyTasksView } from "@/features/customer-profiles/my-tasks-view";
import type { MyTasks } from "@/features/customer-profiles/my-tasks";
import type { TaskResult } from "@/features/customer-profiles/task-actions";

const markDone = vi.fn();
vi.mock("@/features/customer-profiles/task-actions", () => ({ markCustomerTaskDone: (...args: unknown[]) => markDone(...args) }));

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-16T04:00:00Z")); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

const data: MyTasks = {
  tasks: [
    { id: "t1", description: "Call about the late order", customerId: "c1", customerName: "Maria Santos", dueDate: "2026-11-15", overdue: true },
    { id: "t2", description: "Check the replacement arrived sealed", customerId: "c2", customerName: "Juan Cruz", dueDate: "2026-11-16", overdue: false },
    { id: "t3", description: "Offer bulk price", customerId: "c3", customerName: "Grace Lim", dueDate: "2026-11-17", overdue: false },
  ],
  counts: { dueToday: 1, overdue: 1, doneThisWeek: 5 },
};
function count(label: string) { return screen.getAllByText(label)[0].parentElement!.querySelector("p:last-child")!.textContent; }

it("shows the table and counts from the read, linking each Customer Profile", () => {
  render(<MyTasksView data={data} canMarkDone />);
  const rows = within(screen.getByRole("list", { name: "Open tasks" })).getAllByRole("listitem");
  expect(rows.map(row => row.textContent)).toEqual([
    expect.stringContaining("Call about the late orderMaria SantosOverdue"),
    expect.stringContaining("Check the replacement arrived sealedJuan CruzToday"),
    expect.stringContaining("Offer bulk priceGrace LimTomorrow"),
  ]);
  expect(screen.getByRole("link", { name: "Maria Santos" }).getAttribute("href")).toBe("/customer-profiles/c1");
  expect([count("Due today"), count("Overdue"), count("Done this week")]).toEqual(["1", "1", "5"]);
});

it("confirms first, then removes the Task and moves the counts at once", async () => {
  let finish!: (result: TaskResult) => void;
  markDone.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MyTasksView data={data} canMarkDone />);
  fireEvent.click(within(screen.getByText("Check the replacement arrived sealed").closest("li")!).getByRole("button", { name: "Mark done" }));
  expect(markDone).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark done" }));
  expect(markDone).toHaveBeenCalledWith("c2", "t2", expect.any(String));
  expect(screen.queryByText("Check the replacement arrived sealed")).toBeNull();
  expect([count("Due today"), count("Overdue"), count("Done this week")]).toEqual(["0", "1", "6"]);
  await act(async () => finish({ ok: true, task: {} as never }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(count("Done this week")).toBe("6");
});

it("rolls the Task and counts back with the plain reason when refused", async () => {
  markDone.mockResolvedValue({ ok: false, message: "Only the owner or a Manager can do this." });
  render(<MyTasksView data={data} canMarkDone />);
  fireEvent.click(within(screen.getByText("Call about the late order").closest("li")!).getByRole("button", { name: "Mark done" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark done" })));
  expect(screen.getByText("Call about the late order")).toBeTruthy();
  expect([count("Overdue"), count("Done this week")]).toEqual(["1", "5"]);
  expect(screen.getByRole("alert").textContent).toContain("Only the owner or a Manager can do this.");
});

it("rolls back with a reason when the server cannot be reached", async () => {
  markDone.mockRejectedValue(new Error("offline"));
  render(<MyTasksView data={data} canMarkDone />);
  fireEvent.click(within(screen.getByText("Offer bulk price").closest("li")!).getByRole("button", { name: "Mark done" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark done" })));
  expect(screen.getByText("Offer bulk price")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("could not reach the server");
});

it("does not mark anything done when the confirm dialog is cancelled", () => {
  render(<MyTasksView data={data} canMarkDone />);
  fireEvent.click(screen.getAllByRole("button", { name: "Mark done" })[0]);
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
  expect(markDone).not.toHaveBeenCalled();
  expect(screen.getByText("Call about the late order")).toBeTruthy();
});

it("hides Mark done for a read-only Role", () => {
  render(<MyTasksView data={data} canMarkDone={false} />);
  expect(screen.getByText("Call about the late order")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
});

it("shows a friendly empty state with zero counts", () => {
  render(<MyTasksView data={{ tasks: [], counts: { dueToday: 0, overdue: 0, doneThisWeek: 3 } }} canMarkDone />);
  expect(screen.getByText("You're all caught up")).toBeTruthy();
  expect(count("Done this week")).toBe("3");
});

it("shows the empty state after the last Task is marked done", async () => {
  markDone.mockResolvedValue({ ok: true, task: {} });
  render(<MyTasksView data={{ ...data, tasks: [data.tasks[2]], counts: { dueToday: 0, overdue: 0, doneThisWeek: 0 } }} canMarkDone />);
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await act(async () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Mark done" })));
  expect(screen.getByText("You're all caught up")).toBeTruthy();
});

it("has an immediate loading state", () => {
  render(<MyTasksSkeleton />);
  expect(screen.getByRole("status", { name: "Loading My tasks" })).toBeTruthy();
});
