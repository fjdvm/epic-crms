import { gatewayFileStorage } from "@/lib/gateway";
import { canManage } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
import { checkFileInfo, filePolicy, type UploadModule } from "./policy";
import { openUpload } from "./reference";
import { directFileStorage, storageUrl } from "./storage";

/** Server-only record readers supply the owning Module and a File id obtained from that record. */
export async function viewStoredFile(module: UploadModule, fileId: string) {
  const staff = await requireModule(module);
  if (module === "Management" && !canManage(staff)) throw new Error("Attachment is unavailable");
  const file = await directFileStorage.view(fileId);
  if (file.id !== fileId || file.status !== "active") throw new Error("Attachment is unavailable");
  return { url: storageUrl(file.url), filename: file.filename, contentType: file.contentType, size: file.size };
}

/** Only a ready reference issued to this Staff member and owning Module can become record evidence. */
export async function recordUpload(module: UploadModule, reference: unknown, staffId: string) {
  const staff = await requireModule(module);
  if (module === "Management" && !canManage(staff)) return null;
  const upload = openUpload(reference);
  if (!upload || upload.phase !== "ready" || upload.module !== module || upload.staffId !== staffId || checkFileInfo(module, upload)) return null;
  const file = await directFileStorage.view(upload.fileId);
  const policy = filePolicy(module);
  if (file.id !== upload.fileId || file.status !== "active" || file.visibility !== policy.visibility || file.retentionType !== policy.retentionType ||
    file.contentType !== upload.contentType || file.size !== upload.size) return null;
  return { ...upload, url: storageUrl(file.url) };
}

/** Ticket references also belong to the Conversation they were uploaded for. */
export async function ticketUpload(reference: string, staffId: string, ticketId: number | null) {
  const upload = await recordUpload(TICKETS_MODULE, reference, staffId);
  return upload && upload.context.ticketId === ticketId ? upload : null;
}

/** Ticket record loaders retain legacy operations while protecting each signed view. */
export const ticketFileStorage = {
  linkToMessage: (fileId: string, messageId: number) => gatewayFileStorage.linkToMessage(fileId, messageId),
  remove: (fileId: string) => gatewayFileStorage.remove(fileId),
  viewUrl: async (fileId: string) => (await viewStoredFile("Tickets", fileId)).url,
  viewFile: async (fileId: string) => {
    const { url, filename, contentType, size } = await viewStoredFile("Tickets", fileId);
    return { url, filename, contentType, size };
  },
};
