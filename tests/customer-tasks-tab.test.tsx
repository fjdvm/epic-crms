// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { TasksTab, type TaskViewer, type VisibleCustomerTask } from "@/features/customer-profiles/tasks-tab";
import { ActivityTimeline } from "@/features/customer-profiles/activity-timeline";
import type { CustomerTask } from "@/features/customer-profiles/tasks";

const actions = vi.hoisted(() => ({ create: vi.fn(), done: vi.fn(), reopen: vi.fn(), due: vi.fn(), reassign: vi.fn(), owners: vi.fn() }));
vi.mock("@/features/customer-profiles/task-actions", () => ({
  createCustomerTask: actions.create, markCustomerTaskDone: actions.done, reopenCustomerTask: actions.reopen,
  changeCustomerTaskDueDate: actions.due, reassignCustomerTask: actions.reassign, listTaskOwners: actions.owners,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const NOW = new Date("2026-11-16T04:00:00Z"); // 12:00 Philippine Time, 16 Nov
const task = (o: Partial<CustomerTask> = {}): CustomerTask => ({
  id: "11111111-1111-1111-1111-111111111111", customerId: "c1", description: "Call back", dueDate: "2026-11-20",
  ownerId: "staff-1", ownerName: "Rhea", createdAt: "2026-11-10T00:00:00Z", createdById: "staff-1", createdByName: "Rhea",
  doneAt: null, doneById: null, doneByName: null, overdue: false, ...o,
});
const staff: TaskViewer = { id: "staff-1", name: "Rhea", role: "staff" };
const manager: TaskViewer = { id: "mgr-1", name: "Mia", role: "manager" };
function View({ initial, viewer = staff }: { initial?: CustomerTask[] | null; viewer?: TaskViewer }) {
  const [tasks, setTasks] = useState<VisibleCustomerTask[] | null | undefined>(initial);
  return <TasksTab customerId="c1" tasks={tasks} viewer={viewer} now={NOW}
    onTaskChange={(id, next) => setTasks(old => old ? [...old.filter(t => t.id !== id), ...(next ? [next] : [])] : old)} />;
}
const confirmDialog = (name: string) => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name }));

