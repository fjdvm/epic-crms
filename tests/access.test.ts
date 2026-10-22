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
const TICKETS = "Tickets";
const FEEDBACK = "Feedback";
const MARKETING = "Marketing";

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

describe("access to the Tickets pages", () => {
  it("is allowed with the Tickets Module", async () => {
    expect((await accessFor(await signInAda([TICKETS])).check(TICKETS)).decision).toBe("allowed");
  });

  it("is denied without it, even with Customer Profiles", async () => {
    const access = accessFor(await signInAda([CUSTOMER_PROFILES]));

    expect((await access.check(TICKETS)).decision).toBe("denied");
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
});

describe("which pages a Staff member may open", () => {
  it("lists only pages whose Module is granted", async () => {
    const access = accessFor(await signInAda());

    expect(await access.overview()).toEqual({
      decision: "allowed",
      staff: ada,
      pages: ["/customer-profiles"],
    });
  });

  it("is denied when no Module is granted", async () => {
    const access = accessFor(await signInAda(["Leads"]));

    expect(await access.overview()).toEqual({ decision: "denied" });
  });

  it("opens both the Tickets and Conversations pages with the Tickets Module alone", async () => {
    const access = accessFor(await signInAda([TICKETS]));

    expect(await access.overview()).toEqual({
      decision: "allowed",
      staff: ada,
      pages: ["/tickets", "/conversations"],
    });
  });

  it("lists every page when both Modules are granted", async () => {
    const access = accessFor(await signInAda([CUSTOMER_PROFILES, TICKETS]));

    expect(await access.overview()).toMatchObject({
      pages: ["/customer-profiles", "/tickets", "/conversations"],
    });
  });

  it("is refused without a session", async () => {
    expect(await accessFor(undefined).overview()).toEqual({ decision: "invalid" });
  });
});

describe("access to the Feedback page", () => {
  it("is allowed with the Feedback Module", async () => {
    expect((await accessFor(await signInAda([FEEDBACK])).check(FEEDBACK)).decision).toBe("allowed");
  });

  it("is denied with only the Tickets Module", async () => {
    expect((await accessFor(await signInAda([TICKETS])).check(FEEDBACK)).decision).toBe("denied");
  });

  it("is denied with only the Feedback Module for the Tickets pages", async () => {
    expect((await accessFor(await signInAda([FEEDBACK])).check(TICKETS)).decision).toBe("denied");
  });

  it("lists /feedback only when its Module is granted", async () => {
    expect(await accessFor(await signInAda([FEEDBACK])).overview()).toMatchObject({ pages: ["/feedback"] });
    expect(await accessFor(await signInAda([TICKETS])).overview()).toMatchObject({
      pages: ["/tickets", "/conversations"],
    });
  });
});

describe("access to the Email Campaigns page", () => {
  it("is allowed with the Marketing Module", async () => {
    expect((await accessFor(await signInAda([MARKETING])).check(MARKETING)).decision).toBe("allowed");
  });

  it("is denied without it", async () => {
    expect((await accessFor(await signInAda([FEEDBACK, TICKETS])).check(MARKETING)).decision).toBe("denied");
  });

  it("lists /email-campaigns only when its Module is granted", async () => {
    expect(await accessFor(await signInAda([MARKETING])).overview()).toMatchObject({ pages: ["/email-campaigns"] });
    expect(await accessFor(await signInAda([FEEDBACK])).overview()).toMatchObject({ pages: ["/feedback"] });
  });
});

describe("access to the Orders, Payments and Fulfilment pages", () => {
  const ORDERS = "Orders";
  const PAYMENTS = "Payments";
  const FULFILMENT = "Fulfilment";

  it("gives each Module its own page", async () => {
    expect(await accessFor(await signInAda([ORDERS])).overview()).toMatchObject({ pages: ["/orders"] });
    expect(await accessFor(await signInAda([PAYMENTS])).overview()).toMatchObject({ pages: ["/payments"] });
    expect(await accessFor(await signInAda([FULFILMENT])).overview()).toMatchObject({ pages: ["/fulfilment"] });
  });

  it("opens an Order's detail with any one of the three Modules", async () => {
    for (const module of [ORDERS, PAYMENTS, FULFILMENT]) {
      const access = accessFor(await signInAda([module]));

      expect(await access.checkAny([ORDERS, PAYMENTS, FULFILMENT])).toMatchObject({ decision: "allowed", staff: ada });
    }
  });

  it("refuses an Order's detail to Staff with none of the three", async () => {
    const access = accessFor(await signInAda([CUSTOMER_PROFILES, TICKETS]));

    expect((await access.checkAny([ORDERS, PAYMENTS, FULFILMENT])).decision).toBe("denied");
  });

  it("refuses an Order's detail with no session, and is blocked while the Portal is down", async () => {
    expect((await accessFor(undefined).checkAny([ORDERS, PAYMENTS, FULFILMENT])).decision).toBe("invalid");

    const handle = await signInAda([ORDERS]);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));

    expect((await accessFor(handle).checkAny([ORDERS, PAYMENTS, FULFILMENT])).decision).toBe("unavailable");
  });
});

describe("an Order's detail when the Portal cannot answer for one Module", () => {
  it("still opens for a Module the Portal did answer for", async () => {
    const handle = await signInAda(["Orders"]);
    const real = portalFetch(portal);
    let calls = 0;
    vi.stubGlobal("fetch", (...args: Parameters<typeof fetch>) =>
      ++calls === 1 ? real(...args) : Promise.reject(new Error("flaky")),
    );

    expect((await accessFor(handle).checkAny(["Orders", "Payments"])).decision).toBe("allowed");
  });
});
