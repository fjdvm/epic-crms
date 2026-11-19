"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { database } from "@/lib/db";
import { recordAudit, staffAuditActor } from "@/lib/audit-trail";
import { gatewayAuditTrail, gatewayFileStorage } from "@/lib/gateway";
import { SENIOR_PWD_MODULE } from "@/lib/portal/config";
import type { Staff } from "@/lib/portal/client";
import { canWork, shopRole, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { changeVerification, type VerificationChange } from "@/lib/storefront";
import {
  currentStatus, listVerifications, loadVerification, philippineToday,
  type Verification, type VerificationList,
} from "./verifications";

/**
 * Senior/PWD review belongs to the Orders Module: Staff review the ID before the Order confirms.
 * Approve and decline are Staff work; override and revoke need a Manager.
 */
export type VerificationActionResult = { ok: true; status: string; photoRemoved: boolean } | { ok: false; reason: string };

const MANAGER_ONLY = "Request approval from a CREOMS Manager to override or revoke a verification.";
const ALREADY_CHANGED = "This verification already changed; refresh it before trying again.";
const UNAVAILABLE = "Senior/PWD verification is temporarily unavailable.";
const clean = (text: unknown) => (typeof text === "string" ? text.trim() : "");

export async function loadVerifications(): Promise<{ ok: true; list: VerificationList; now: Date } | { ok: false; reason: string }> {
  await requireModule(SENIOR_PWD_MODULE);
  try {
    const now = new Date();
    return { ok: true, list: await listVerifications(database(), now), now };
  } catch { return { ok: false, reason: UNAVAILABLE }; }
}

/** One verification for the review page, with its status as of now. */
export async function loadVerificationDetail(id: number): Promise<{ ok: true; verification: Verification; now: Date } | { ok: false; reason: string; missing?: true }> {
  await requireModule(SENIOR_PWD_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid verification number.", missing: true };
  try {
    const now = new Date();
    const v = await loadVerification(database(), id);
    if (!v) return { ok: false, reason: "Verification was not found.", missing: true };
    return { ok: true, verification: { ...v, status: currentStatus(v, now) }, now };
  } catch { return { ok: false, reason: UNAVAILABLE }; }
}

/** A short-lived private address for the photo, only while the photo exists and is still waiting for review. */
export async function loadVerificationPhoto(id: number): Promise<{ ok: true; url: string; backUrl: string | null } | { ok: false; reason: string }> {
  const staff = await requireModule(SENIOR_PWD_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid verification number." };
  try {
    const v = await loadVerification(database(), id);
    if (!v) return { ok: false, reason: "Verification was not found." };
    if (v.status !== "pending" || !v.photoFileId || currentStatus(v, new Date()) !== "pending") {
      return { ok: false, reason: "The ID photo has been removed. The Customer uploads it again if needed." };
    }
    const backUrl = v.photoBackFileId ? await gatewayFileStorage.viewUrl(v.photoBackFileId).catch(() => null) : null;
    const url = await gatewayFileStorage.viewUrl(v.photoFileId);
    // An ID photo is personal data: opening it is audited (who, which ID), once per Staff member per ten minutes.
    const opened = new Date();
    after(() => recordAudit(gatewayAuditTrail, {
      action: "pwd.photo_viewed", module: SENIOR_PWD_MODULE, outcome: "success", actor: staffAuditActor(staff),
      target: { type: "customer", id: v.customerId, display_name: v.customerName },
      description: `${staff.name} opened the Senior/PWD ID photo of ${v.customerName}.`,
      metadata: { verificationId: id, idType: v.idType },
      occurred_at: opened.toISOString(),
      operationId: `pwd:${id}:photo_viewed:${staff.id}:${Math.floor(opened.getTime() / 600_000)}`,
    }));
    return { ok: true, url, backUrl };
  } catch { return { ok: false, reason: "The ID photo could not be opened." }; }
}

async function decide(
  id: number,
  check: (v: Verification, staff: Staff, now: Date) => string | null,
  change: (v: Verification) => VerificationChange,
  audit: { action: "pwd.approved" | "pwd.declined" | "pwd.revoked"; verb: string; metadata: (v: Verification) => Record<string, unknown> },
  managerOnly = false,
): Promise<VerificationActionResult> {
  const staff = await requireModule(SENIOR_PWD_MODULE);
  if (!Number.isSafeInteger(id) || id < 1) return { ok: false, reason: "Invalid verification number." };
  if (!canWork(staff)) return { ok: false, reason: READ_ONLY_REASON };
  if (managerOnly && shopRole(staff.role) !== "manager") return { ok: false, reason: MANAGER_ONLY };

  let verification: Verification | null;
  try { verification = await loadVerification(database(), id); } catch { return { ok: false, reason: UNAVAILABLE }; }
  if (!verification) return { ok: false, reason: "Verification was not found." };
  const refusal = check(verification, staff, new Date());
  if (refusal) return { ok: false, reason: refusal };

  // Never optimistic: the storefront emails the Customer. An uncertain answer is never retried here.
  const result = await changeVerification(id, { ...change(verification), staffId: staff.username, staffName: staff.name });
  if (!result.ok) return result;

  // The photo is deleted right after review. File-storage's seven-day expiry covers a failed delete.
  let photoRemoved = verification.photoFileId === null;
  if (verification.photoFileId) {
    try { await gatewayFileStorage.remove(verification.photoFileId); photoRemoved = true; } catch { /* expiry removes it */ }
  }
  if (verification.photoBackFileId) {
    try { await gatewayFileStorage.remove(verification.photoBackFileId); } catch { /* expiry removes it */ }
  }
  // No ID number, photo or hash ever enters an audit event.
  await recordAudit(gatewayAuditTrail, {
    action: audit.action, module: SENIOR_PWD_MODULE, outcome: "success", actor: staffAuditActor(staff),
    target: { type: "customer", id: verification.customerId, display_name: verification.customerName },
    description: `${staff.name} ${audit.verb} the Senior/PWD verification of ${verification.customerName}.`,
    metadata: { verificationId: id, idType: verification.idType, ...audit.metadata(verification) },
    occurred_at: new Date().toISOString(),
    operationId: `pwd:${id}:${audit.action}:${verification.status}:${verification.decidedAt?.getTime() ?? "new"}`,
  });
  revalidatePath("/orders", "layout");
  revalidatePath("/customer-profiles", "layout");
  return { ok: true, status: result.verification.status, photoRemoved };
}

function validExpiry(expiresOn: unknown, now: Date): string | null {
  if (typeof expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
    new Date(`${expiresOn}T00:00:00Z`).toISOString().slice(0, 10) !== expiresOn) return "Enter the ID's expiry date.";
  if (expiresOn <= philippineToday(now)) return "This ID has expired. Decline it, or ask the Customer for a valid one.";
  return null;
}

/** Staff approve a pending verification: the Customer is marked verified until the ID's expiry date. */
export async function approveVerification(id: number, expiresOn: string): Promise<VerificationActionResult> {
  return decide(id,
    (v, _staff, now) => currentStatus(v, now) !== "pending" ? ALREADY_CHANGED : validExpiry(expiresOn, now),
    () => ({ action: "approve", expiresOn }),
    { action: "pwd.approved", verb: "approved", metadata: () => ({ expiresOn }) });
}

/** Staff decline a pending verification with a reason the Customer is told. */
export async function declineVerification(id: number, reason: string): Promise<VerificationActionResult> {
  const text = clean(reason);
  return decide(id,
    (v, _staff, now) => currentStatus(v, now) !== "pending" ? ALREADY_CHANGED : text ? null : "Enter a reason for declining.",
    () => ({ action: "decline", reason: text }),
    { action: "pwd.declined", verb: "declined", metadata: () => ({ reason: text }) });
}

/** A Manager approves a verification Staff declined, or one that lapsed, with a reason. */
export async function overrideVerification(id: number, expiresOn: string, reason: string): Promise<VerificationActionResult> {
  const text = clean(reason);
  return decide(id,
    (v, _staff, now) => {
      const status = currentStatus(v, now);
      if (status !== "declined" && status !== "revoked") return ALREADY_CHANGED;
      return text ? validExpiry(expiresOn, now) : "Enter a reason for the override.";
    },
    () => ({ action: "approve", expiresOn, override: true }),
    { action: "pwd.approved", verb: "overrode (approved)", metadata: () => ({ expiresOn, override: true, reason: text }) },
    true);
}

/** A Manager takes back an approved verification. The discount stops at once. */
export async function revokeVerification(id: number, reason: string): Promise<VerificationActionResult> {
  const text = clean(reason);
  return decide(id,
    (v, _staff, now) => currentStatus(v, now) !== "approved" ? ALREADY_CHANGED : text ? null : "Enter a reason for revoking.",
    () => ({ action: "revoke", reason: text }),
    { action: "pwd.revoked", verb: "revoked", metadata: () => ({ reason: text }) },
    true);
}
