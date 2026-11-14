import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { uploadFile } from "@/features/files/client";
import { reply, openNewTicket } from "@/features/tickets/actions";
import { loadTicket } from "@/features/tickets/ticket";
import { ticketFileStorage } from "@/features/files/server";
import { FakeFileStorage } from "./fake-file-storage";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const auth = vi.hoisted(() => ({ requireModule: vi.fn() }));
vi.mock("@/lib/portal/staff", () => auth);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/tickets-db", () => ({ ticketsDatabase: () => db.sql, ticketsWriterDatabase: () => db.sql }));
let db: TestDatabase;
let storage: FakeFileStorage;
let id: number;
beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  auth.requireModule.mockResolvedValue({ username: "ana", name: "Ana", role: "Staff" });
  storage = new FakeFileStorage();
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "caller-key");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "fake-service-secret-for-upload-tests-only");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => storage.handle(new Request(input, init)));
  await db.sql`truncate ticket_messages, tickets, customers, neon_auth."user" restart identity cascade`;
  await db.sql`insert into customers (id, full_name, first_name, email) values ('c1', 'Maria Santos', 'Maria', 'maria@example.com')`;
  await db.sql`insert into neon_auth."user" (id, "emailVerified") values ('c1', true)`;
  const [row] = await db.sql`insert into tickets (customer_id, subject, claimed_by_id, claimed_by_name) values ('c1', 'Evidence', 'ana', 'Ana') returning id`;
  id = row.id;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function attachment(ticketId: number | null = id) {
  const ready = await uploadFile("Tickets", new File(["%PDF-1.7\nevidence"], "evidence.pdf", { type: "application/pdf" }), { ticketId });
  if (!ready.ok) throw new Error(ready.reason);
  const form = new FormData();
  form.set("attachment", ready.reference);
  return form;
}
it("saves a confirmed PDF reference as a Message and signs its view through the Tickets Module", async () => {
  expect(await reply(id, await attachment())).toMatchObject({ ok: true });
  const result = await loadTicket(() => db.sql, id, ticketFileStorage);
  expect(result).toMatchObject({ ok: true, ticket: { messages: [expect.objectContaining({ fileId: "direct-1", attachmentUrl: expect.stringContaining("signature=short-lived") })] } });
  expect(storage.files.get("direct-1")?.link).toBeTypeOf("number");
  expect(auth.requireModule).toHaveBeenCalledWith("Tickets");
});
it("refuses a bare id, another Ticket's reference and another uploader's reference without saving", async () => {
  const bare = new FormData(); bare.set("attachment", "direct-1");
  expect(await reply(id, bare)).toEqual({ ok: false, reason: "invalid-attachment" });
  expect(await reply(id, await attachment(id + 1))).toEqual({ ok: false, reason: "invalid-attachment" });
  const form = await attachment();
  auth.requireModule.mockResolvedValue({ username: "bob", name: "Bob", role: "Staff" });
  expect(await reply(id, form)).toEqual({ ok: false, reason: "invalid-attachment" });
  expect(await db.sql`select * from ticket_messages`).toHaveLength(0);
});
it("keeps an already saved attachment when a later reply loses its Claim", async () => {
  const form = await attachment();
  expect(await reply(id, form)).toMatchObject({ ok: true });
  await db.sql`update tickets set claimed_by_id = 'bob' where id = ${id}`;
  expect(await reply(id, form)).toMatchObject({ ok: false, reason: "claimed" });
  expect(storage.files.has("direct-1")).toBe(true);
});
it("rejects direct Message and new Ticket calls before storage access when the Module is denied", async () => {
  const form = await attachment();
  const calls = storage.calls.length;
  auth.requireModule.mockRejectedValue(new Error("Tickets denied"));
  await expect(reply(id, form)).rejects.toThrow("Tickets denied");
  await expect(openNewTicket(form)).rejects.toThrow("Tickets denied");
  expect(storage.calls).toHaveLength(calls);
  expect(await db.sql`select * from ticket_messages`).toHaveLength(0);
});
it("does not accept a reply upload as the first Message on a new Ticket", async () => {
  expect(await openNewTicket(await attachment())).toEqual({ ok: false, reason: "invalid-attachment" });
});

it("uses a new-Ticket upload as its first Message without uploading the bytes again", async () => {
  const form = await attachment(null);
  form.set("subject", "Evidence"); form.set("customerId", "c1"); form.set("priority", "normal");
  expect(await openNewTicket(form)).toMatchObject({ ok: true });
  expect(await db.sql`select file_id from ticket_messages`).toEqual([{ file_id: "direct-1" }]);
  expect(storage.calls.filter(call => call.method === "PUT")).toHaveLength(1);
});
