import type postgres from "postgres";

import { recordAudit, type AuditTrail } from "@/lib/audit-trail";

/** At most one owner email per kind of error per hour. */
export const ALERT_WINDOW_MINUTES = 60;

export interface ErrorMonitorPorts {
  sql: postgres.Sql;
  audit: AuditTrail;
  /** Sends the owner alert through the notifications service. */
  email: (email: { to: string; title: string; body: string; button: { label: string; link: string } }) => Promise<void>;
  ownerEmail: string | undefined;
  appUrl: string;
  now?: () => Date;
}

/**
 * Records a server error as a `system.error` Audit Event and emails the owner, once per kind per hour.
 * Never throws: reporting an error must not hide or replace the original one.
 */
export async function reportError(kind: string, error: unknown, ports: ErrorMonitorPorts): Promise<void> {
  const now = ports.now?.() ?? new Date();
  const message = error instanceof Error ? error.message : String(error);

  await recordAudit(ports.audit, {
    module: "System",
    action: "system.error",
    outcome: "failure",
    actor: { type: "process", id: "creoms", display_name: "CREOMS" },
    target: { type: "error", id: kind, display_name: kind },
    description: `${kind}: ${message}`.slice(0, 500),
    occurred_at: now.toISOString(),
    metadata: { kind, message, stack: error instanceof Error ? error.stack?.slice(0, 2000) : undefined },
    operationId: `${kind}:${now.toISOString()}`,
  });

  if (!ports.ownerEmail) return;

  try {
    // One atomic statement: only the caller that moves the timestamp forward gets a row back, so
    // concurrent errors of the same kind email once.
    const claimed = await ports.sql`
      insert into crms.error_alerts (kind, last_emailed_at) values (${kind}, ${now})
      on conflict (kind) do update set last_emailed_at = excluded.last_emailed_at
        where crms.error_alerts.last_emailed_at <= ${new Date(now.getTime() - ALERT_WINDOW_MINUTES * 60_000)}
      returning kind`;

    if (claimed.length === 0) return;

    await ports.email({
      to: ports.ownerEmail,
      title: `CREOMS error: ${kind}`,
      body: `${message}\n\nYou get at most one email per kind of error per hour. Details are in the Portal System logs (system.error).`,
      button: { label: "Open CREOMS", link: ports.appUrl },
    });
  } catch (alertError) {
    console.error("CREOMS could not email the owner about an error", alertError);
  }
}

/** The kind of a request error: the route and the error's name, so one broken route is one kind. */
export function requestErrorKind(error: unknown, routePath: string): string {
  return `${error instanceof Error ? error.name : "Error"} at ${routePath}`;
}

/** The ports wired to the real database, gateway and environment. */
export async function liveErrorMonitor(): Promise<ErrorMonitorPorts> {
  const [{ crmsDatabase }, { gatewayAuditTrail, sendAppEmail }] = await Promise.all([
    import("@/lib/crms-db"),
    import("@/lib/gateway"),
  ]);

  return {
    sql: crmsDatabase(),
    audit: gatewayAuditTrail,
    email: sendAppEmail,
    ownerEmail: process.env.OWNER_ALERT_EMAIL,
    appUrl: process.env.CREOMS_APP_URL ?? "",
  };
}

/** Reports with the live ports; safe to call from any catch block. */
export async function reportLiveError(kind: string, error: unknown): Promise<void> {
  try {
    await reportError(kind, error, await liveErrorMonitor());
  } catch (reportingError) {
    console.error("CREOMS could not report an error", reportingError);
  }
}
