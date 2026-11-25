"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { deliverGatewayAuditEvent } from "@/lib/gateway";
import { staffAuditActor, type AuditEvent } from "@/lib/audit-trail";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON, shopRole } from "@/lib/portal/roles";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { requireModule } from "@/lib/portal/staff";
import { auditCustomerDenied } from "./customer-audit";
import { readCustomerTasks, type CustomerTask } from "./tasks";

export type TaskResult = { ok: true; task: CustomerTask } | { ok: false; message: string; unavailable?: true };
type Owner = { id: string; name: string };
type Change = { kind: "created"; description: string; dueDate: string; owner?: Owner }
  | { kind: "done" | "reopened" }
  | { kind: "due_date_changed"; dueDate: string }
  | { kind: "reassigned"; owner: Owner };
const refused = (message: string): TaskResult => ({ ok: false, message });
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number(value.slice(0, 4)) > 0 && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}
function validOwner(owner: Owner): boolean {
  return !!owner && typeof owner.id === "string" && !!owner.id.trim() && owner.id.length <= 200
    && typeof owner.name === "string" && !!owner.name.trim() && owner.name.length <= 200;
}

async function performTask(customerId: string, taskId: string | null, change: Change, operationId: string): Promise<TaskResult> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (!canWork(staff)) return refused(READ_ONLY_REASON);
  if (typeof customerId !== "string" || !customerId || customerId.length > 200
      || typeof operationId !== "string" || !operationId.trim() || operationId.length > 200)
    return refused("A Customer and an operation id are required.");
  if (taskId !== null && (typeof taskId !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(taskId))) return refused("Task not found.");
  if ("dueDate" in change && !validDate(change.dueDate)) return refused("Choose a valid due date (YYYY-MM-DD, Philippine Time).");
  if (change.kind === "created" && (typeof change.description !== "string" || !change.description.trim() || [...change.description.trim()].length > 200))
    return refused("Write a Task description of 1 to 200 characters.");
  const manager = shopRole(staff.role) === "manager";
  if ((change.kind === "reassigned" || ("owner" in change && change.owner !== undefined)) && !validOwner(change.owner!)) return refused("Choose an owner with a name.");
  if (!manager && (change.kind === "reassigned" || (change.kind === "created" && change.owner && change.owner.id !== staff.id)))
    return refused("Only a Manager can assign or reassign a Task to someone else. Request approval.");
  const request = JSON.stringify([customerId, taskId, change]);
  try {
    const [customer] = await database()<{ name: string }[]>`select c.full_name as name from public.customers c join neon_auth."user" u on u.id::text = c.id and u."emailVerified" where c.id = ${customerId} and to_jsonb(c)->>'deleted_at' is null`;
    if (!customer) return refused("Customer not found. Tasks require a verified Customer.");
    const sql = crmsDatabase();
    const result = await sql.begin(async tx => {
      // Serializes the same operation, including concurrent creation retries.
      await tx`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([staff.id, operationId])}, 0))`;
      const [receipt] = await tx<{ request: string; result: TaskResult }[]>`select request, result from crms.customer_task_operations where actor_id = ${staff.id} and operation_id = ${operationId}`;
      if (receipt) return receipt.request === request ? receipt.result : refused("This operation id was already used for a different request.");
      let owner: Owner = staff;
      if (change.kind === "reassigned" || (change.kind === "created" && change.owner && change.owner.id !== staff.id)) {
        const selectedId = change.owner!.id;
        const person = (await portalGateway().recipients()).find(person => person.id === selectedId);
        if (!person || !person.name?.trim() || !person.modules.includes(CUSTOMER_PROFILES_MODULE)
            || !["staff", "manager"].includes(shopRole(person.role ?? "") ?? ""))
          return refused("Choose an active Staff member or Manager with Customer Profiles access.");
        owner = { id: person.id, name: person.name };
      }
      const id = taskId ?? randomUUID();
      const metadata: Record<string, unknown> = { taskId: id };
      if (change.kind === "created") {
        await tx`insert into crms.customer_tasks (id, customer_id, description, due_date, owner_id, owner_name, created_by_id, created_by_name)
          values (${id}, ${customerId}, ${change.description.trim()}, ${change.dueDate}, ${owner.id}, ${owner.name}, ${staff.id}, ${staff.name})`;
      } else {
        const [old] = await tx<{ owner_id: string; owner_name: string; due_date: string }[]>`select owner_id, owner_name, due_date::text from crms.customer_tasks where id = ${id} and customer_id = ${customerId} for update`;
        if (!old) return refused("Task not found for this Customer.");
        if (!manager && old.owner_id !== staff.id) return refused("Only the Task owner or a Manager can change this Task.");
        switch (change.kind) {
          case "done": await tx`update crms.customer_tasks set done_at = now(), done_by_id = ${staff.id}, done_by_name = ${staff.name} where id = ${id} and done_at is null`; break;
          case "reopened": await tx`update crms.customer_tasks set done_at = null, done_by_id = null, done_by_name = null where id = ${id}`; break;
          case "due_date_changed":
            metadata.oldDueDate = old.due_date; metadata.newDueDate = change.dueDate;
            await tx`update crms.customer_tasks set due_date = ${change.dueDate} where id = ${id}`; break;
          case "reassigned":
            metadata.oldOwner = { id: old.owner_id, name: old.owner_name }; metadata.newOwner = owner;
            await tx`update crms.customer_tasks set owner_id = ${owner.id}, owner_name = ${owner.name} where id = ${id}`; break;
        }
      }
      const tasks = await readCustomerTasks(tx, customerId);
      const saved: TaskResult = { ok: true, task: tasks.find(t => t.id === id)! };
      const event: AuditEvent = { module: CUSTOMER_PROFILES_MODULE, action: `customer_task.${change.kind}`, outcome: "success", actor: staffAuditActor(staff), target: { type: "customer_profile", id: customerId, display_name: customer.name }, description: `${staff.name} recorded a Task action (${change.kind}) for ${customer.name}.`, occurred_at: new Date().toISOString(), metadata, operationId: `customer-task:${staff.id}:${operationId}` };
      await tx`insert into crms.customer_task_operations (actor_id, operation_id, request, result, event) values (${staff.id}, ${operationId}, ${request}, ${tx.json(saved as unknown as import("postgres").JSONValue)}, ${tx.json(event as unknown as import("postgres").JSONValue)})`;
      return saved;
    });
    if (result.ok) {
      // Lock the receipt during delivery so concurrent retries emit once. Gateway also deduplicates by operation id.
      await sql.begin(async tx => {
        const [receipt] = await tx<{ event: AuditEvent; audit_sent: boolean }[]>`select event, audit_sent from crms.customer_task_operations where actor_id = ${staff.id} and operation_id = ${operationId} for update`;
        if (receipt && !receipt.audit_sent) {
          await deliverGatewayAuditEvent(receipt.event);
          await tx`update crms.customer_task_operations set audit_sent = true where actor_id = ${staff.id} and operation_id = ${operationId}`;
        }
      }).catch(error => console.error("Customer Task audit delivery failed", error));
      revalidatePath(`/customer-profiles/${customerId}`);
    }
    return result;
  } catch (error) {
    console.error("Customer Task could not be saved", error);
    return { ok: false, unavailable: true, message: "Tasks are unavailable right now. Please try again." };
  }
}

