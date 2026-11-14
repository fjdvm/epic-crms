import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestFileUpload, confirmFileUpload, getFileView } from "@/features/files/actions";
import { uploadFile } from "@/features/files/client";
import { requireModule } from "@/lib/portal/staff";
import sharp from "sharp";
import { FakeFileStorage } from "./fake-file-storage";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn(async () => ({ username: "ana", name: "Ana", role: "Staff" })) }));
let storage: FakeFileStorage;
beforeEach(() => {
  vi.mocked(requireModule).mockResolvedValue({ username: "ana", name: "Ana", role: "Staff" } as Awaited<ReturnType<typeof requireModule>>);
  storage = new FakeFileStorage();
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "caller-key");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "fake-service-secret-for-upload-tests-only");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => storage.handle(new Request(input, init)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.useRealTimers(); });

async function pdfUpload() {
  const bytes = new TextEncoder().encode("%PDF-1.7\nvalid evidence");
  const result = await requestFileUpload("Tickets", { filename: "evidence.pdf", contentType: "application/pdf", size: bytes.length }, { ticketId: 12 });
  if (!result.ok) throw new Error(result.reason);
  await fetch(result.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bytes });
  const ready = await confirmFileUpload("Tickets", result.reference);
  if (!ready.ok) throw new Error(ready.reason);
  return { pending: result, ready };
}

describe("direct-upload server actions", () => {
  it("refuses a renamed file and removes it after checking its real bytes", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\nthis is not an image");
    const pending = await requestFileUpload("Tickets", { filename: "fake.jpg", contentType: "image/jpeg", size: bytes.length });
    if (!pending.ok) throw new Error(pending.reason);
    await fetch(pending.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: bytes });
    expect(await confirmFileUpload("Tickets", pending.reference)).toMatchObject({ ok: false, reason: expect.stringContaining("contents") });
    expect(storage.files.size).toBe(0);
  });

  it.each([
    [{ filename: "empty.pdf", contentType: "application/pdf", size: 0 }, "empty"],
    [{ filename: "large.pdf", contentType: "application/pdf", size: 25 * 1024 * 1024 + 1 }, "25 MB"],
    [{ filename: "script.js", contentType: "text/javascript", size: 100 }, "Choose"],
  ])("refuses invalid metadata before creating a remote File", async (file, reason) => {
    expect(await requestFileUpload("Tickets", file as Parameters<typeof requestFileUpload>[1])).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
    expect(storage.calls).toEqual([]);
  });

  it("returns a clear mismatch when the uploaded size differs from the declaration", async () => {
    const pending = await requestFileUpload("Tickets", { filename: "empty.pdf", contentType: "application/pdf", size: 10 });
    if (!pending.ok) throw new Error(pending.reason);
    await fetch(pending.uploadUrl, { method: "PUT", body: new Uint8Array() });
    expect(await confirmFileUpload("Tickets", pending.reference)).toMatchObject({ ok: false, reason: expect.stringContaining("declared size") });
    expect(storage.files.size).toBe(0);
  });
  it("issues a view only for the authenticated owning Module and a confirmed reference", async () => {
    const { pending, ready } = await pdfUpload();
    expect(await getFileView("Tickets", ready.reference)).toMatchObject({ ok: true, url: expect.stringContaining("signature=short-lived"), contentType: "application/pdf" });
    const requests = storage.calls.length;
    expect(await getFileView("Marketing", ready.reference)).toMatchObject({ ok: false });
    expect(await getFileView("Tickets", pending.reference)).toMatchObject({ ok: false });
    expect(await getFileView("Tickets", "direct-1")).toMatchObject({ ok: false });
    expect(storage.calls).toHaveLength(requests);
  });
  it("lets the browser upload a PDF over 4.5 MB straight to storage, then confirms it", async () => {
    const bytes = new Uint8Array(6 * 1024 * 1024);
    bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
    const ready = await uploadFile("Tickets", new File([bytes], "evidence.pdf", { type: "application/pdf" }), { ticketId: 12 });
    const uploadUrl = storage.calls.find(call => call.method === "PUT")?.url;
    expect(ready).toMatchObject({ ok: true, contentType: "application/pdf", filename: "evidence.pdf", size: bytes.length });
    expect(storage.calls.find(call => call.method === "PUT")).toEqual({ url: uploadUrl, method: "PUT", authorization: null });
    expect(new URL(uploadUrl!).origin).toBe("https://files.test");
    expect(storage.files.get("direct-1")).toMatchObject({ visibility: "private", retentionType: "permanent", status: "active" });
    expect(ready).not.toHaveProperty("fileId");
  });
});

