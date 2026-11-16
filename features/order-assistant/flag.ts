import type postgres from "postgres";
import type { AuditTrail } from "@/lib/audit-trail";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { shopRole } from "@/lib/portal/roles";

export async function flagAnswer(
  deps: { tickets: postgres.Sql; crms: postgres.Sql; audit: AuditTrail },
  staff: { role: string; username: string; name: string },
  ticketId: number,
  messageId: number,
  reason: string,
) {
  if (!["staff", "manager"].includes(shopRole(staff.role) ?? ""))
    return { ok: false, reason: "Your Role can only view shop work." };
  if (
    !Number.isSafeInteger(ticketId) ||
    ticketId < 1 ||
    !Number.isSafeInteger(messageId) ||
    messageId < 1 ||
    typeof reason !== "string" ||
    !reason.trim() ||
    reason.trim().length > 500
  )
    return { ok: false, reason: "Enter a reason of 1–500 characters." };
  const [message] = await deps.tickets<
    { body: string }[]
  >`select m.body from assistant_messages m
    join assistant_chats c on c.id = m.chat_id where m.id = ${messageId} and c.ticket_id = ${ticketId} and m.sender = 'assistant'`;
  if (!message)
    return { ok: false, reason: "This answer is not attached to this Ticket." };
  const [flag] = await deps.crms`insert into crms.assistant_answer_flags
    (message_id, ticket_id, reason, staff_id, staff_name, answer)
    values (${messageId}, ${ticketId}, ${reason.trim()}, ${staff.username}, ${staff.name}, ${message.body})
    on conflict (message_id) do nothing returning created_at`;
  if (!flag)
    return {
      ok: false,
      reason:
        "This answer has already been marked wrong. Reload to see who recorded it.",
    };
  await recordAudit(deps.audit, {
    module: "Tickets",
    action: "assistant.answer.marked-wrong",
    outcome: "success",
    actor: staffAuditActor({ id: staff.username, name: staff.name }),
    target: {
      type: "Ticket",
      id: String(ticketId),
      display_name: `TKT-${ticketId}`,
    },
    description: `${staff.name} marked an Order assistant answer wrong: ${reason.trim()}`,
    occurred_at: new Date(flag.created_at).toISOString(),
    operationId: `assistant-flag-${messageId}`,
    metadata: { messageId, reason: reason.trim() },
  });
  return { ok: true };
}
