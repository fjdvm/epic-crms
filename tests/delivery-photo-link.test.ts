import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { importDeliveryPhotoLink } from "@/features/files/actions";
import {
  downloadLinkImage, isPublicAddress, publicLookup, LINK_IMAGE_REASON, LINK_INVALID_REASON, LINK_TOO_LARGE_REASON, LINK_UNREACHABLE_REASON,
  type LinkFetcher, type LinkResponse,
} from "@/features/files/link-download";
import { deliverOrder } from "@/features/orders/actions";
import { requireModule } from "@/lib/portal/staff";
import { FakeFileStorage, PDF } from "./fake-file-storage";
import { FakeStorefront, FAKE_SERVICE_SECRET, FAKE_STOREFRONT_URL, storefrontFetch } from "./fake-storefront";
import { startTestDatabase, type TestDatabase } from "./ticket-database";

const link = vi.hoisted(() => ({ fetcher: null as null | ((url: URL) => Promise<unknown>) }));
vi.mock("@/features/files/link-download", async original => {
  const actual = await original<typeof import("@/features/files/link-download")>();
  return { ...actual, downloadLinkImage: (url: string, fetcher?: LinkFetcher) => actual.downloadLinkImage(url, fetcher ?? link.fetcher as LinkFetcher) };
});
vi.mock("@/lib/portal/staff", () => ({ requireModule: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ database: () => db.sql }));

let db: TestDatabase;
let png: Uint8Array;

function reply(status: number, body: Uint8Array = new Uint8Array(), location: string | null = null): LinkResponse {
  return { status, location, cancel: vi.fn(), body: (async function* () { if (body.length) yield body; })() };
}
/** A fake courier host: each URL answers with what the test maps it to. */
function host(routes: Record<string, () => LinkResponse>): LinkFetcher & { seen: string[] } {
  const seen: string[] = [];
  return Object.assign(async (url: URL) => {
    seen.push(url.toString());
    const route = routes[url.toString()];
    if (!route) throw new Error("connection refused");
    return route();
  }, { seen });
}

beforeAll(async () => {
  png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer());
});

describe("the courier image link download", () => {
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1", "not-an-ip"])(
    "refuses the non-public address %s", address => expect(isPublicAddress(address)).toBe(false));

  it.each(["8.8.8.8", "203.84.1.10", "2606:4700::1111"])("allows the public address %s", address => expect(isPublicAddress(address)).toBe(true));

  it("refuses a host when any resolved address is private, so the socket never connects there", async () => {
    const lookup = publicLookup((_host, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]));
    const error = await new Promise(resolve => lookup("evil.test", {}, error => resolve(error)));
    expect(error).toMatchObject({ code: "EPRIVATE" });
    const ok = publicLookup((_host, callback) => callback(null, [{ address: "8.8.8.8", family: 4 }]));
    expect(await new Promise(resolve => ok("good.test", {}, (_error, address) => resolve(address)))).toBe("8.8.8.8");
  });

  it("returns the image's real type and bytes", async () => {
    const result = await downloadLinkImage("https://share.lalamove.com/pod.png", host({ "https://share.lalamove.com/pod.png": () => reply(200, png) }));
    expect(result).toMatchObject({ ok: true, contentType: "image/png", filename: "delivery-proof.png" });
  });

  it.each([["http://share.lalamove.com/pod.png"], ["https://user:pw@share.lalamove.com/pod.png"], ["not a link"], [""]])("refuses %j before any request", async value => {
    const fetcher = host({});
    expect(await downloadLinkImage(value, fetcher)).toEqual({ ok: false, reason: LINK_INVALID_REASON });
    expect(fetcher.seen).toEqual([]);
  });

  it("refuses a literal private address without connecting", async () => {
    const fetcher = host({});
    expect(await downloadLinkImage("https://169.254.169.254/latest/meta-data", fetcher)).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
    expect(fetcher.seen).toEqual([]);
  });

  it("follows a redirect but re-checks it, refusing a redirect to a private address or to http", async () => {
    const ok = host({ "https://share.lalamove.com/a": () => reply(302, undefined, "/b.png"), "https://share.lalamove.com/b.png": () => reply(200, png) });
    expect(await downloadLinkImage("https://share.lalamove.com/a", ok)).toMatchObject({ ok: true });
    const internal = host({ "https://share.lalamove.com/a": () => reply(302, undefined, "https://10.0.0.1/x.png") });
    expect(await downloadLinkImage("https://share.lalamove.com/a", internal)).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
    expect(internal.seen).toEqual(["https://share.lalamove.com/a"]);
    const plain = host({ "https://share.lalamove.com/a": () => reply(301, undefined, "http://share.lalamove.com/b.png") });
    expect(await downloadLinkImage("https://share.lalamove.com/a", plain)).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
  });

  it("stops after three redirects", async () => {
    const loop = host({ "https://share.lalamove.com/a": () => reply(302, undefined, "/a") });
    expect(await downloadLinkImage("https://share.lalamove.com/a", loop)).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
    expect(loop.seen).toHaveLength(4);
  });

  it("refuses a page, a PDF, an error status and an image over 5 MB", async () => {
    const page = new TextEncoder().encode("<html>tracking</html>");
    expect(await downloadLinkImage("https://x.test/p", host({ "https://x.test/p": () => reply(200, page) }))).toEqual({ ok: false, reason: LINK_IMAGE_REASON });
    expect(await downloadLinkImage("https://x.test/p", host({ "https://x.test/p": () => reply(200, PDF) }))).toEqual({ ok: false, reason: LINK_IMAGE_REASON });
    expect(await downloadLinkImage("https://x.test/p", host({ "https://x.test/p": () => reply(404) }))).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
    const huge = new Uint8Array(5 * 1024 * 1024 + 1); huge.set(png);
    expect(await downloadLinkImage("https://x.test/p", host({ "https://x.test/p": () => reply(200, huge) }))).toEqual({ ok: false, reason: LINK_TOO_LARGE_REASON });
  });

  it("says the link could not be reached when the connection fails", async () => {
    expect(await downloadLinkImage("https://down.test/p.png", host({}))).toEqual({ ok: false, reason: LINK_UNREACHABLE_REASON });
  });
});

