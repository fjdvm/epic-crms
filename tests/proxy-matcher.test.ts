import { describe, expect, it } from "vitest";

import { config } from "@/proxy";

const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe("proxy matcher", () => {
  it("leaves the health route outside the Portal session", () => {
    expect(matches("/api/health")).toBe(false);
  });

  it("leaves the storefront's payment-methods route outside the Portal session, since it authenticates with the service secret", () => {
    expect(matches("/api/payment-methods")).toBe(false);
  });

  it("leaves only the IMS stock push outside the Portal session, since it authenticates with the IMS credential", () => {
    expect(matches("/api/internal/ims-stock")).toBe(false);
    expect(matches("/api/internal/ims-stock-admin")).toBe(true);
    expect(matches("/api/internal/other")).toBe(true);
  });

  it("leaves the POS sales feed outside the Portal session, since it authenticates with the POS token", () => {
    expect(matches("/api/internal/pos-sales")).toBe(false);
    expect(matches("/api/internal/pos-sales-admin")).toBe(true);
  });

  it("still guards the payment accounts routes and similarly named paths", () => {
    expect(matches("/api/payment-accounts/1/qr")).toBe(true);
    expect(matches("/api/payment-methods-admin")).toBe(true);
  });

  it("still guards the other approval routes", () => {
    expect(matches("/api/approvals/requests")).toBe(true);
  });

  it("still guards pages", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/customers")).toBe(true);
  });
});
