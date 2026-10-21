import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gatewayMarketingMail } from "@/lib/gateway";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("CREOMS_GATEWAY_URL", "https://gateway.test/");
  vi.stubEnv("CREOMS_GATEWAY_CALLER_KEY", "crms-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "e1", status: "queued" }), { status: 202 }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const message = { to: "ada@store.test", title: "Undas", body: "Back.", images: ["https://files.test/1.jpg"], imageLayout: null };

describe("the gateway's marketing mail", () => {
  it("posts one Marketing Email to the notifications service as the crms Caller", async () => {
    await gatewayMarketingMail.sendOne(message);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.test/notifications/emails/marketing");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer crms-key");
    expect(JSON.parse(init.body)).toEqual({
      to: "ada@store.test",
      app: "CRMS",
      subscriberConsent: true,
      title: "Undas",
      body: "Back.",
      images: ["https://files.test/1.jpg"],
    });
  });

  it("passes the chosen image layout on", async () => {
    await gatewayMarketingMail.sendOne({ ...message, images: ["https://files.test/1.jpg", "https://files.test/2.jpg"], imageLayout: "two-rows" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ imageLayout: "two-rows" });
  });

  it("throws when the gateway refuses the email", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 400 }));

    await expect(gatewayMarketingMail.sendOne(message)).rejects.toThrow("400");
  });
});
