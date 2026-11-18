import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getShell, homePage, requireManagement } from "@/lib/portal/staff";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { FakePortal, FAKE_CALLBACK, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, portalFetch } from "./fake-portal";

const session = vi.hoisted(() => ({ handle: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: session.handle }) }),
  headers: async () => new Headers(),
}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));

let portal: FakePortal;
beforeEach(() => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_DEV_BYPASS", "false");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function signIn(role: string, modules: string[]) {
  portal.addStaff("u", { id: "u", username: "u", name: "Una", email: "u@example.com", role }, modules);
  portal.signIn("u");
  const verifier = "v".repeat(43);
  const authorize = new URL("/api/integrations/authorize", FAKE_PORTAL_URL);
  authorize.search = new URLSearchParams({ system: FAKE_SYSTEM, redirect_uri: FAKE_CALLBACK, state: "s",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  const code = new URL((await portal.handle(new Request(authorize))).headers.get("location")!).searchParams.get("code");
  const exchange = await portal.handle(new Request(`${FAKE_PORTAL_URL}/api/integrations/exchange`, {
    method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}` },
    body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: FAKE_CALLBACK, state: "s" }),
  }));
  session.handle = (await exchange.json()).handle;
}

const TABS = ["/management/payment-management", "/management/delivery-management"];

describe("Management access", () => {
  it.each(["CRMS Manager", "CEO"])("opens both tabs for a %s holding the Module", async (role) => {
    await signIn(role, ["Orders", MANAGEMENT_MODULE]);
    await expect(requireManagement()).resolves.toMatchObject({ id: "u" });
    expect((await getShell()).permittedPages).toEqual(expect.arrayContaining(TABS));
  });

  it("refuses a Manager without the Module on the server and hides the tabs", async () => {
    await signIn("CRMS Manager", ["Orders"]);
    await expect(requireManagement()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    expect((await getShell()).permittedPages).not.toContain(TABS[0]);
  });

  it.each(["Staff", "Admin"])("refuses %s on a direct visit even if the Module reached them", async (role) => {
    await signIn(role, ["Orders", MANAGEMENT_MODULE]);
    await expect(requireManagement()).rejects.toMatchObject({ digest: expect.stringContaining("/no-access") });
    const shell = await getShell();
    expect(shell.permittedPages).toContain("/orders");
    for (const tab of TABS) expect(shell.permittedPages).not.toContain(tab);
  });

  it("never lands a Staff member holding only Management on a Management page", async () => {
    await signIn("Staff", [MANAGEMENT_MODULE]);
    expect(await homePage().catch((e) => e.digest)).toContain("/no-access");
  });
});