it("checks Module access again on upload, confirmation and every signed view", async () => {
  const { pending, ready } = await pdfUpload();
  const calls = storage.calls.length;
  vi.mocked(requireModule).mockRejectedValue(new Error("Tickets denied"));
  await expect(getFileView("Tickets", ready.reference)).rejects.toThrow("Tickets denied");
  await expect(confirmFileUpload("Tickets", pending.reference)).rejects.toThrow("Tickets denied");
  await expect(requestFileUpload("Tickets", ready)).rejects.toThrow("Tickets denied");
  expect(storage.calls).toHaveLength(calls);
});
it("rejects tampered, expired and another Staff member's confirmation references", async () => {
  const { pending, ready } = await pdfUpload();
  const calls = storage.calls.length;
  expect(await getFileView("Tickets", ready.reference + "x")).toMatchObject({ ok: false });
  vi.mocked(requireModule).mockResolvedValue({ username: "bob", name: "Bob", role: "Staff" } as Awaited<ReturnType<typeof requireModule>>);
  expect(await confirmFileUpload("Tickets", pending.reference)).toMatchObject({ ok: false });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 61 * 60_000);
  expect(await getFileView("Tickets", ready.reference)).toMatchObject({ ok: false });
  expect(storage.calls).toHaveLength(calls);
});
it.each(["jpeg", "png", "gif", "webp"] as const)("confirms real %s image bytes", async format => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).toFormat(format).toBuffer();
  expect(await uploadFile("Tickets", new File([new Uint8Array(bytes)], `image.${format}`, { type: `image/${format}` }))).toMatchObject({ ok: true, contentType: `image/${format}` });
});
it.each([["isom", "video/mp4"], ["qt  ", "video/quicktime"]])("confirms %s video signatures", async (brand, type) => {
  const bytes = Buffer.alloc(32); bytes.writeUInt32BE(24); bytes.write("ftyp", 4); bytes.write(brand, 8); bytes.write(brand, 16); bytes.writeUInt32BE(8, 24); bytes.write("mdat", 28);
  expect(await uploadFile("Tickets", new File([bytes], "video", { type }))).toMatchObject({ ok: true, contentType: type });
});
it("accepts the 25 MB boundary", async () => {
  const bytes = new Uint8Array(25 * 1024 * 1024); bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
  expect(await uploadFile("Tickets", new File([bytes], "limit.pdf", { type: "application/pdf" }))).toMatchObject({ ok: true, size: bytes.length });
});
it("reports cleanup failure without reporting a rejected upload as ready", async () => {
  storage.failRemove = true;
  expect(await uploadFile("Tickets", new File(["%PDF-1.7\nrenamed"], "fake.jpg", { type: "image/jpeg" }))).toMatchObject({ ok: false, cleanupFailed: true });
});
it("bounds the downloaded bytes even when storage metadata claims a smaller file", async () => {
  const pending = await requestFileUpload("Tickets", { filename: "evidence.pdf", contentType: "application/pdf", size: 16 });
  if (!pending.ok) throw new Error(pending.reason);
  await fetch(pending.uploadUrl, { method: "PUT", body: new Uint8Array(16) });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    return request.url.startsWith("https://files.test/direct-") ? Promise.resolve(new Response(new Uint8Array(32))) : storage.handle(request);
  });
  expect(await confirmFileUpload("Tickets", pending.reference)).toMatchObject({ ok: false, reason: expect.stringContaining("declared size") });
  expect(storage.files.size).toBe(0);
});
