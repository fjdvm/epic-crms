// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as logout } from "@/app/api/portal/logout/route";
import { SidebarProfileFooter } from "@/components/layout/sidebar-profile-footer";
import { StaffProvider } from "@/components/layout/staff-context";
import { accessFor } from "@/lib/portal/access";
import { guarded, settle, SESSION_ENDED_MESSAGE, UNAVAILABLE_MESSAGE } from "@/lib/portal/in-page";
import { exchangeCode } from "@/lib/portal/client";
import {
  FAKE_CALLBACK,
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
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function signInAda(modules?: string[]) {
  portal.addStaff("ada", ada, modules);
  portal.signIn("ada");
  const verifier = "v".repeat(43);
  const authorize = new URL(`${FAKE_PORTAL_URL}/api/integrations/authorize`);
  authorize.search = new URLSearchParams({
    system: FAKE_SYSTEM,
    redirect_uri: FAKE_CALLBACK,
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

describe("after the session ends", () => {
  it("is refused on the next request after central logout", async () => {
    const handle = await signInAda();
    portal.signOut();

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("invalid");
  });

  it("is refused once the Staff member is deleted from the Portal", async () => {
    const handle = await signInAda();
    portal.remove("ada");

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("denied");
  });

  it("shows no access, not a loop, when the Staff member returns without the Module", async () => {
    const handle = await signInAda();
    portal.signOut();
    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("invalid");

    const back = await signInAda(["Leads"]);

    expect((await accessFor(back).check(CUSTOMER_PROFILES)).decision).toBe("denied");
  });
});

describe("an in-page request", () => {
  it("returns the data while the session is live", async () => {
    const access = accessFor(await signInAda());

    expect(await guarded(access, CUSTOMER_PROFILES, async () => ["row"])).toEqual({
      status: "ok",
      value: ["row"],
    });
  });

  it("never runs the load after the session ended or the Portal is down", async () => {
    const handle = await signInAda();
    const load = vi.fn(async () => ["row"]);

    portal.unavailable = true;
    expect(await guarded(accessFor(handle), CUSTOMER_PROFILES, load)).toEqual({
      status: "unavailable",
    });

    portal.unavailable = false;
    portal.signOut();
    expect(await guarded(accessFor(handle), CUSTOMER_PROFILES, load)).toEqual({
      status: "session-ended",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("shows the short message, then redirects to the Portal login", () => {
    vi.useFakeTimers();
    const ui = { notify: vi.fn(), goTo: vi.fn(), loginUrl: "/api/portal/login?returnTo=%2Fx" };

    settle({ status: "session-ended" }, ui);

    expect(ui.notify).toHaveBeenCalledWith(SESSION_ENDED_MESSAGE);
    expect(ui.goTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(ui.goTo).toHaveBeenCalledWith(ui.loginUrl);
  });

  it("shows the unavailable message and does not redirect", () => {
    vi.useFakeTimers();
    const ui = { notify: vi.fn(), goTo: vi.fn(), loginUrl: "/login" };

    expect(settle({ status: "unavailable" }, ui)).toBeUndefined();
    vi.advanceTimersByTime(5000);

    expect(ui.notify).toHaveBeenCalledWith(UNAVAILABLE_MESSAGE);
    expect(ui.goTo).not.toHaveBeenCalled();
  });
});

describe("while the Portal cannot be reached", () => {
  it("blocks every Module and never allows from an earlier answer", async () => {
    const handle = await signInAda();
    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("allowed");

    portal.unavailable = true;

    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("unavailable");
    expect((await accessFor(handle).overview()).decision).toBe("unavailable");
  });
});

describe("signing out", () => {
  it("forgets the session, sends the browser to the Portal, and ends the central session", async () => {
    const handle = await signInAda();

    const response = logout();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${FAKE_PORTAL_URL}/logout`);
    expect(response.headers.getSetCookie().some((c) => /^creoms_session=;/.test(c))).toBe(true);

    const atPortal = await portal.handle(new Request(response.headers.get("location")!));
    expect(atPortal.headers.get("location")).toBe(`${FAKE_PORTAL_URL}/login`);
    expect((await accessFor(handle).check(CUSTOMER_PROFILES)).decision).toBe("invalid");
  });

  it("shows the Staff profile above a Log out button that asks before signing out", async () => {
    render(
      <StaffProvider staff={ada}>
        <SidebarProfileFooter />
      </StaffProvider>,
    );

    expect(screen.getByText("Ada Okafor")).toBeTruthy();
    expect(screen.getByText("ada.okafor")).toBeTruthy();
    expect(screen.getByText("ada@brenraphaels.test")).toBeTruthy();
    expect(screen.getByText("Customer Support")).toBeTruthy();

    const form = document.querySelector('form[action="/api/portal/logout"]')!;
    expect(form.getAttribute("method")).toBe("post");
    expect(screen.queryByText("Log out of CREOMS?")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(screen.getByText("Log out of CREOMS?")).toBeTruthy();
    expect(screen.getByText(/all Bren Raphael's systems/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    const confirm = screen.getAllByRole("button", { name: "Log out" }).find((b) => b.getAttribute("form") === "logout-form")!;
    expect(confirm.getAttribute("type")).toBe("submit");
  });

});
