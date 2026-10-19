import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@/lib/portal/access";
import { exchangeCode } from "@/lib/portal/client";
import {
  FAKE_PORTAL_URL,
  FAKE_SECRET,
  FAKE_SYSTEM,
  FakePortal,
  portalFetch,
} from "./fake-portal";
import { createHash } from "node:crypto";

const ada = {
  name: "Ada Okafor",
  username: "ada.okafor",
  email: "ada@brenraphaels.test",
  role: "Customer Support",
};
const CUSTOMER_PROFILES = "Customer Profiles";

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Signs Ada in through the full handoff and returns her opaque session handle. */
async function signInAda(modules?: string[]) {
  portal.addStaff("ada", ada, modules);
  portal.signIn("ada");
  const verifier = "v".repeat(43);
  const callback = "http://localhost:3000/api/portal/callback";
  const authorize = new URL(`${FAKE_PORTAL_URL}/api/integrations/authorize`);
  authorize.search = new URLSearchParams({
    system: FAKE_SYSTEM,
    redirect_uri: callback,
    state: "s",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  const granted = new URL((await portal.handle(new Request(authorize))).headers.get("location")!);
  const result = await exchangeCode({
    code: granted.searchParams.get("code")!,
    state: "s",
    codeVerifier: verifier,
  });
  if (!result.ok) throw new Error("handoff failed");

  return result.sessionHandle;
}

describe("access to the Customer Profiles pages", () => {
  it("is allowed with the Customer Profiles Module", async () => {
    const access = accessFor(await signInAda());

    expect(await access.check(CUSTOMER_PROFILES)).toMatchObject({
      decision: "allowed",
      staff: ada,
    });
  });

  it("is denied without it, even with a different CRMS Module", async () => {
    const access = accessFor(await signInAda(["Leads"]));

    expect((await access.check(CUSTOMER_PROFILES)).decision).toBe("denied");
  });

  it("is refused for a request with no session, and for an unknown session handle", async () => {
    expect((await accessFor(undefined).check(CUSTOMER_PROFILES)).decision).toBe("invalid");
    expect((await accessFor("made-up").check(CUSTOMER_PROFILES)).decision).toBe("invalid");
  });

  it("is blocked while the Portal cannot be reached", async () => {
    const handle = await signInAda();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("unavailable");
  });
});

describe("access on every request", () => {
  it("denies the next request once the Module is revoked at the Portal", async () => {
    const handle = await signInAda(["Customer Profiles", "Leads"]);

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("allowed");
    portal.revoke("ada", CUSTOMER_PROFILES);

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("denied");
    expect((await accessFor(handle).check("Leads")).decision).toBe("allowed");
  });

  it("asks the Portal once for a page load, however often the page asks", async () => {
    const access = accessFor(await signInAda());
    const before = portal.validations;

    await Promise.all([access.check(CUSTOMER_PROFILES), access.check(CUSTOMER_PROFILES)]);
    await access.check(CUSTOMER_PROFILES);

    expect(portal.validations - before).toBe(1);
  });
});

describe("which pages a Staff member may open", () => {
  it("lists only pages whose Module is granted, and `/` goes to the first of them", async () => {
    const access = accessFor(await signInAda());

    expect(await access.permittedPages()).toEqual(["/customer-profiles"]);
    expect(await access.firstPermittedPage()).toBe("/customer-profiles");
  });

  it("lists nothing, and has no first page, when no Module is granted", async () => {
    const access = accessFor(await signInAda(["Leads"]));

    expect(await access.permittedPages()).toEqual([]);
    expect(await access.firstPermittedPage()).toBeNull();
  });
});