/** Every refused or failed attempt is one `failure` event with the same action name; a saved change recorded its own. */
async function changeTask(customerId: string, taskId: string | null, change: Change, operationId: string): Promise<TaskResult> {
  const result = await performTask(customerId, taskId, change, operationId);
  if (!result.ok) {
    const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
    const reason = result.unavailable ? "unavailable" : slug(result.message);
    await auditCustomerDenied(staff, customerId, `customer_task.${change?.kind}`, "change a Customer Task", reason, operationId, typeof taskId === "string" ? { taskId } : {});
  }
  return result;
}

export async function createCustomerTask(customerId: string, input: { description: string; dueDate: string; owner?: Owner }, operationId: string): Promise<TaskResult> {
  return changeTask(customerId, null, { kind: "created", description: input?.description, dueDate: input?.dueDate, owner: input?.owner }, operationId);
}
export async function markCustomerTaskDone(customerId: string, taskId: string, operationId: string): Promise<TaskResult> {
  return changeTask(customerId, taskId, { kind: "done" }, operationId);
}
export async function reopenCustomerTask(customerId: string, taskId: string, operationId: string): Promise<TaskResult> {
  return changeTask(customerId, taskId, { kind: "reopened" }, operationId);
}
export async function changeCustomerTaskDueDate(customerId: string, taskId: string, dueDate: string, operationId: string): Promise<TaskResult> {
  return changeTask(customerId, taskId, { kind: "due_date_changed", dueDate }, operationId);
}
export async function reassignCustomerTask(customerId: string, taskId: string, owner: Owner, operationId: string): Promise<TaskResult> {
  return changeTask(customerId, taskId, { kind: "reassigned", owner }, operationId);
}

/** Active Staff and Managers a Manager may reassign a Task to. Staff and read-only Roles get nothing. */
export async function listTaskOwners(): Promise<{ ok: true; owners: Owner[] } | { ok: false; message: string }> {
  const staff = await requireModule(CUSTOMER_PROFILES_MODULE);
  if (shopRole(staff.role) !== "manager") return { ok: false, message: "Only a Manager can reassign a Task. Request approval." };
  try {
    const people = await portalGateway().recipients();
    return { ok: true, owners: people
      .filter(person => person.name?.trim() && person.modules.includes(CUSTOMER_PROFILES_MODULE) && ["staff", "manager"].includes(shopRole(person.role ?? "") ?? ""))
      .map(person => ({ id: person.id, name: person.name! })) };
  } catch (error) {
    console.error("Task owners could not be read", error);
    return { ok: false, message: "Staff list is unavailable right now. Please try again." };
  }
}
