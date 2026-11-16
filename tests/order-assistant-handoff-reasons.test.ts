import { expect, it } from "vitest";
import {
  handoffReason,
  waitingFor,
} from "@/features/order-assistant/handoff-reasons";
it("labels known reasons and falls back to the stored words", () => {
  expect(handoffReason("damaged_item")).toMatchObject({
    label: "Damaged item",
    note: "needs replacement",
  });
  expect(handoffReason("something_new").label).toBe("Something new");
});
it("shows how long a handed-off Ticket has waited", () => {
  const now = new Date("2026-11-17T04:00:00Z");
  expect(waitingFor(new Date("2026-11-17T03:48:00Z"), now)).toBe("12 min");
  expect(waitingFor(new Date("2026-11-17T02:00:00Z"), now)).toBe("2 h");
  expect(waitingFor(new Date("2026-11-13T04:00:00Z"), now)).toBe("4 d");
});
