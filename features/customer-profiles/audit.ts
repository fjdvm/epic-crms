import type { AuditTrail } from "@/lib/audit-trail";

export interface CustomerAudit {
  trail: AuditTrail;
  operationId: string;
  staff: { id: string; name: string };
}
