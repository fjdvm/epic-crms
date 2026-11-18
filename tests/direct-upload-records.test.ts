import { withRefundDetails } from "./refund-details";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { uploadFile } from "@/features/files/client";
import { deliverOrder } from "@/features/orders/actions";
import { approveReturn, markReturnRefunded } from "@/features/returns/actions";
import { requireModule } from "@/lib/portal/staff";
import { FakeFileStorage } from "./fake-file-storage";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));
let db: TestDatabase;
let storage: FakeFileStorage;
let storefront: FakeStorefront;
let photo: File;
beforeAll(async () => { db = await startTestDatabase(); await db.sql`create schema if not exists crms`; await db.sql.unsafe(readFileSync("docs/db/crms-approvals.sql", "utf8")); }, 60_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.sql`truncate order_returns, orders, customers restart identity cascade`;
  await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
  await db.sql`insert into orders (customer_id, status, payment_method, subtotal_in_centavos) values ('c1', 'dispatched', 'gcash', 10000000)`;
  storage = new FakeFileStorage();
  storefront = new FakeStorefront(db.sql, undefined, storage);
  const send = storefrontFetch(storefront);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith(FAKE_STOREFRONT_URL) ? send(request) : storage.handle(request);
  });
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "caller-key");
  vi.stubEnv("CREOMS_SERVICE_SECRET", FAKE_SERVICE_SECRET);
  vi.stubEnv("CREOMS_STOREFRONT_URL", FAKE_STOREFRONT_URL);
  vi.mocked(requireModule).mockResolvedValue({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "CRMS Manager" });
  photo = new File([new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer())], "photo.png", { type: "image/png" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
async function attachment(module: "Fulfilment" | "Returns", field: string) {
  const ready = await uploadFile(module, photo);
  if (!ready.ok) throw new Error(ready.reason);
  const form = new FormData(); form.set(field, ready.reference);
  return form;
}
it("delivers with a confirmed shared upload and makes it Permanent after confirmation", async () => {
  expect(await deliverOrder(1, await attachment("Fulfilment", "photo"))).toMatchObject({ ok: true });
  expect(storage.files.get("direct-1")).toMatchObject({ visibility: "private", retentionType: "permanent" });
  expect(await db.sql`select delivery_photo_file_id from orders where id = 1`).toEqual([{ delivery_photo_file_id: "direct-1" }]);
});
it("refunds with shared proof, links it and makes it Permanent after confirmation", async () => {
  await db.sql`update orders set status = 'delivered', delivered_at = now() where id = 1`;
  await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000)`;
  await approveReturn(1, false);
  expect(await markReturnRefunded(1, withRefundDetails(await attachment("Returns", "proof")))).toMatchObject({ ok: true });
  expect(storage.files.get("direct-1")).toMatchObject({ visibility: "private", retentionType: "permanent", returnId: 1 });
});
it.each(["Fulfilment", "Returns"] as const)("leaves refused %s evidence Temporary without retrying", async module => {
  const field = module === "Fulfilment" ? "photo" : "proof";
  if (module === "Returns") {
    await db.sql`update orders set status = 'delivered', delivered_at = now() where id = 1`;
    await db.sql`insert into order_returns (order_id, reason, amount_in_centavos) values (1, 'damaged', 10000)`;
    await approveReturn(1, false);
  }
  const form = module === "Returns" ? withRefundDetails(await attachment(module, field)) : await attachment(module, field);
  storefront.refusal = "The record already changed. Refresh it.";
  const requests = storefront.requests;
  const act = module === "Fulfilment" ? deliverOrder : markReturnRefunded;
  expect(await act(1, form)).toEqual({ ok: false, reason: storefront.refusal });
  expect(storefront.requests).toBe(requests + 1);
  expect(storage.files.get("direct-1")?.retentionType).toBe("temporary");
  expect(storage.calls.some(call => call.method === "PATCH")).toBe(false);
});
it("refuses another Module's reference and another Staff member's reference", async () => {
  const proof = await attachment("Returns", "photo");
  expect(await deliverOrder(1, proof)).toMatchObject({ ok: false });
  const delivery = await attachment("Fulfilment", "photo");
  vi.mocked(requireModule).mockResolvedValue({ id: "bob", username: "bob", name: "Bob", email: "bob@example.com", role: "CRMS Manager" });
  expect(await deliverOrder(1, delivery)).toMatchObject({ ok: false });
  expect(storefront.requests).toBe(0);
});
it.each(["Fulfilment", "Returns"] as const)("rechecks %s access after upload and before record access", async module => {
  const form = await attachment(module, module === "Fulfilment" ? "photo" : "proof");
  const calls = storage.calls.length;
  vi.mocked(requireModule).mockRejectedValue(new Error("Module revoked"));
  const action = module === "Fulfilment" ? () => deliverOrder(1, form) : () => markReturnRefunded(1, form);
  await expect(action()).rejects.toThrow("Module revoked");
  expect(storage.calls).toHaveLength(calls);
  expect(storefront.requests).toBe(0);
});
it.each(["Fulfilment", "Returns"] as const)("preserves JPG/PNG and 5 MB refusals for %s", async module => {
  for (const [file, reason] of [
    [new File([], "empty.png", { type: "image/png" }), "empty"],
    [new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }), "over 5 MB"],
    [new File(["%PDF-1.7"], "proof.pdf", { type: "application/pdf" }), "Only JPG or PNG"],
  ] as const) {
    expect(await uploadFile(module, file)).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
  }
  expect(storage.calls).toEqual([]);
});
vi.mock("@/lib/crms-db", () => ({ crmsDatabase: () => db.sql }));

vi.mock("next/server", () => ({ after: (work: () => Promise<void>) => work() }));
