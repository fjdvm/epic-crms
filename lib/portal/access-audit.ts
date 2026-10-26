import { setTimeout, clearTimeout } from "node:timers";
import { createHash } from "node:crypto";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { validateSession, type Staff } from "./client";
import { pages } from "./pages";

type Identity = Pick<Staff, "id" | "name">;
const handleHash = (handle: string) => createHash("sha256").update(handle).digest("hex");

/** Exchange and denial responses have no profile. Only a positive live validation identifies Staff. */
async function identify(handle: string): Promise<Identity | undefined> {
  const results = await Promise.all([...new Set(pages.map(p => p.module))].map(module => validateSession(handle, module)));
  return results.find(result => result.decision === "allowed")?.staff;
}

/** Audit attribution is best effort too: unavailable identity/storage must never change access. */
async function bestEffort(work: () => Promise<void>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work(), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Access auditing timed out")), 5_000);
    })]);
  } catch (error) {
    console.error("CREOMS access Audit Event could not be recorded", error);
  } finally {
    clearTimeout(timeout);
  }
}

/** Called only after a successful single-use code exchange, never on ordinary session validation. */
export async function auditSignIn(handle: string, expiresAt: Date, audit: AuditTrail = gatewayAuditTrail) {
  await bestEffort(async () => {
    const staff = await identify(handle);
    if (!staff) throw new Error("The Portal could not identify the signed-in Staff member");
    const hash = handleHash(handle);
    // A storage outage must not prevent delivery of the sign-in event itself.
    await bestEffort(async () => {
      const sql = crmsDatabase();
      await sql`delete from crms.access_audit_sessions where expires_at <= ${new Date()}`;
      await sql`insert into crms.access_audit_sessions (handle_hash, staff_id, staff_name, expires_at)
        values (${hash}, ${staff.id}, ${staff.name}, ${expiresAt}) on conflict (handle_hash) do nothing`;
    });
    await recordAudit(audit, {
      action: "crms.signed_in", outcome: "success", actor: staffAuditActor(staff),
      target: { type: "system", id: "CRMS", display_name: "CREOMS" },
      description: `${staff.name} signed in to CREOMS.`,
      occurred_at: new Date().toISOString(), operationId: hash,
    });
  });
}

/** A refusal remains a refusal even if attribution, the atomic cooldown or delivery fails. */
export async function auditAccessDenied(handle: string, module: string, audit: AuditTrail = gatewayAuditTrail) {
  await bestEffort(async () => {
    const sql = crmsDatabase();
    const now = new Date();
    const [saved] = await sql<{ staff_id: string; staff_name: string }[]>`
      select staff_id, staff_name from crms.access_audit_sessions
      where handle_hash = ${handleHash(handle)} and expires_at > ${now}`;
    // Pre-deployment sessions have no mapping; a held Module can still identify them.
    const staff = saved ? { id: saved.staff_id, name: saved.staff_name } : await identify(handle);
    if (!staff) throw new Error("The Portal could not identify the refused Staff member");
    const claimed = await sql`
      insert into crms.access_audit_refusals (staff_id, module, recorded_at)
      values (${staff.id}, ${module}, ${now})
      on conflict (staff_id, module) do update set recorded_at = excluded.recorded_at
      where crms.access_audit_refusals.recorded_at <= excluded.recorded_at - interval '1 minute'
      returning recorded_at`;
    if (!claimed.length) return;
    await recordAudit(audit, {
      action: "crms.access_denied", outcome: "failure", actor: staffAuditActor(staff),
      target: { type: "module", id: module, display_name: module },
      description: `${staff.name} was refused the ${module} Module.`,
      occurred_at: now.toISOString(),
      operationId: JSON.stringify([staff.id, module, Math.floor(now.getTime() / 60_000)]),
    });
  });
}
