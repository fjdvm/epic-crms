import { expect, type Mock } from "vitest";
import type { AuditEvent } from "@/lib/audit-trail";

/** What the port received, in order. */
export const auditEvents = (audit: Mock): AuditEvent[] => audit.mock.calls.map((c) => (c as unknown as [AuditEvent])[0]);

/** A refused or failed change records its failure event (#753) and never a success one. */
export function expectOnlyFailureEvents(audit: Mock) {
  const events = auditEvents(audit);
  expect(events.length).toBeGreaterThan(0);
  expect(events.map((e) => e.outcome)).toEqual(events.map(() => "failure"));
}
