import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { Staff } from "@/lib/portal/client";
import { canManage, shopRole } from "@/lib/portal/roles";
import { recordAudit, staffAuditActor, type AuditTrail } from "@/lib/audit-trail";

export type ApprovalAction = "order.cancel-after-dispatch" | "order.cancel-settle" | "payment.approve-anyway" | "return.approve" | "return.decline" | "return.refund" | "return.replace" | "return.extend-window" | "return.change-destination" | "return.decide" | "write-off";
export type ApprovalInput = { module: string; action: ApprovalAction; targetId: string; payload: Record<string, unknown>; amountInCentavos: number };
export type ApprovalOptions = { reason?: string; approvalId?: string };
export type ApprovalResult = { ok: false; reason: string; approvalId?: string; status?: string };
export type ApprovalRequest = {
  id: string; module: string; action: ApprovalAction; target_id: string; payload: Record<string, unknown>;
  amount_in_centavos: string; limit_in_centavos: string; reason: string;
  requester_id: string; requester_name: string; status: string;
  manager_id: string | null; manager_name: string | null; manager_at: Date | null; ceo_name: string | null; ceo_at: Date | null;
};
export type ApprovalNotice = (input: { request: ApprovalRequest; audience: "manager" | "ceo" | "requester"; text: string; key: string }) => Promise<void>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (reason: string): ApprovalResult => ({ ok: false, reason });

