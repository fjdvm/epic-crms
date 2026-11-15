import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createCustomerTask, markCustomerTaskDone, reopenCustomerTask, changeCustomerTaskDueDate, reassignCustomerTask } from "@/features/customer-profiles/task-actions";
import { loadCustomerProfile } from "@/features/customer-profiles/profile";
import { readCustomerTasks } from "@/features/customer-profiles/tasks";
import { startTestDatabase, type TestDatabase } from "./ticket-database";
const actor = vi.hoisted(() => ({ id: "ana", name: "Ana", username: "ana", email: "ana@example.com", role: "Staff" }));
const audit = vi.hoisted(() => vi.fn<import("@/lib/audit-trail").AuditTrail>(async () => {}));
const recipients = vi.hoisted(() => vi.fn(async (): Promise<{ id: string; name?: string; role: string; modules: string[] }[]> => [
  { id: "ana", name: "Ana", role: "Staff", modules: ["Customer Profiles"] },
  { id: "bea", name: "Bea", role: "Staff", modules: ["Customer Profiles"] },
]));
vi.mock("@/features/notifications/portal-gateway", () => ({ portalGateway: () => ({ recipients }) }));
const requireModule = vi.hoisted(() => vi.fn<(module: string) => Promise<typeof actor>>(async () => actor));
vi.mock("@/lib/portal/staff", () => ({ requireModule }));
vi.mock("@/lib/gateway", () => ({ gatewayAuditTrail: audit, deliverGatewayAuditEvent: audit }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
let db: TestDatabase;
const input = { description: "Check replacement arrived sealed", dueDate: "2026-11-16" };
const create = (extra = {}) => createCustomerTask("c1", { ...input, ...extra }, randomUUID());
async function task() { const result = await create(); if (!result.ok) throw new Error(JSON.stringify(result)); return result.task.id; }
beforeAll(async () => {
  db = await startTestDatabase();
  await db.sql.unsafe(`alter table customers add column middle_name text, add column last_name text not null default '', add column contact_number text not null default '';
    create table addresses (id integer primary key, customer_id text, label text, street text, barangay text, city text, province text, postal_code text, country text, is_default boolean);
    create table products (slug text primary key, name text);
    create table sizes (id integer primary key, product_slug text, label text, price_in_centavos integer);
    create table cart_lines (id integer primary key, customer_id text, size_id integer, quantity integer);`);
  await db.sql`create schema crms`;
  const schema = readFileSync("docs/db/crms-schema.sql", "utf8");
  for (const statement of schema.replace(/^--.*$/gm, "").split(";").filter(s => /CREATE TABLE crms.walk_in_customers/.test(s))) await db.sql.unsafe(statement);
  await db.sql.unsafe(readFileSync("docs/db/crms-announcements.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-customer-tasks.sql", "utf8"));
  await db.sql.unsafe(readFileSync("docs/db/crms-customer-tasks.sql", "utf8"));
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com'), ('lead', 'Lead', 'lead@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true), ('lead', false)`;
}, 60_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { actor.id = "ana"; actor.role = "Staff"; audit.mockClear(); requireModule.mockClear(); await db.sql`truncate crms.customer_task_operations, crms.customer_tasks`; });
it("creates with the creator as owner and records the Customer and actor once on concurrent retry", async () => {
  const op = randomUUID();
  const results = await Promise.all([createCustomerTask("c1", input, op), createCustomerTask("c1", input, op)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({ ok: true, task: { description: input.description, ownerId: "ana", ownerName: "Ana", dueDate: input.dueDate, doneAt: null } });
  expect(await readCustomerTasks(db.sql, "c1")).toHaveLength(1);
  expect(audit).toHaveBeenCalledTimes(1);
  expect(audit.mock.calls[0][0]).toMatchObject({ action: "customer_task.created", actor: { id: "ana", display_name: "Ana" }, target: { type: "customer_profile", id: "c1", display_name: "Maria" } });
  expect(requireModule).toHaveBeenCalledWith("Customer Profiles");
});
it("owner can finish, reopen and change due date; replay cannot undo a later change", async () => {
  const id = await task(); const doneOp = randomUUID();
  const done = await markCustomerTaskDone("c1", id, doneOp);
  expect(done).toMatchObject({ ok: true, task: { doneById: "ana", doneByName: "Ana", doneAt: expect.any(String) } });
  expect(await reopenCustomerTask("c1", id, randomUUID())).toMatchObject({ ok: true, task: { doneAt: null, doneById: null } });
  expect(await markCustomerTaskDone("c1", id, doneOp)).toEqual(done);
  expect((await readCustomerTasks(db.sql, "c1"))[0].doneAt).toBeNull();
  expect(await changeCustomerTaskDueDate("c1", id, "2026-11-20", randomUUID())).toMatchObject({ ok: true, task: { dueDate: "2026-11-20" } });
  expect(audit).toHaveBeenCalledTimes(4);
  expect(audit.mock.calls[3][0]).toMatchObject({ metadata: { taskId: id, oldDueDate: "2026-11-16", newDueDate: "2026-11-20" } });
});
it("only Manager assigns or reassigns and may change another owner's Task", async () => {
  expect(await create({ owner: { id: "bea", name: "Bea" } })).toMatchObject({ ok: false, message: expect.stringMatching(/Manager/) });
  const id = await task();
  expect(await reassignCustomerTask("c1", id, { id: "bea", name: "Bea" }, randomUUID())).toMatchObject({ ok: false, message: expect.stringMatching(/Manager/) });
  actor.id = "bea";
  for (const result of [await markCustomerTaskDone("c1", id, randomUUID()), await reopenCustomerTask("c1", id, randomUUID()), await changeCustomerTaskDueDate("c1", id, "2026-11-20", randomUUID())]) expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/owner|Manager/) });
  actor.role = "CREOMS Manager";
  expect(await reassignCustomerTask("c1", id, { id: "bea", name: "Bea" }, randomUUID())).toMatchObject({ ok: true, task: { ownerId: "bea", ownerName: "Bea" } });
  expect(audit.mock.calls.at(-1)?.[0]).toMatchObject({ metadata: { oldOwner: { id: "ana", name: "Ana" }, newOwner: { id: "bea", name: "Bea" } } });
  actor.id = "manager";
  expect(await markCustomerTaskDone("c1", id, randomUUID())).toMatchObject({ ok: true });
  expect(await reopenCustomerTask("c1", id, randomUUID())).toMatchObject({ ok: true });
  expect(await changeCustomerTaskDueDate("c1", id, "2026-11-25", randomUUID())).toMatchObject({ ok: true });
  expect(await create({ owner: { id: "ana", name: "Ana" } })).toMatchObject({ ok: true, task: { ownerId: "ana" } });
});
it.each(["Admin", "CEO", "Unknown"])("refuses every %s write with a plain reason", async role => {
  const id = await task(); audit.mockClear(); actor.role = role;
  const results = [await create(), await markCustomerTaskDone("c1", id, randomUUID()), await reopenCustomerTask("c1", id, randomUUID()), await changeCustomerTaskDueDate("c1", id, "2026-11-20", randomUUID()), await reassignCustomerTask("c1", id, { id: "bea", name: "Bea" }, randomUUID())];
  for (const result of results) expect(result).toMatchObject({ ok: false, message: "Your Role can only view shop work." });
  expect(audit).not.toHaveBeenCalled();
});
it.each([{ description: " " }, { description: "a".repeat(201) }, { dueDate: "" }, { dueDate: "2026-02-30" }, { dueDate: "2026-11-16T00:00:00Z" }])("rejects invalid input %j", async invalid => {
  expect(await create(invalid)).toMatchObject({ ok: false, message: expect.any(String) }); expect(audit).not.toHaveBeenCalled();
});
it("rejects missing dates, nonexistent Customers, Leads, mismatched Customers and reused operation ids", async () => {
  expect(await create({ dueDate: undefined })).toMatchObject({ ok: false });
  for (const customer of ["missing", "lead"]) expect(await createCustomerTask(customer, input, randomUUID())).toMatchObject({ ok: false, message: expect.any(String) });
  const op = randomUUID(); const saved = await createCustomerTask("c1", input, op); if (!saved.ok) throw new Error("create failed");
  expect(await createCustomerTask("c1", { ...input, description: "Different" }, op)).toMatchObject({ ok: false });
  expect(await markCustomerTaskDone("lead", saved.task.id, randomUUID())).toMatchObject({ ok: false });
  expect(await changeCustomerTaskDueDate("c1", saved.task.id, "bad", randomUUID())).toMatchObject({ ok: false });
});
it("reads open first, excludes other Customers, and changes overdue precisely at Philippine midnight", async () => {
  const done = await task(); await markCustomerTaskDone("c1", done, randomUUID());
  const open = await task();
  const before = await readCustomerTasks(db.sql, "c1", new Date("2026-11-16T15:59:59Z"));
  expect(before.map(t => [t.id, t.overdue])).toEqual([[open, false], [done, false]]);
  const after = await readCustomerTasks(db.sql, "c1", new Date("2026-11-16T16:00:00Z"));
  expect(after.map(t => [t.id, t.overdue])).toEqual([[open, true], [done, false]]);
  expect(await readCustomerTasks(db.sql, "other")).toEqual([]);
});

it("Profile read includes Tasks for every viewing Role and keeps the Profile available during a Task store outage", async () => {
  await task();
  await db.sql`insert into orders (customer_id) values ('c1')`;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    for (const role of ["Staff", "CREOMS Manager", "Admin", "CEO"]) {
      actor.role = role;
      expect(await loadCustomerProfile(() => db.sql, "c1", () => db.sql)).toMatchObject({ ok: true, profile: { tasks: [expect.objectContaining({ ownerId: "ana", description: input.description })] } });
    }
    await db.sql`alter table crms.customer_tasks rename to hidden_tasks`;
    try {
      expect(await loadCustomerProfile(() => db.sql, "c1", () => db.sql)).toMatchObject({ ok: true, profile: { tasks: null } });
    } finally { await db.sql`alter table crms.hidden_tasks rename to customer_tasks`; }
  } finally { log.mockRestore(); }
});
it("retries each mutation once, preserving old and new audit values and the fixed description", async () => {
  const id = await task(); actor.role = "CREOMS Manager"; audit.mockClear();
  const operations = [
    (op: string) => markCustomerTaskDone("c1", id, op),
    (op: string) => reopenCustomerTask("c1", id, op),
    (op: string) => changeCustomerTaskDueDate("c1", id, "2026-12-01", op),
    (op: string) => reassignCustomerTask("c1", id, { id: "bea", name: "Bea" }, op),
  ];
  for (const action of operations) {
    const op = randomUUID(); const first = await action(op);
    expect(first).toMatchObject({ ok: true }); expect(await action(op)).toEqual(first);
  }
  expect(audit).toHaveBeenCalledTimes(4);
  expect((await readCustomerTasks(db.sql, "c1"))[0]).toMatchObject({ description: input.description, dueDate: "2026-12-01", ownerId: "bea", doneAt: null });
});
it("keeps the saved Task and its receipt when the audit adapter throws, retrying delivery without another change", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const op = randomUUID(); audit.mockRejectedValueOnce(new Error("offline"));
  try {
    const saved = await createCustomerTask("c1", input, op);
    expect(saved).toMatchObject({ ok: true });
    expect(await createCustomerTask("c1", input, op)).toEqual(saved);
    expect(await readCustomerTasks(db.sql, "c1")).toHaveLength(1);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit.mock.calls[0][0]).toEqual(audit.mock.calls[1][0]);
  } finally { log.mockRestore(); }
});
it("retains pending audit after the real gateway refuses delivery and retries the same event", async () => {
  const gateway = await vi.importActual<typeof import("@/lib/gateway")>("@/lib/gateway");
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 201 }));
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test"); vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "test-key"); vi.stubGlobal("fetch", fetch);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  audit.mockImplementation(gateway.deliverGatewayAuditEvent);
  try {
    const op = randomUUID(); const saved = await createCustomerTask("c1", input, op);
    expect(saved).toMatchObject({ ok: true });
    expect(await createCustomerTask("c1", input, op)).toEqual(saved);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).idempotency_key).toBe(JSON.parse(fetch.mock.calls[1][1].body).idempotency_key);
    expect(await readCustomerTasks(db.sql, "c1")).toHaveLength(1);
  } finally { audit.mockImplementation(async () => {}); log.mockRestore(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

it("resolves canonical owner names and refuses nonexistent, read-only or ungranted owners", async () => {
  actor.role = "CREOMS Manager";
  for (const person of [undefined, { id: "other", name: "Other", role: "Admin", modules: ["Customer Profiles"] }, { id: "other", name: "Other", role: "CEO", modules: ["Customer Profiles"] }, { id: "other", name: "Other", role: "Staff", modules: [] }]) {
    recipients.mockResolvedValueOnce(person ? [person] : []);
    expect(await create({ owner: { id: "other", name: "Forged" } })).toMatchObject({ ok: false, message: expect.any(String) });
  }
  const saved = await create({ owner: { id: "bea", name: "Forged" } });
  expect(saved).toMatchObject({ ok: true, task: { ownerId: "bea", ownerName: "Bea" } });
  if (!saved.ok) throw new Error("create failed");
  recipients.mockResolvedValueOnce([]);
  expect(await reassignCustomerTask("c1", saved.task.id, { id: "missing", name: "Forged" }, randomUUID())).toMatchObject({ ok: false, message: expect.any(String) });
});
