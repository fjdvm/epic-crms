import { storeImageBytes } from "@/features/files/server-upload";
import { IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "@/features/tickets/attachments";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { canWork, READ_ONLY_REASON } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

const answer = (body: { ok: true; reference: string } | { ok: false; reason: string }, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/**
 * A product image for the shop (Products & Stocks). The browser sends the image here as `file` in a form, and CREOMS
 * checks it and stores it in the public bucket itself; the answer is the ready reference `publishProductContent` takes.
 * Staff and Managers only, like the publish; the image is shown to nobody until they publish it.
 */
export async function POST(request: Request) {
  const staff = await requireModule(ORDERS_MODULE);
  if (!canWork(staff)) return answer({ ok: false, reason: READ_ONLY_REASON }, 403);
  // Refuse an oversized body before reading it; the form adds a little to the image itself.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_IMAGE_BYTES + 64 * 1024) return answer({ ok: false, reason: IMAGE_REFUSALS["image-too-large"] }, 413);
  let file: FormDataEntryValue | null;
  try { file = (await request.formData()).get("file"); }
  catch { return answer({ ok: false, reason: "Choose a JPG or PNG image." }, 400); }
  if (!(file instanceof File)) return answer({ ok: false, reason: "Choose a JPG or PNG image." }, 400);
  if (file.size > MAX_IMAGE_BYTES) return answer({ ok: false, reason: IMAGE_REFUSALS["image-too-large"] }, 413);
  const result = await storeImageBytes(ORDERS_MODULE, staff.username, {
    filename: file.name, contentType: file.type, bytes: new Uint8Array(await file.arrayBuffer()),
  });
  return result.ok ? answer({ ok: true, reference: result.reference }) : answer({ ok: false, reason: result.reason }, 422);
}