export function approvalWorkflow(sql: postgres.Sql, audit: AuditTrail, notify: ApprovalNotice, defer: (work: () => Promise<void>) => void | Promise<void> = work => work()) {
  async function event(tx: postgres.TransactionSql, staff: Staff, action: string, requestId: string | null, details: Record<string, unknown> = {}) {
    const id = randomUUID();
    await tx`insert into crms.approval_events (id, request_id, action, actor_id, actor_name, details)
      values (${id}, ${requestId}, ${action}, ${staff.id}, ${staff.name}, ${tx.json(details as postgres.JSONValue)})`;
    return { id, action, staff, requestId, details };
  }
  async function publish(e: Awaited<ReturnType<typeof event>>) {
    await recordAudit(audit, { action: e.action, outcome: "success", actor: staffAuditActor(e.staff),
      target: { type: "approval", id: e.requestId ?? "limit", display_name: e.requestId ?? "Approval limit" },
      description: `${e.staff.name}: ${e.action}`, occurred_at: new Date().toISOString(), metadata: e.details, operationId: e.id });
  }
  async function queueNotice(tx: postgres.TransactionSql, request: ApprovalRequest, audience: "manager" | "ceo" | "requester", text: string) {
    await tx`insert into crms.approval_notices (key, request_id, audience, text)
      values (${`approval:${request.id}:${request.status}:${audience}`}, ${request.id}, ${audience}, ${text}) on conflict do nothing`;
  }
  async function deliverNotices() {
    const pending = await sql<{ key: string; request_id: string; audience: "manager" | "ceo" | "requester"; text: string }[]>`
      select * from crms.approval_notices where delivered_at is null order by key limit 50`;
    const deadline = Date.now() + 4_000;
    for (const item of pending) {
      if (Date.now() >= deadline) break;
      const [request] = await sql<ApprovalRequest[]>`select * from crms.approval_requests where id = ${item.request_id}`;
      try {
        await notify({ request, audience: item.audience, text: item.text, key: item.key });
        await sql`update crms.approval_notices set delivered_at = now() where key = ${item.key}`;
      } catch (error) { console.error("Approval notification could not be delivered", error); }
    }
  }
  async function setLimit(staff: Staff, amount: number) {
    if (!canManage(staff)) return failure("Only a Manager can change the Approval limit.");
    if (!Number.isSafeInteger(amount) || amount < 0) return failure("Enter a nonnegative whole number of centavos.");
    const e = await sql.begin(async tx => {
      const [previous] = await tx`select limit_in_centavos from crms.approval_settings where singleton for update`;
      await tx`update crms.approval_settings set limit_in_centavos = ${amount}, changed_by_id = ${staff.id}, changed_by_name = ${staff.name}, changed_at = now() where singleton`;
      return event(tx, staff, "approval_limit.changed", null, { previous: String(previous.limit_in_centavos), amountInCentavos: amount });
    });
    await defer(() => publish(e));
    return { ok: true as const };
  }
  async function list(staff: Staff, module: string) {
    const role = shopRole(staff.role);
    if (!role) return [];
    await defer(deliverNotices);
    return sql<ApprovalRequest[]>`select * from crms.approval_requests where module = ${module}
      and (${role !== "staff"} or requester_id = ${staff.id}) order by requested_at desc`;
  }
  async function decide(staff: Staff, module: string, id: string, decision: "approve" | "decline", reason = "") {
    if (!UUID.test(id) || !["approve", "decline"].includes(decision)) return failure("Invalid approval decision.");
    const result = await sql.begin(async tx => {
      const [request] = await tx<ApprovalRequest[]>`select * from crms.approval_requests where id = ${id} for update`;
      if (!request || request.module !== module) return { error: failure("Approval request was not found.") };
      const role = shopRole(staff.role);
      // CEO and VP are Manager-level, so one Manager-level decision is final. A request left
      // waiting for the old CEO step is finished by any Manager-level person.
      const manager = request.status === "waiting-manager" && role === "manager";
      const ceo = request.status === "waiting-ceo" && role === "manager";
      if (!manager && !ceo) return { error: failure("Your Role cannot decide this approval step.") };
      if (request.action === "return.decide") return { error: failure("Open the Return and pick its outcome there.") };
      if (request.action === "order.cancel-after-dispatch" && decision === "decline" &&
          (typeof reason !== "string" || !reason.trim() || reason.length > 1000 || /[<>\p{C}\u034f\u17b4\u17b5\u3164\uffa0]/u.test(reason))) return { error: failure("Enter a single plain-text decline reason of up to 1,000 characters.") };
      if (decision === "decline" && !reason.trim()) return { error: failure("Enter a reason for declining.") };
      const status = decision === "decline" ? "declined" : "approved";
      const [updated] = manager
        ? await tx<ApprovalRequest[]>`update crms.approval_requests set status = ${status}, manager_id = ${staff.id}, manager_name = ${staff.name}, manager_at = now(), decline_reason = ${decision === "decline" ? reason.trim() : null} where id = ${id} returning *`
        : await tx<ApprovalRequest[]>`update crms.approval_requests set status = ${status}, ceo_id = ${staff.id}, ceo_name = ${staff.name}, ceo_at = now(), decline_reason = ${decision === "decline" ? reason.trim() : null} where id = ${id} returning *`;
      await queueNotice(tx, updated, "requester", `${staff.name} ${decision === "approve" ? "approved" : "declined"} your request: ${updated.status}.`);
      return { request: updated, event: await event(tx, staff, decision === "approve" ? "approval.granted" : "approval.declined", id, { step: manager ? "manager" : "ceo", status, reason }) };
    });
    if (result.error) return result.error;
    await defer(async () => { await publish(result.event!); await deliverNotices(); });
    return { ok: true as const, request: result.request! };
  }
  async function run<R extends { ok: boolean }>(staff: Staff, input: ApprovalInput, options: ApprovalOptions, execute: () => Promise<R>): Promise<R | ApprovalResult> {
    const role = shopRole(staff.role);
    if (role !== "staff" && role !== "manager") return failure("Your Role can only view shop work.");
    if (!Number.isSafeInteger(input.amountInCentavos) || input.amountInCentavos < 0) return failure("Invalid selling amount.");
    if (options.approvalId) {
      if (!UUID.test(options.approvalId)) return failure("Invalid approval request.");
      const claim = await sql.begin(async tx => {
        const [request] = await tx<ApprovalRequest[]>`select * from crms.approval_requests where id = ${options.approvalId!} for update`;
        if (!request || request.requester_id !== staff.id || request.status !== "approved" || request.module !== input.module ||
          request.action !== input.action || request.target_id !== input.targetId || Number(request.amount_in_centavos) !== input.amountInCentavos) return failure("This action has no matching approval.");
        const [matching] = await tx`select 1 from crms.approval_requests where id = ${request.id} and payload = ${tx.json(input.payload as postgres.JSONValue)}`;
        if (!matching) return failure("The approved action changed. Request approval again.");
        await tx`update crms.approval_requests set status = 'executing' where id = ${request.id}`;
        return { ok: true as const, id: request.id };
      });
      if (!claim.ok) return claim;
      // Commit the claim before crossing service boundaries. An uncertain result stays claimed,
      // so a transport retry cannot repeat an external effect.
      const result = await execute();
      await sql`update crms.approval_requests set status = ${result.ok ? "completed" : "approved"},
        completed_at = ${result.ok ? new Date() : null} where id = ${claim.id}`;
      return result;
    }

    if (role === "manager") return execute();
    const reason = options.reason?.trim();
    const [settings] = await sql`select limit_in_centavos from crms.approval_settings where singleton`;
    if (!reason) return failure("Request approval with a reason.");
    const result = await sql.begin(async tx => {
      const id = randomUUID();
      const [request] = await tx<ApprovalRequest[]>`insert into crms.approval_requests
        (id, module, action, target_id, payload, amount_in_centavos, limit_in_centavos, reason, requester_id, requester_name,
         status, manager_id, manager_name, manager_at)
        values (${id}, ${input.module}, ${input.action}, ${input.targetId}, ${tx.json(input.payload as postgres.JSONValue)}, ${input.amountInCentavos}, ${settings.limit_in_centavos}, ${reason}, ${staff.id}, ${staff.name},
          'waiting-manager', null, null, null) returning *`;
      const events = [await event(tx, staff, "approval.requested", id, { action: input.action, reason })];
      if (input.action === "write-off") events.push(await event(tx, staff, "writeoff.requested", id, { targetId: input.targetId, reason }));
      await queueNotice(tx, request, "manager", `${staff.name} requested approval: ${reason}`);
      return { request, events };
    });
    await defer(async () => { for (const e of result.events) await publish(e); await deliverNotices(); });
    return { ok: false, reason: "Waiting for approval", approvalId: result.request.id, status: result.request.status };
  }
  async function acceptAI(staff: Staff, module: string, suggestionId: string, targetId: string) {
    const e = await sql.begin(tx => event(tx, staff, "ai_suggestion.accepted", null, { module, suggestionId, targetId }));
    await defer(() => publish(e));
    return { ok: true };
  }
  /**
   * A Manager carried out a decision on the target themselves (for example picked a Return's outcome), so the Staff
   * requests asking them to decide it are done. Each is marked completed under the Manager's name and its requester is told.
   */
  async function closeRequests(staff: Staff, module: string, action: ApprovalAction, targetId: string, outcome: string) {
    const result = await sql.begin(async tx => {
      const closed = await tx<ApprovalRequest[]>`update crms.approval_requests set status = 'completed', manager_id = ${staff.id},
        manager_name = ${staff.name}, manager_at = now(), completed_at = now()
        where module = ${module} and action = ${action} and target_id = ${targetId} and status = 'waiting-manager' returning *`;
      const events = [];
      for (const request of closed) {
        await queueNotice(tx, request, "requester", `${staff.name} decided your request: ${outcome}.`);
        events.push(await event(tx, staff, "approval.granted", request.id, { step: "manager", outcome }));
      }
      return events;
    });
    if (result.length) await defer(async () => { for (const e of result) await publish(e); await deliverNotices(); });
    return result.length;
  }
  return { setLimit, list, decide, run, acceptAI, deliverNotices, closeRequests };
}
