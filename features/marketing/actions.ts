"use server";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { gatewayAuditLog, gatewayImageStore, gatewayMarketingMail, gatewayMarketingMailer } from "@/lib/gateway";
import { MARKETING_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import { addImage } from "./add-image";
import {
  deleteDraft,
  editDraft,
  retrySend,
  saveDraft,
  sendNow,
  storefrontSubscribers,
  sendTestCopy,
  type AnnouncementInput,
  type DeleteResult,
  type EditResult,
  type Ports,
  type SaveResult,
  type SendResult,
  type TestCopyResult,
} from "./announcements";
import type { AddImageResult } from "./image-limits";

export type Unavailable = { ok: false; reason: "unavailable" };

const ports = (): Ports => ({
  audit: gatewayAuditLog,
  mail: gatewayMarketingMail,
  images: gatewayImageStore,
  subscribers: storefrontSubscribers(database()),
  mailer: gatewayMarketingMailer,
  now: () => new Date(),
});

/** Server actions are public endpoints, so each proves the Staff member holds the Marketing Module. */
async function act<R extends { ok: boolean }>(
  run: (actor: { id: string; name: string }, email: string) => Promise<R>,
): Promise<R | Unavailable> {
  const staff = await requireModule(MARKETING_MODULE);

  try {
    const result = await run({ id: staff.username, name: staff.name }, staff.email);
    if (result.ok) revalidatePath("/email-campaigns");

    return result;
  } catch (error) {
    console.error("Announcement could not be changed", error);

    return { ok: false, reason: "unavailable" };
  }
}

export async function saveDraftAction(input: AnnouncementInput): Promise<SaveResult | Unavailable> {
  return act((actor) => saveDraft(crmsDatabase(), actor, input, ports()));
}

export async function editDraftAction(id: string, input: AnnouncementInput): Promise<EditResult | Unavailable> {
  return act((actor) => editDraft(crmsDatabase(), actor, id, input, ports()));
}

export async function deleteDraftAction(id: string): Promise<DeleteResult | Unavailable> {
  return act((actor) => deleteDraft(crmsDatabase(), actor, id, ports()));
}

export async function sendNowAction(id: string): Promise<SendResult | Unavailable> {
  return act((actor) => sendNow(crmsDatabase(), actor, id, ports()));
}

export async function retrySendAction(id: string): Promise<SendResult | Unavailable> {
  return act((actor) => retrySend(crmsDatabase(), actor, id, ports()));
}

/** Sends to the signed-in Staff member's own email, taken from their session and never from the caller. */
export async function sendTestCopyAction(id: string): Promise<TestCopyResult | Unavailable> {
  return act((actor, email) => sendTestCopy(crmsDatabase(), actor, email, id, ports()));
}

/** Shrinks and stores one image; it joins an Announcement only when the Draft is saved with its address. */
export async function addImageAction(form: FormData): Promise<AddImageResult | Unavailable> {
  const staff = await requireModule(MARKETING_MODULE);
  const file = form.get("image");

  if (!(file instanceof File)) return { ok: false, reason: "not-an-image" };

  try {
    return await addImage({ id: staff.username, name: staff.name }, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, ports());
  } catch (error) {
    console.error("Announcement image could not be added", error);

    return { ok: false, reason: "unavailable" };
  }
}
