import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { confirmFileUpload, getFileView, requestFileUpload } from "@/features/files/actions";
import { checkQrFile } from "@/features/management/payment-account-qr";
import { listPaymentAccounts, qrFileId, setPaymentAccountQr, type QrFiles } from "@/features/management/payment-accounts";
import { requireModule } from "@/lib/portal/staff";
import { FakeFileStorage } from "./fake-file-storage";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
const asRole = (role: string) => vi.mocked(requireModule).mockResolvedValue({ id: "m", username: "mario", name: "Mario", role } as Awaited<ReturnType<typeof requireModule>>);

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
let storage: FakeFileStorage;
beforeEach(() => {
  asRole("CRMS Manager");
  storage = new FakeFileStorage();
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "caller-key");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "fake-service-secret-for-upload-tests-only");
  vi.stubGlobal("fetch", (i: RequestInfo | URL, init?: RequestInit) => storage.handle(new Request(i, init)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function upload(bytes: Uint8Array, contentType = "image/png") {
  const pending = await requestFileUpload("Management", { filename: "qr.png", contentType: contentType as "image/png", size: bytes.length });
  if (!pending.ok) throw new Error(pending.reason);
  await fetch(pending.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes as BodyInit });
  return confirmFileUpload("Management", pending.reference);
}

describe("QR upload checks", () => {
  it("quick-checks type and size in the browser", () => {
    expect(checkQrFile({ type: "application/pdf", size: 10 })).toMatch(/JPG or PNG/);
    expect(checkQrFile({ type: "image/gif", size: 10 })).toMatch(/JPG or PNG/);
    expect(checkQrFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
    expect(checkQrFile({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
  });
  it("refuses a bad type and an oversize file on the server before creating a File", async () => {
    expect(await requestFileUpload("Management", { filename: "a.pdf", contentType: "application/pdf", size: 10 })).toMatchObject({ ok: false, reason: expect.stringContaining("JPG or PNG") });
    expect(await requestFileUpload("Management", { filename: "a.png", contentType: "image/png", size: 5 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, reason: expect.stringContaining("5 MB") });
    expect(storage.calls).toEqual([]);
  });
  it("refuses wrong bytes under a PNG name and removes the File", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nnot an image");
    expect(await upload(bytes)).toMatchObject({ ok: false, reason: expect.stringContaining("contents") });
    expect(storage.files.size).toBe(0);
  });
  it("stores a real PNG privately and permanently", async () => {
    expect(await upload(PNG)).toMatchObject({ ok: true });
    expect(storage.files.get("direct-1")).toMatchObject({ visibility: "private", retentionType: "permanent" });
  });
  it.each(["Staff/Employee", "Super Admin"])("refuses %s on upload, confirm and view", async (role) => {
    const ready = await upload(PNG);
    if (!ready.ok) throw new Error(ready.reason);
    asRole(role);
    const calls = storage.calls.length;
    expect(await requestFileUpload("Management", { filename: "qr.png", contentType: "image/png", size: 10 })).toMatchObject({ ok: false });
    expect(await confirmFileUpload("Management", ready.reference)).toMatchObject({ ok: false });
    expect(await getFileView("Management", ready.reference)).toMatchObject({ ok: false });
    expect(storage.calls).toHaveLength(calls);
  });
});

describe("setPaymentAccountQr", () => {
  let db: TestDatabase;
  const audit = vi.fn(async () => {});
  const manager = { id: "m", username: "mario", name: "Mario", role: "CRMS Manager" };
  const removed: string[] = [];
  const files: QrFiles = {
    claim: async (ref) => (typeof ref === "string" && ref.startsWith("ref-") ? { fileId: `file-${ref.slice(4)}`, filename: "qr.png" } : null),
    remove: async (id) => { removed.push(id); },
  };
  let id: string;
  beforeAll(async () => {
    db = await startTestDatabase();
    await db.sql`create schema crms`;
    await db.sql.unsafe(readFileSync("docs/db/crms-payment-accounts.sql", "utf8"));
  }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    audit.mockClear(); removed.length = 0;
    await db.sql`truncate crms.payment_accounts`;
    [{ id }] = await db.sql<{ id: string }[]>`insert into crms.payment_accounts (method, label, account_name, account_number, number_normalised, created_by_id, created_by_name) values ('gcash','Main','Bren','09171234567','09171234567','m','Mario') returning id`;
  });

  it("works with no QR", async () => {
    expect((await listPaymentAccounts(db.sql))[0]).toMatchObject({ hasQr: false });
    expect(await qrFileId(db.sql, id)).toBeNull();
  });
  it("sets, replaces and removes the QR, auditing each without any link", async () => {
    expect(await setPaymentAccountQr(db.sql, audit, files, manager, id, "ref-1")).toEqual({ ok: true });
    expect(await qrFileId(db.sql, id)).toBe("file-1");
    expect((await listPaymentAccounts(db.sql))[0].hasQr).toBe(true);
    await setPaymentAccountQr(db.sql, audit, files, manager, id, "ref-2");
    expect(removed).toEqual(["file-1"]);
    await setPaymentAccountQr(db.sql, audit, files, manager, id, null);
    expect(await qrFileId(db.sql, id)).toBeNull();
    expect(removed).toEqual(["file-1", "file-2"]);
    expect(audit).toHaveBeenCalledTimes(3);
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).toContain("payment_account.qr_set");
    expect(logged).toContain("payment_account.qr_removed");
    expect(logged).not.toMatch(/https?:|signature|file-1|file-2/);
  });
  it.each(["Staff/Employee", "Super Admin"])("refuses %s and changes nothing", async (role) => {
    expect(await setPaymentAccountQr(db.sql, audit, files, { ...manager, role }, id, "ref-1")).toMatchObject({ ok: false });
    expect(await qrFileId(db.sql, id)).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });
  it("refuses an invalid reference and a missing account, removing the claimed File", async () => {
    expect(await setPaymentAccountQr(db.sql, audit, files, manager, id, "bad")).toMatchObject({ ok: false });
    expect(await setPaymentAccountQr(db.sql, audit, files, manager, "00000000-0000-0000-0000-000000000000", "ref-9")).toMatchObject({ ok: false });
    expect(removed).toEqual(["file-9"]);
    expect(audit).not.toHaveBeenCalled();
  });
});
