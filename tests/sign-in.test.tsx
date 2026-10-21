// @vitest-environment jsdom
import { NextRequest } from "next/server";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/portal/callback/route";
import { GET as login } from "@/app/api/portal/login/route";
import { SidebarProfileFooter } from "@/components/layout/sidebar-profile-footer";
import { StaffProvider } from "@/components/layout/staff-context";
import { validateSession } from "@/lib/portal/client";
import { proxy } from "@/proxy";
import {
  FAKE_CALLBACK,
  FAKE_PORTAL_URL,
  FAKE_SECRET,
  FAKE_SYSTEM,
  FakePortal,
  portalFetch,
} from "./fake-portal";

const APP = "http://localhost:3000";
const ada = {
  name: "Ada Okafor",
  username: "ada.okafor",
  email: "ada@brenraphaels.test",
  role: "Customer Support",
};

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  portal.addStaff("ada", ada);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CREOMS_APP_URL", APP);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A browser's cookie jar, filled from Set-Cookie headers. */
class Browser {
  jar = new Map<string, string>();

  request(url: string) {
    const cookie = [...this.jar]
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("; ");

    return new NextRequest(url, { headers: cookie ? { cookie } : {} });
  }

  keep(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const [name, ...rest] = pair.split("=");
      const value = decodeURIComponent(rest.join("="));
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
  }

  location(response: Response) {
    return new URL(response.headers.get("location")!, APP);
  }
}

/** Opens a page without a session and follows the redirects up to the Portal's authorize step. */
async function startHandoff(browser: Browser, page: string) {
  const gated = proxy(browser.request(`${APP}${page}`));
  const signingIn = browser.location(gated);
  // The signing-in page sends the browser straight on to the login route.
  const loginUrl = new URL(`/api/portal/login${signingIn.search}`, APP);
  const toPortal = login(browser.request(loginUrl.toString()));
  browser.keep(toPortal);

  return { gated, loginUrl, authorizeUrl: toPortal.headers.get("location")! };
}

describe("a request with no session", () => {
  it("redirects to the Portal login carrying the requested page", async () => {
    const browser = new Browser();
    const { gated, authorizeUrl } = await startHandoff(
      browser,
      "/customer-profiles?page=2",
    );

    expect(gated.status).toBe(307);
    expect(browser.location(gated).pathname).toBe("/signing-in");
    expect(
      authorizeUrl.startsWith(`${FAKE_PORTAL_URL}/api/integrations/authorize`),
    ).toBe(true);
    expect(new URL(authorizeUrl).searchParams.get("redirect_uri")).toBe(
      FAKE_CALLBACK,
    );
  });

  it("never returns to the signing-in page, which would start the handoff again", () => {
    const browser = new Browser();
    const response = login(
      browser.request(
        `${APP}/api/portal/login?returnTo=${encodeURIComponent("/signing-in?returnTo=%2F")}`,
      ),
    );

    browser.keep(response);

    expect(JSON.parse(browser.jar.get("creoms_handoff")!).returnTo).toBe("/");
  });

  it("never returns to an address outside CREOMS", () => {
    const browser = new Browser();
    const response = login(
      browser.request(
        `${APP}/api/portal/login?returnTo=${encodeURIComponent("//evil.test")}`,
      ),
    );

    browser.keep(response);

    expect(JSON.parse(browser.jar.get("creoms_handoff")!).returnTo).toBe("/");
  });
});

