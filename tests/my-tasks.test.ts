import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { loadMyTasks } from "@/features/customer-profiles/my-tasks";
import { createCustomerTask, markCustomerTaskDone, reopenCustomerTask, reassignCustomerTask } from "@/features/customer-profiles/task-actions";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const actor = vi.hoisted(() => ({ id: "ana", name: "Ana", username: "ana", email: "ana@example.com", role: "Staff" }));
const requireModule = vi.hoisted(() => vi.fn(async (_module: string) => actor));
vi.mock("@/lib/portal/staff", () => ({ requireModule }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: TestDatabase;


beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql`create schema crms`;
  await db.sql.unsafe(readFileSync("docs/db/crms-customer-tasks.sql", "utf8"));
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com'), ('c2', 'Juan', 'juan@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true), ('c2', true)`;
}, 60_000);
afterAll(async () => { vi.useRealTimers(); await db?.close(); });
beforeEach(async () => {
  vi.useRealTimers();
  actor.id = "ana"; actor.role = "Staff"; requireModule.mockClear();
  await db.sql`truncate crms.customer_task_operations, crms.customer_tasks`;
});
function at(time: string) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
}
async function create(customerId = "c1", dueDate = "2026-11-16") {
  const result = await createCustomerTask(customerId, { description: `Follow up ${customerId}`, dueDate }, randomUUID());
  if (!result.ok) throw new Error(result.message);
  return result.task.id;
}
async function data() {
  const result = await loadMyTasks();
  if (!result.ok) throw new Error(result.message);
  return result.data;
}
it.each(["Staff", "CREOMS Manager", "Admin", "CEO"])("returns only the %s viewer's open Tasks, soonest first, with Customer identity", async role => {
  const later = await create("c1", "2026-11-20");
  const first = await create("c2", "2026-11-15");
  const done = await create(); await markCustomerTaskDone("c1", done, randomUUID());
  actor.id = "bea"; await create(); actor.id = "ana"; actor.role = role;
  const result = await data();
  expect(result.tasks.map(task => task.id)).toEqual([first, later]);
  expect(result.tasks[0]).toMatchObject({ customerId: "c2", customerName: "Juan", description: "Follow up c2", dueDate: "2026-11-15" });
  expect(requireModule).toHaveBeenCalledWith("Customer Profiles");
  actor.id = "empty";
  expect(await data()).toEqual({ tasks: [], counts: { dueToday: 0, overdue: 0, doneThisWeek: 0 } });
});
it("counts Due today and Overdue at Manila midnight regardless of database timezone", async () => {
  await create("c1", "2026-11-15"); await create("c2", "2026-11-16"); await create("c1", "2026-11-17");
  const done = await create(); await markCustomerTaskDone("c1", done, randomUUID());
  actor.id = "bea"; await create(); actor.id = "ana";
  await db.sql`set time zone 'America/Los_Angeles'`;
  try {
    at("2026-11-16T15:59:59.999Z");
    expect((await data()).counts).toMatchObject({ dueToday: 1, overdue: 1 });
    expect((await data()).tasks.map(t => t.overdue)).toEqual([true, false, false]);
    at("2026-11-16T16:00:00.000Z");
    expect((await data()).counts).toMatchObject({ dueToday: 1, overdue: 2 });
    expect((await data()).tasks.map(t => t.overdue)).toEqual([true, true, false]);
  } finally { await db.sql`set time zone 'UTC'`; }
});
it("counts current done Tasks by owner in the Monday-to-Monday Manila week, including year rollover", async () => {
  const times = ["2026-12-27T15:59:59.999Z", "2026-12-27T16:00:00Z", "2027-01-03T15:59:59.999Z", "2027-01-03T16:00:00Z"];
  for (const time of times) {
    const id = await create();
    await db.sql`update crms.customer_tasks set done_at = ${time}::timestamptz, done_by_id = 'manager', done_by_name = 'Manager' where id = ${id}`;
  }
  actor.id = "bea";
  const other = await create(); await markCustomerTaskDone("c1", other, randomUUID());
  await db.sql`update crms.customer_tasks set done_at = '2026-12-28T00:00:00Z' where id = ${other}`;
  actor.id = "ana";
  at("2027-01-03T15:59:59.999Z");
  expect((await data()).counts.doneThisWeek).toBe(2);
  at("2027-01-03T16:00:00Z");
  expect((await data()).counts.doneThisWeek).toBe(1);
});
it("done, reopen and reassign actions immediately change the next list and counts", async () => {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const id = await create("c1", today);
  expect((await data()).counts).toEqual({ dueToday: 1, overdue: 0, doneThisWeek: 0 });
  expect(await markCustomerTaskDone("c1", id, randomUUID())).toMatchObject({ ok: true });
  expect(await data()).toEqual({ tasks: [], counts: { dueToday: 0, overdue: 0, doneThisWeek: 1 } });
  expect(await reopenCustomerTask("c1", id, randomUUID())).toMatchObject({ ok: true });
  expect((await data()).tasks.map(t => t.id)).toEqual([id]);
  expect((await data()).counts).toEqual({ dueToday: 1, overdue: 0, doneThisWeek: 0 });
  actor.role = "CREOMS Manager";
  expect(await reassignCustomerTask("c1", id, { id: "bea", name: "Bea" }, randomUUID())).toMatchObject({ ok: true });
  expect((await data()).tasks).toEqual([]);
  actor.id = "bea";
  expect((await data()).tasks.map(t => t.id)).toEqual([id]);
});
it("preserves authorization failures and reports a Task store outage rather than empty work", async () => {
  requireModule.mockRejectedValueOnce(new Error("No access"));
  await expect(loadMyTasks()).rejects.toThrow("No access");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  await db.sql`alter table crms.customer_tasks rename to hidden_tasks`;
  try { expect(await loadMyTasks()).toEqual({ ok: false, message: "Tasks are unavailable right now. Please try again." }); }
  finally { await db.sql`alter table crms.hidden_tasks rename to customer_tasks`; log.mockRestore(); }
});
