import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCustomers } from "@/features/customer-profiles/customers";

afterEach(() => vi.restoreAllMocks());

describe("loadCustomers", () => {
  it("reports unavailable instead of throwing when there is no database connection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await loadCustomers(() => {
      throw new Error("CREOMS_DATABASE_URL is not set; see .env.example");
    }, {});

    expect(result).toEqual({ ok: false });
  });

  it("reports unavailable when the query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = (() => Promise.reject(new Error("connection refused"))) as never;

    expect(await loadCustomers(() => broken, {})).toEqual({ ok: false });
  });
});
