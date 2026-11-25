"use server";

import { revalidatePath } from "next/cache";
import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { auditCustomerDenied, auditCustomerNotesRead } from "./customer-audit";
import { customerNote, listCustomerNotes, type CustomerNote, type CustomerNoteRow } from "./notes";

type Refusal = { ok: false; message: string; unavailable?: true };
export type AddCustomerNoteResult = { ok: true; note: CustomerNote } | Refusal;

export async function addCustomerNote(customerId: string, text: string, operationId: string): Promise<AddCustomerNoteResult> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  const deny = async (reason: string, message = reason): Promise<Refusal> => {
    await auditCustomerDenied(staff, customerId, "customer_note.created", "add a Customer note", reason, operationId);
    return { ok: false, message };
  };
  if (!canWork(staff)) return deny("read-only", READ_ONLY_REASON);
  if (typeof customerId !== "string" || !customerId.trim()) return deny("no-customer", "Choose a Customer.");
  if (typeof text !== "string" || !text.trim()) return deny("empty-note", "Write a Customer note before saving.");
  if (Array.from(text).length > 2000) return deny("too-long", "A Customer note can have at most 2,000 characters.");
  if (typeof operationId !== "string" || !operationId.trim() || operationId.length > 200) return deny("bad-request-id", "Provide a valid request id to save the Customer note.");
  try {
    const writer = crmsDatabase();
    const [previous] = await writer<CustomerNoteRow[]>`select * from crms.customer_notes where author_id = ${staff.id} and operation_id = ${operationId}`;
    if (previous) return previous.customer_id === customerId
      ? { ok: true, note: customerNote(previous) }
      : await deny("request-id-reused", "This request id was already used for another Customer.");
    const [customer] = await database()<{ name: string }[]>`
      select c.full_name as name from public.customers c
      join neon_auth."user" u on u.id::text = c.id and u."emailVerified"
      where c.id = ${customerId} and to_jsonb(c)->>'deleted_at' is null`;
    if (!customer) return deny("customer-not-found", "This Customer could not be found.");
    const [saved] = await writer<CustomerNoteRow[]>`
      insert into crms.customer_notes (customer_id, author_id, author_name, body, operation_id)
      values (${customerId}, ${staff.id}, ${staff.name}, ${text.trim()}, ${operationId})
      on conflict (author_id, operation_id) do nothing returning *`;
    if (!saved) {
      const [replayed] = await writer<CustomerNoteRow[]>`select * from crms.customer_notes where author_id = ${staff.id} and operation_id = ${operationId}`;
      return replayed.customer_id === customerId ? { ok: true, note: customerNote(replayed) }
        : await deny("request-id-reused", "This request id was already used for another Customer.");
    }
    await recordAudit(gatewayAuditTrail, {
      module: CUSTOMER_PROFILES_MODULE, action: "customer_note.created", actor: staffAuditActor(staff),
      target: { type: "customer", id: customerId, display_name: customer.name },
      description: `${staff.name} added a Customer note for ${customer.name}.`,
      occurred_at: saved.created_at.toISOString(), outcome: "success",
      operationId: JSON.stringify(["customer_note.created", staff.id, operationId]),
    });
    revalidatePath(`/customer-profiles/${customerId}`);
    return { ok: true, note: customerNote(saved) };
  } catch {
    await auditCustomerDenied(staff, customerId, "customer_note.created", "add a Customer note", "unavailable", operationId);
    return { ok: false, unavailable: true, message: "Customer notes are unavailable. Try again with the same request." };
  }
}

export async function readCustomerNotes(customerId: string): Promise<{ ok: true; notes: CustomerNote[] } | Refusal> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (typeof customerId !== "string" || !customerId.trim()) return { ok: false, message: "Choose a Customer." };
  try {
    const notes = await listCustomerNotes(crmsDatabase(), customerId);
    await auditCustomerNotesRead(staff, customerId);
    return { ok: true, notes };
  } catch {
    return { ok: false, unavailable: true, message: "Customer notes are unavailable. Try again." };
  }
}