it("shows a loading state, an empty state, and the unavailable state", () => {
  const { rerender } = render(<TasksTab customerId="c1" tasks={undefined} viewer={staff} onTaskChange={() => {}} />);
  expect(screen.getByRole("status", { name: "Loading Tasks" })).toBeTruthy();
  rerender(<TasksTab customerId="c1" tasks={[]} viewer={staff} onTaskChange={() => {}} />);
  expect(screen.getByText("No open Tasks")).toBeTruthy();
  rerender(<TasksTab customerId="c1" tasks={null} viewer={staff} onTaskChange={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain("Tasks are unavailable");
});

it("lists open Tasks before done Tasks and marks overdue ones", () => {
  render(<View initial={[
    task({ id: "a", description: "Finished", doneAt: "2026-11-12T00:00:00Z", doneByName: "Rhea", dueDate: "2026-11-01" }),
    task({ id: "b", description: "Late one", dueDate: "2026-11-10" }),
    task({ id: "c", description: "Later one", dueDate: "2026-11-30" }),
  ]} />);
  const rows = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
  expect(rows.map(r => r.textContent)).toEqual([expect.stringContaining("Late one"), expect.stringContaining("Later one"), expect.stringContaining("Finished")]);
  expect(rows[0].getAttribute("data-overdue")).toBe("true");
  expect(rows[0].textContent).toContain("Overdue");
  expect(rows[1].getAttribute("data-overdue")).toBeNull();
  expect(rows[2].getAttribute("data-overdue")).toBeNull();
});

it("confirms before adding, shows the Task at once, and rolls back with the refusal", async () => {
  let finish!: (r: unknown) => void;
  actions.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<View initial={[]} />);
  fireEvent.change(screen.getByLabelText("Task description"), { target: { value: "Check sealed" } });
  fireEvent.change(screen.getByLabelText("Task due date"), { target: { value: "2026-11-25" } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(actions.create).not.toHaveBeenCalled();
  confirmDialog("Add Task");
  expect(actions.create).toHaveBeenCalledWith("c1", { description: "Check sealed", dueDate: "2026-11-25" }, expect.any(String));
  expect(within(screen.getByRole("list", { name: "Tasks" })).getByText("Check sealed")).toBeTruthy();
  expect(screen.getByText(/saving…/)).toBeTruthy();
  await act(async () => finish({ ok: false, message: "Your Role can only view shop work." }));
  expect(screen.queryByRole("list", { name: "Tasks" })).toBeNull();
  expect(screen.getByText("No open Tasks")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Your Role can only view shop work.");
  expect((screen.getByLabelText("Task description") as HTMLInputElement).value).toBe("Check sealed");
});

it("requires a description and a due date before asking to confirm", () => {
  render(<View initial={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(screen.getByRole("alert").textContent).toContain("Write a Task description");
  fireEvent.change(screen.getByLabelText("Task description"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(screen.getByRole("alert").textContent).toContain("Choose a due date");
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("marks done after confirming, optimistically, and rolls back with the reason", async () => {
  let finish!: (r: unknown) => void;
  actions.done.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<View initial={[task()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  expect(actions.done).not.toHaveBeenCalled();
  confirmDialog("Mark done");
  expect(screen.getByText(/Done by Rhea/)).toBeTruthy();
  await act(async () => finish({ ok: false, message: "Only the Task owner or a Manager can change this Task." }));
  expect(screen.queryByText(/Done by/)).toBeNull();
  expect(screen.getByRole("button", { name: "Mark done" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Only the Task owner");
});

it("reopens a done Task and rolls back when refused", async () => {
  actions.reopen.mockResolvedValue({ ok: false, message: "Tasks are unavailable right now. Please try again." });
  render(<View initial={[task({ doneAt: "2026-11-12T00:00:00Z", doneByName: "Rhea", doneById: "staff-1" })]} />);
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await act(async () => confirmDialog("Reopen"));
  expect(actions.reopen).toHaveBeenCalledWith("c1", expect.any(String), expect.any(String));
  expect(screen.getByText(/Done by Rhea/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Tasks are unavailable");
});

it("changes the due date after confirming and rolls back on a thrown request", async () => {
  actions.due.mockRejectedValue(new Error("offline"));
  render(<View initial={[task()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Change due date" }));
  fireEvent.change(screen.getByLabelText("New due date"), { target: { value: "2026-11-01" } });
  await act(async () => confirmDialog("Change due date"));
  expect(actions.due).toHaveBeenCalledWith("c1", expect.any(String), "2026-11-01", expect.any(String));
  expect(screen.getByText(/Due Nov 20, 2026/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("unavailable");
});

it("flags a Task overdue as soon as its due date moves into the past", async () => {
  let finish!: (r: unknown) => void;
  actions.due.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<View initial={[task()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Change due date" }));
  fireEvent.change(screen.getByLabelText("New due date"), { target: { value: "2026-11-01" } });
  confirmDialog("Change due date");
  expect(screen.getByRole("listitem").getAttribute("data-overdue")).toBe("true");
  await act(async () => finish({ ok: true, task: task({ dueDate: "2026-11-01", overdue: true }) }));
  expect(screen.getByRole("listitem").getAttribute("data-overdue")).toBe("true");
});

it("lets a Manager reassign after confirming, and Staff only see Request approval", async () => {
  actions.owners.mockResolvedValue({ ok: true, owners: [{ id: "staff-2", name: "Ana" }] });
  actions.reassign.mockResolvedValue({ ok: false, message: "Choose an active Staff member or Manager with Customer Profiles access." });
  render(<View initial={[task()]} viewer={manager} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reassign" })); });
  fireEvent.change(screen.getByLabelText("New owner"), { target: { value: "staff-2" } });
  expect(actions.reassign).not.toHaveBeenCalled();
  await act(async () => confirmDialog("Reassign"));
  expect(actions.reassign).toHaveBeenCalledWith("c1", expect.any(String), { id: "staff-2", name: "Ana" }, expect.any(String));
  expect(screen.getByText(/Rhea/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Choose an active Staff member");
  cleanup();
  render(<View initial={[task()]} />);
  expect(screen.queryByRole("button", { name: "Reassign" })).toBeNull();
  expect(screen.getByRole("button", { name: "Request approval" })).toBeTruthy();
});

it("hides every control for Admin and CEO", () => {
  render(<TasksTab customerId="c1" tasks={[task()]} now={NOW} onTaskChange={() => {}} />);
  expect(screen.getByText("Call back")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByLabelText("Task description")).toBeNull();
});

it("shows Task created and done in the timeline with the Staff member's name", () => {
  render(<ActivityTimeline orders={[]} tasks={[task({ doneAt: "2026-11-12T00:00:00Z", doneByName: "Ana" })]} onOpenOrder={() => {}} />);
  expect(screen.getByText("Rhea created a Task")).toBeTruthy();
  expect(screen.getByText("Ana marked a Task done")).toBeTruthy();
});
