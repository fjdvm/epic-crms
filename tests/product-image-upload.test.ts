import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openUpload } from "@/features/files/reference";
import { storeImageBytes } from "@/features/files/server-upload";
import { uploadProductImage } from "@/features/orders/product-image-upload";
import { requireModule } from "@/lib/portal/staff";
import { FakeFileStorage } from "./fake-file-storage";

vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));

let storage: FakeFileStorage;
const png = async () => new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer());

beforeEach(() => {
  vi.mocked(requireModule).mockResolvedValue({ username: "ana", name: "Ana", role: "Staff" } as Awaited<ReturnType<typeof requireModule>>);
  storage = new FakeFileStorage();
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "caller-key");
  vi.stubEnv("CREOMS_SERVICE_SECRET", "fake-service-secret-for-upload-tests-only");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => storage.handle(new Request(input, init)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("storeImageBytes (product images, uploaded by CREOMS itself)", () => {
  it("checks the bytes, stores them as a public permanent File and gives a ready Orders reference", async () => {
    const bytes = await png();
    const result = await storeImageBytes("Orders", "ana", { filename: "jam.png", contentType: "image/png", bytes });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const upload = openUpload(result.reference)!;
    expect(upload).toMatchObject({ module: "Orders", staffId: "ana", phase: "ready", contentType: "image/png", size: bytes.length });
    expect(storage.files.get(upload.fileId)).toMatchObject({ visibility: "public", retentionType: "permanent", status: "active" });
    // The browser never talks to the bucket: CREOMS sent the bytes to the signed address.
    expect(storage.calls.some((call) => call.method === "PUT" && call.url.startsWith("https://files.test/"))).toBe(true);
  });

  it("refuses a renamed file before anything reaches storage", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 not an image");
    expect(await storeImageBytes("Orders", "ana", { filename: "jam.png", contentType: "image/png", bytes }))
      .toEqual({ ok: false, reason: expect.stringContaining("contents") });
    expect(storage.calls).toHaveLength(0);
  });

  it("refuses a GIF, like the browser upload does", async () => {
    const bytes = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).gif().toBuffer());
    expect((await storeImageBytes("Orders", "ana", { filename: "a.gif", contentType: "image/gif", bytes })).ok).toBe(false);
    expect(storage.calls).toHaveLength(0);
  });

  it("says storage is unavailable, logs the real error and removes the half-made File when confirming fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = storage.handle;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.url.endsWith("/confirm") ? Promise.resolve(new Response(null, { status: 500 })) : handle(request);
    });
    const result = await storeImageBytes("Orders", "ana", { filename: "jam.png", contentType: "image/png", bytes: await png() });
    expect(result).toEqual({ ok: false, reason: "File storage is temporarily unavailable. Please try again." });
    expect(error).toHaveBeenCalledWith("File storage could not store an image for Orders", expect.any(Error));
    expect(storage.files.size).toBe(0);
  });
});

describe("POST /api/orders/product-image", () => {
  const post = async (body: FormData | string) => {
    const { POST } = await import("@/app/api/orders/product-image/route");
    return POST(new Request("https://creoms.test/api/orders/product-image", { method: "POST", body }));
  };

  it("stores the image and answers with its reference", async () => {
    const form = new FormData();
    form.append("file", new File([await png()], "jam.png", { type: "image/png" }));
    const response = await post(form);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(openUpload(body.reference)).toMatchObject({ module: "Orders", phase: "ready" });
  });

  it("refuses a read-only Role without touching storage", async () => {
    vi.mocked(requireModule).mockResolvedValue({ username: "root", name: "Root", role: "Super Admin" } as Awaited<ReturnType<typeof requireModule>>);
    const form = new FormData();
    form.append("file", new File([await png()], "jam.png", { type: "image/png" }));
    const response = await post(form);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, reason: "Your Role can only view shop work." });
    expect(storage.calls).toHaveLength(0);
  });

  it("refuses a request with no image", async () => {
    const response = await post(new FormData());
    expect(response.status).toBe(400);
    expect(storage.calls).toHaveLength(0);
  });
});

describe("uploadProductImage (browser)", () => {
  it("refuses a wrong type before sending anything", async () => {
    const send = vi.fn();
    expect(await uploadProductImage(new File(["x"], "a.gif", { type: "image/gif" }), send)).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the image to CREOMS and passes on its answer", async () => {
    const send = vi.fn(async () => Response.json({ ok: true, reference: "ref-1" }));
    expect(await uploadProductImage(new File(["x"], "jam.png", { type: "image/png" }), send as unknown as typeof fetch)).toEqual({ ok: true, reference: "ref-1" });
    expect(send).toHaveBeenCalledWith("/api/orders/product-image", expect.objectContaining({ method: "POST" }));
    const refused = vi.fn(async () => Response.json({ ok: false, reason: "File storage is temporarily unavailable. Please try again." }, { status: 422 }));
    expect(await uploadProductImage(new File(["x"], "jam.png", { type: "image/png" }), refused as unknown as typeof fetch))
      .toEqual({ ok: false, reason: "File storage is temporarily unavailable. Please try again." });
  });
});