describe("completing the handoff", () => {
  it("lands the Staff member on the page they asked for, holding only the opaque handle", async () => {
    const browser = new Browser();
    const { authorizeUrl } = await startHandoff(
      browser,
      "/customer-profiles?page=2",
    );
    portal.signIn("ada");

    const granted = await portal.handle(new Request(authorizeUrl));
    const landed = await callback(
      browser.request(granted.headers.get("location")!),
    );
    browser.keep(landed);

    expect(
      browser.location(landed).pathname + browser.location(landed).search,
    ).toBe("/customer-profiles?page=2");

    const sessionCookie = landed.headers
      .getSetCookie()
      .find((c) => c.startsWith("creoms_session="))!;
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/SameSite=lax/i);

    // The page request now passes the gate.
    const page = proxy(browser.request(`${APP}/customer-profiles?page=2`));
    expect(page.headers.get("location")).toBeNull();
  });

  it("sends a visitor who is not yet signed in to the Portal login and back to the authorize request", async () => {
    const browser = new Browser();
    const { authorizeUrl } = await startHandoff(browser, "/customer-profiles");

    const toLogin = await portal.handle(new Request(authorizeUrl));
    const loginUrl = new URL(toLogin.headers.get("location")!);

    expect(loginUrl.pathname).toBe("/login");
    const back = new URL(
      loginUrl.searchParams.get("returnTo")!,
      FAKE_PORTAL_URL,
    );
    expect(back.pathname).toBe("/api/integrations/authorize");
    expect(back.searchParams.get("state")).toBe(
      new URL(authorizeUrl).searchParams.get("state"),
    );
  });

  it("a replayed code shows an error and creates no session", async () => {
    const browser = new Browser();
    const { authorizeUrl } = await startHandoff(browser, "/customer-profiles");
    portal.signIn("ada");
    const granted = (
      await portal.handle(new Request(authorizeUrl))
    ).headers.get("location")!;
    const handoffCookies = new Map(browser.jar);

    const first = await callback(browser.request(granted));
    expect(browser.location(first).pathname).toBe("/customer-profiles");

    // Someone replays the same link in a browser that started the same sign-in.
    const replayer = new Browser();
    replayer.jar = handoffCookies;
    const replay = await callback(replayer.request(granted));

    expect(replay.headers.get("location")).toContain("/sign-in-error");
    expect(
      replay.headers
        .getSetCookie()
        .some((c) => c.startsWith("creoms_session=")),
    ).toBe(false);
  });

  it("an expired code shows an error and creates no session", async () => {
    const browser = new Browser();
    const { authorizeUrl } = await startHandoff(browser, "/customer-profiles");
    portal.signIn("ada");
    const granted = await portal.handle(new Request(authorizeUrl));
    portal.expireCodes();

    const response = await callback(
      browser.request(granted.headers.get("location")!),
    );

    expect(browser.location(response).pathname).toBe("/sign-in-error");
    expect(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith("creoms_session=")),
    ).toBe(false);
  });

  it("a callback whose state does not match the sign-in started shows an error", async () => {
    const browser = new Browser();
    await startHandoff(browser, "/customer-profiles");

    const response = await callback(
      browser.request(`${APP}/api/portal/callback?code=anything&state=forged`),
    );

    expect(browser.location(response).pathname).toBe("/sign-in-error");
  });

  it("a Portal refusal shows an error and creates no session", async () => {
    const browser = new Browser();
    await startHandoff(browser, "/customer-profiles");

    const response = await callback(
      browser.request(`${APP}/api/portal/callback?error=access_denied&state=x`),
    );

    expect(browser.location(response).search).toBe("?reason=denied");
    expect(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith("creoms_session=")),
    ).toBe(false);
  });
});

describe("the profile footer", () => {
  it("shows the real name, Username, email and Role of the signed-in Staff member", async () => {
    const browser = new Browser();
    const { authorizeUrl } = await startHandoff(browser, "/customer-profiles");
    portal.signIn("ada");
    const granted = await portal.handle(new Request(authorizeUrl));
    const landed = await callback(
      browser.request(granted.headers.get("location")!),
    );
    browser.keep(landed);

    const result = await validateSession(
      browser.jar.get("creoms_session")!,
      "Customer Profiles",
    );
    if (result.decision !== "allowed")
      throw new Error("expected the Portal to allow");

    render(
      <StaffProvider staff={result.staff}>
        <SidebarProfileFooter />
      </StaffProvider>,
    );
    await userEvent.click(screen.getByText("Ada Okafor"));

    expect(screen.getAllByText("Ada Okafor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ada.okafor").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ada@brenraphaels.test").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("Customer Support").length).toBeGreaterThan(0);
    expect(screen.queryByText("Staff Member")).toBeNull();
  });
});

describe("return addresses", () => {
  it.each([
    "/\t/evil.test",
    "//evil.test",
    "https://evil.test",
    "/\\evil.test",
  ])("never return to %j", (value) => {
    const browser = new Browser();
    browser.keep(
      login(
        browser.request(
          `${APP}/api/portal/login?returnTo=${encodeURIComponent(value)}`,
        ),
      ),
    );

    expect(JSON.parse(browser.jar.get("creoms_handoff")!).returnTo).toBe("/");
  });
});