describe("marking delivered with a courier image link", () => {
  let storage: FakeFileStorage;
  let storefront: FakeStorefront;
  beforeAll(async () => { db = await startTestDatabase(); }, 60_000);
  afterAll(async () => { await db.close(); });
  beforeEach(async () => {
    await db.sql`truncate orders, customers restart identity cascade`;
    await db.sql`insert into customers (id, full_name, email) values ('c1', 'Maria', 'maria@example.com')`;
    await db.sql`insert into orders (customer_id, status, payment_method, subtotal_in_centavos) values ('c1', 'dispatched', 'gcash', 100000)`;
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
    vi.mocked(requireModule).mockResolvedValue({ id: "ana", username: "ana", name: "Ana", email: "ana@example.com", role: "Staff" });
    link.fetcher = host({ "https://share.lalamove.com/pod.png": () => reply(200, png) });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it("stores the linked image as a private Delivery photo and delivers the Order with it", async () => {
    const ready = await importDeliveryPhotoLink("https://share.lalamove.com/pod.png");
    expect(ready).toMatchObject({ ok: true, contentType: "image/png", filename: "delivery-proof.png", size: png.length });
    if (!ready.ok) throw new Error(ready.reason);
    const form = new FormData();
    form.set("photo", ready.reference);
    form.set("photoLink", "https://share.lalamove.com/pod.png");

    expect(await deliverOrder(1, form)).toMatchObject({ ok: true });
    expect(storage.files.get("direct-1")).toMatchObject({ visibility: "private", retentionType: "permanent", contentType: "image/png" });
    expect(await db.sql`select status, delivery_photo_file_id from orders where id = 1`).toEqual([{ status: "delivered", delivery_photo_file_id: "direct-1" }]);
  });

  it("stores nothing when the link gives no image", async () => {
    link.fetcher = host({ "https://share.lalamove.com/page": () => reply(200, new TextEncoder().encode("<html></html>")) });
    expect(await importDeliveryPhotoLink("https://share.lalamove.com/page")).toEqual({ ok: false, reason: LINK_IMAGE_REASON });
    expect(storage.files.size).toBe(0);
  });

  it("is refused for a read-only role before anything is downloaded", async () => {
    vi.mocked(requireModule).mockResolvedValue({ id: "admin", username: "admin", name: "Ada", email: "admin@example.com", role: "Admin" });
    const fetcher = host({});
    link.fetcher = fetcher;
    expect(await importDeliveryPhotoLink("https://share.lalamove.com/pod.png")).toMatchObject({ ok: false });
    expect(fetcher.seen).toEqual([]);
  });

  it("says storage is unavailable when the file cannot be created", async () => {
    storage.failUpload = true;
    expect(await importDeliveryPhotoLink("https://share.lalamove.com/pod.png")).toEqual({ ok: false, reason: "File storage is temporarily unavailable. Please try again." });
  });
});
