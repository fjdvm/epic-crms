"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";

import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail } from "@/lib/gateway";
import { portalGateway } from "@/features/notifications/portal-gateway";
import { currentPaymentReviewHours } from "@/features/settings/automatic-checks-server";
import { PAYMENTS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON, shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import type { Staff } from "@/lib/portal/client";

import { claimReview, loadPaymentReview, reassignReview, type PaymentReview } from "./payment-review";

export type ReviewResult = { ok: true } | { ok: false; reason: string };

const NOT_IN_REVIEW = "This Order is no longer in Manager payment review. Refresh it.";
const MANAGERS_ONLY = "Only a CREOMS Manager can take or hand over a payment review.";

const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** `identity` makes a replay of the same action keep one operation identity (#745). */
async function audit(id: number, staff: Staff, action: string, description: string, metadata: Record<string, unknown>, identity: string, outcome: "success" | "failure" = "success") {
  await recordAudit(gatewayAuditTrail, {
    action, module: PAYMENTS_MODULE, outcome, actor: staffAuditActor(staff),
    target: { type: "order", id: String(id), display_name: `Order #${id}` },
    description, metadata, occurred_at: new Date().toISOString(),
    operationId: `order:${id}:${action}:${outcome === "failure" ? `denied:${staff.id}:` : ""}${identity}`,
  });
}

/** Authorize, then run with the Order's current review. Opening an Order never claims it; only these actions do. */
async function act(id: number, attempt: { action: string; text: string }, run: (staff: Staff, review: PaymentReview) => Promise<ReviewResult>): Promise<ReviewResult> {
  const staff = await requireModule(PAYMENTS_MODULE);
  // Every refused or failed attempt is an Audit Event with the reason (#745); the same refusal keeps one identity.
  const refused = async (reason: string): Promise<ReviewResult> => {
    if (Number.isSafeInteger(id) && id >= 1) {
      await audit(id, staff, attempt.action, `${staff.name} could not ${attempt.text} on Order #${id}: ${reason}`, { reason }, digest(reason), "failure");
    }
    return { ok: false, reason };
  };
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid Order number." };
  if (!canWork(staff)) return refused(READ_ONLY_REASON);
  if (shopRole(staff.role) !== "manager") return refused(MANAGERS_ONLY);
  try {
    const review = await loadPaymentReview(database(), crmsDatabase(), id, await currentPaymentReviewHours());
    if (!review) return refused(NOT_IN_REVIEW);
    const result = await run(staff, review);
    if (result.ok) {
      revalidatePath(`/orders/${id}`);
      revalidatePath("/payments");
      revalidatePath("/dashboard");
      return result;
    }
    return refused(result.reason);
  } catch {
    return refused("The payment review is temporarily unavailable.");
  }
}

/** A Manager takes the review. Waits for the server: a Manager's decision is never optimistic. */
export async function claimPaymentReview(id: number): Promise<ReviewResult> {
  return act(id, { action: "payment_review.claimed", text: "take the payment review" }, async (staff, review) => {
    if (review.owner) return { ok: false, reason: `${review.owner.name} already has this review.` };
    const taken = await claimReview(crmsDatabase(), id, { id: staff.username, name: staff.name });
    if (taken) return { ok: false, reason: `${taken.holder} already has this review.` };
    await audit(id, staff, "payment_review.claimed", `${staff.name} took the payment review on Order #${id}.`, { owner: staff.name }, staff.id);
    return { ok: true };
  });
}

/** Every Manager with the Payments Module the Portal knows, by username: who a review can be handed to. */
export async function loadReviewManagers(): Promise<{ ok: true; managers: { id: string; name: string }[] } | { ok: false; reason: string }> {
  const staff = await requireModule(PAYMENTS_MODULE);
  if (shopRole(staff.role) !== "manager") return { ok: false, reason: MANAGERS_ONLY };
  try {
    const people = await portalGateway().recipients();
    return { ok: true, managers: people.flatMap(p => p.username && p.name?.trim() && p.modules.includes(PAYMENTS_MODULE) && shopRole(p.role ?? "") === "manager"
      ? [{ id: p.username, name: p.name }] : []) };
  } catch {
    return { ok: false, reason: "Managers could not be loaded. Try again." };
  }
}

/** Hands the review to another Manager. Each owner is audited with who handed it over and why. */
export async function reassignPaymentReview(id: number, toId: string, reason: string): Promise<ReviewResult> {
  const why = typeof reason === "string" ? reason.trim() : "";
  return act(id, { action: "payment_review.reassigned", text: "hand over the payment review" }, async (staff, review) => {
    if (!why) return { ok: false, reason: "Enter a reason for handing this review over." };
    const options = await loadReviewManagers();
    if (!options.ok) return options;
    const target = options.managers.find(m => m.id === toId);
    if (!target) return { ok: false, reason: "Choose a Manager with the Payments Module." };
    if (review.owner?.id === target.id) return { ok: false, reason: `${target.name} already has this review.` };
    if (!(await reassignReview(crmsDatabase(), id, review.owner?.id ?? null, target))) {
      return { ok: false, reason: "The review changed hands while you were looking. Refresh it." };
    }
    await audit(id, staff, "payment_review.reassigned",
      `${staff.name} moved the payment review on Order #${id} from ${review.owner?.name ?? "no one"} to ${target.name}: ${why}`,
      { from: review.owner?.name ?? null, to: target.name, reason: why }, digest(`${review.owner?.id ?? ""}\n${target.id}\n${why}`));
    return { ok: true };
  });
}
