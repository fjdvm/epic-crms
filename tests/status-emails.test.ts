import { describe, expect, test } from "vitest";

import { isStatusEmailKind, STATUS_EMAILS } from "@/features/orders/status-emails";

describe("fulfilment Status emails", () => {
  test("use the storefront's real kind names, all owned by Fulfilment", () => {
    for (const kind of ["preparing", "dispatched", "ready-for-pickup", "completed"]) {
      expect(isStatusEmailKind(kind)).toBe(true);
      expect(STATUS_EMAILS[kind as keyof typeof STATUS_EMAILS].module).toBe(STATUS_EMAILS.preparing.module);
    }
    expect(isStatusEmailKind("ready_for_pickup")).toBe(false);
  });
});
