import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { gatewayMarketingMailer } from "@/lib/gateway";

const mail = { title: "Undas ube treats", description: "Back for Undas.", images: ["https://cdn.test/1.jpg"], imageLayout: null };
const ada = { customerId: "c1", email: "ada@x.test" };
const ben = { customerId: "c2", email: "ben@x.test" };

let bodies: Record<string, unknown>[];

beforeEach(() => {
  bodies = [];
  process.env.CREOMS_GATEWAY_URL = "https://gateway.test";
  process.env.CREOMS_GATEWAY_CALLER_KEY = "key";
  process.env.CREOMS_STOREFRONT_URL = "https://shop.test/";
  process.env.UNSUBSCRIBE_SECRET = "s".repeat(32);
});

afterEach(() => vi.unstubAllGlobals());

function stubGateway(refuse: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://gateway.test/notifications/emails/marketing");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
      const body = JSON.parse(init.body as string);
      bodies.push(body);

      return new Response(null, { status: refuse.includes(body.to) ? 500 : 202 });
    }),
  );
}

describe("the gateway marketing mailer", () => {
  it("sends each Subscriber their own Email, as a Subscriber, with their own Unsubscribe link", async () => {
    stubGateway();

    expect(await gatewayMarketingMailer.sendBatch(mail, [ada, ben])).toEqual([ada, ben]);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ to: "ada@x.test", app: "CRMS", subscriberConsent: true, title: mail.title, body: mail.description, images: mail.images });
    const links = bodies.map((b) => b.unsubscribeUrl as string);
    expect(links[0]).toMatch(/^https:\/\/shop\.test\/unsubscribe\?token=/);
    expect(links[0]).not.toBe(links[1]);
    expect(Buffer.from(links[0].split("token=")[1].split(".")[0], "base64url").toString()).toBe("c1");
  });

  it("reports only the Subscribers the gateway accepted", async () => {
    stubGateway(["ben@x.test"]);

    expect(await gatewayMarketingMailer.sendBatch(mail, [ada, ben])).toEqual([ada]);
  });
});
